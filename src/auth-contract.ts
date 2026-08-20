export interface TokenExchangeResponse {
  access_token: string;
  expires_in: number;
  token_type: 'Bearer';
}

export interface AuthRequest {
  audience: string;
  exchangeUrl: string;
  tenantId: string;
}

const TENANT_ID_PATTERN = /^[a-f0-9]{16}$/;
const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate every operator-controlled value before requesting a GitHub OIDC
 * token. In particular, an invalid tenant boundary must fail before a token is
 * minted or sent over the network.
 */
export function buildAuthRequest(apiUrlInput: string, tenantSlug: string, tenantId: string): AuthRequest {
  let apiUrl: URL;
  try {
    apiUrl = new URL(apiUrlInput);
  } catch {
    throw new Error('api-url must be a valid absolute HTTPS URL');
  }

  if (apiUrl.protocol !== 'https:') {
    throw new Error('api-url must use HTTPS');
  }
  if (apiUrl.username || apiUrl.password) {
    throw new Error('api-url must not contain embedded credentials');
  }
  if (apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) {
    throw new Error('api-url must be an origin without a path, query, or fragment');
  }
  if (!TENANT_SLUG_PATTERN.test(tenantSlug)) {
    throw new Error('tenant-slug must be a lowercase DNS label');
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error('tenant-id must be exactly 16 lowercase hexadecimal characters');
  }

  return {
    audience: `${apiUrl.origin}/${tenantSlug}`,
    exchangeUrl: `${apiUrl.origin}/auth/oidc/exchange`,
    tenantId,
  };
}

/**
 * Treat the exchange response as untrusted input. A malformed 2xx response
 * must never result in an undefined, unbounded, or non-Bearer value being
 * exported as a credential.
 */
export function parseTokenExchangeResponse(value: unknown): TokenExchangeResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('DataRecs token exchange returned an invalid response');
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.access_token !== 'string' || candidate.access_token.length === 0) {
    throw new Error('DataRecs token exchange response did not contain an access token');
  }
  if (candidate.token_type !== 'Bearer') {
    throw new Error('DataRecs token exchange response did not contain a Bearer token');
  }
  if (typeof candidate.expires_in !== 'number' || !Number.isFinite(candidate.expires_in) || candidate.expires_in <= 0) {
    throw new Error('DataRecs token exchange response contained an invalid expiry');
  }

  return candidate as unknown as TokenExchangeResponse;
}
