import * as core from '@actions/core';
import { buildAuthRequest, parseTokenExchangeResponse, requestTokenExchange } from './auth-contract';

interface TokenExchangeError {
  error_code: string;
  message: string;
}

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('api-url', { required: false }) || 'https://api.datarecs.io';
    const tenantSlug = core.getInput('tenant-slug', { required: true });
    const tenantId = core.getInput('tenant-id', { required: true });

    // OIDC Audience Convention (R7.1):
    // The audience MUST be `https://<api-host>/<tenant-slug>`.
    // The edge router (Cloudflare Worker) parses this audience to resolve the Tenant_Slug and
    // route the request to the correct Cell WITHOUT verifying the JWT signature (R7.5).
    // The Cell performs full cryptographic verification and cross-checks the slug in `aud`
    // against the trusted X-Datarecs-Tenant-Slug header injected by the edge (R7.3).
    const authRequest = buildAuthRequest(apiUrl, tenantSlug, tenantId);

    core.info('Requesting OIDC token from GitHub Actions runtime...');
    const subjectToken = await core.getIDToken(authRequest.audience);

    core.info(`Exchanging OIDC token with DataRecs STS at ${new URL(authRequest.exchangeUrl).origin}...`);

    const response = await requestTokenExchange(
      authRequest.exchangeUrl,
      subjectToken,
      authRequest.tenantId,
    );

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

    const data = parseTokenExchangeResponse(await response.json());
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
