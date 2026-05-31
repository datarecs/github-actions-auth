import * as core from '@actions/core';

interface TokenExchangeResponse {
  access_token: string;
  expires_in: number;
  token_type: 'Bearer';
}

interface TokenExchangeError {
  error_code: string;
  message: string;
}

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('api-url', { required: false }) || 'https://api.datarecs.io';
    const audienceInput = core.getInput('audience', { required: false });
    const audience = audienceInput || apiUrl;
    const tenantId = core.getInput('tenant-id', { required: true });

    core.info('Requesting OIDC token from GitHub Actions runtime...');
    const subjectToken = await core.getIDToken(audience);

    core.info(`Exchanging OIDC token with DataRecs STS at ${apiUrl}...`);
    const exchangeUrl = `${apiUrl.replace(/\/+$/, '')}/auth/oidc/exchange`;

    const response = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject_token: subjectToken,
        tenant_id: tenantId,
      }),
    });

    if (!response.ok) {
      let errorCode = `HTTP_${response.status}`;
      let errorMessage = `Token exchange failed with status ${response.status}`;

      try {
        const errorBody = (await response.json()) as TokenExchangeError;
        if (errorBody.error_code) {
          errorCode = errorBody.error_code;
        }
        if (errorBody.message) {
          errorMessage = errorBody.message;
        }
      } catch {
        // Response body wasn't valid JSON; use defaults
      }

      core.setFailed(`${errorCode}: ${errorMessage}`);
      return;
    }

    const data = (await response.json()) as TokenExchangeResponse;
    const accessToken = data.access_token;

    core.setSecret(accessToken);
    core.setOutput('access-token', accessToken);
    core.exportVariable('DATARECS_TOKEN', accessToken);

    core.info('Successfully authenticated to DataRecs.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
  }
}

run();
