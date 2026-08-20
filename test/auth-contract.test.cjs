const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  buildAuthRequest,
  parseTokenExchangeResponse,
  requestTokenExchange,
} = require('../dist/auth-contract.js');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('builds the canonical tenant-scoped audience and exchange URL', () => {
  assert.deepEqual(
    buildAuthRequest('https://api.datarecs.io', 'acme', 'abcdef0123456789'),
    {
      audience: 'https://api.datarecs.io/acme',
      exchangeUrl: 'https://api.datarecs.io/auth/oidc/exchange',
      tenantId: 'abcdef0123456789',
    },
  );
});

test('rejects unsafe API URLs before requesting a GitHub token', () => {
  for (const apiUrl of [
    'http://api.datarecs.io',
    'https://user:password@api.datarecs.io',
    'https://api.datarecs.io/tenant-a',
    'https://api.datarecs.io?redirect=evil',
    'not-a-url',
  ]) {
    assert.throws(() => buildAuthRequest(apiUrl, 'acme', 'abcdef0123456789'));
  }
});

test('rejects ambiguous tenant boundaries', () => {
  for (const slug of ['Acme', '-acme', 'acme-', 'acme/path', 'acme.example']) {
    assert.throws(() => buildAuthRequest('https://api.datarecs.io', slug, 'abcdef0123456789'));
  }

  for (const tenantId of [
    '',
    'ABCDEF0123456789',
    'abcdef012345678',
    'abcdef01234567890',
    'abcdef01-23456789',
    'abcdef0123456789; DROP SCHEMA tenant_victim CASCADE; --',
  ]) {
    assert.throws(() => buildAuthRequest('https://api.datarecs.io', 'acme', tenantId));
  }
});

test('accepts only a complete Bearer token response with a positive finite expiry', () => {
  const expected = { access_token: 'token-value', token_type: 'Bearer', expires_in: 3600 };
  assert.deepEqual(parseTokenExchangeResponse(expected), expected);

  for (const response of [
    null,
    {},
    { access_token: '', token_type: 'Bearer', expires_in: 3600 },
    { access_token: 'token-value', token_type: 'bearer', expires_in: 3600 },
    { access_token: 'token-value', token_type: 'Bearer', expires_in: 0 },
    { access_token: 'token-value', token_type: 'Bearer', expires_in: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => parseTokenExchangeResponse(response));
  }
});

test('rejects redirects without forwarding the OIDC token body to another origin', async () => {
  let redirectedRequests = 0;
  let redirectedBody = '';
  const redirectTarget = http.createServer((request, response) => {
    redirectedRequests += 1;
    request.setEncoding('utf8');
    request.on('data', (chunk) => { redirectedBody += chunk; });
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"access_token":"stolen","token_type":"Bearer","expires_in":3600}');
    });
  });
  const targetPort = await listen(redirectTarget);

  const exchangeServer = http.createServer((_request, response) => {
    response.writeHead(307, {
      Location: `http://127.0.0.1:${targetPort}/capture`,
    });
    response.end();
  });
  const exchangePort = await listen(exchangeServer);

  try {
    await assert.rejects(
      requestTokenExchange(
        `http://127.0.0.1:${exchangePort}/auth/oidc/exchange`,
        'github-oidc-subject-token-canary',
        'abcdef0123456789',
      ),
    );
    assert.equal(redirectedRequests, 0);
    assert.equal(redirectedBody, '');
  } finally {
    await Promise.all([close(exchangeServer), close(redirectTarget)]);
  }
});
