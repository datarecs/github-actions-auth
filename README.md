# DataRecs GitHub Actions Auth

A GitHub Action that exchanges a GitHub Actions OIDC token for a short-lived DataRecs access token using keyless OIDC federation.

## OIDC Audience Convention

The OIDC token audience **must** be `https://api.datarecs.io/<tenant-slug>` (R7.1).

This action constructs the audience automatically from the `api-url` and `tenant-slug` inputs:

```
audience = https://<api-url-host>/<tenant-slug>
         = https://api.datarecs.io/acme
```

**Why the slug, not the tenant ID?**

The edge router (Cloudflare Worker) parses the `aud` claim to resolve the Tenant_Slug and route the
request to the correct Cell **without verifying the JWT signature** (R7.5 — signature verification
is the Cell's responsibility). The slug is the routing key for the OIDC flow, just as it is for
subdomain routing and the tenant-first login flow.

The Cell (`core-api`) performs full cryptographic verification:
1. JWT signature (GitHub JWKS)
2. Issuer (`https://token.actions.githubusercontent.com`)
3. Audience — the `aud` claim must encode `https://api.datarecs.io/<tenant-slug>` and the slug
   must match the tenant resolved from the request (cross-checked against the trusted
   `X-Datarecs-Tenant-Slug` header injected by the edge router)
4. Claim conditions configured on the OIDC Connector

A token with a mismatched audience (wrong slug, wrong host, or wrong format) is rejected by the
Cell with `AUDIENCE_SLUG_MISMATCH` (fail closed — AGENTS.md Priority 1: tenant isolation).

## Prerequisites

Your GitHub Actions workflow **must** have the `id-token: write` permission to request OIDC tokens from the GitHub Actions runtime. Without this permission, the action will fail.

```yaml
permissions:
  id-token: write
```

You must also have an OIDC Connector configured in your DataRecs tenant that:
- Has `https://token.actions.githubusercontent.com` as the issuer URL
- Has the audience value `https://api.datarecs.io/<your-tenant-slug>` (matching the convention above)
- Has claim conditions that match your repository and workflow context

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-url` | No | `https://api.datarecs.io` | DataRecs API base URL. Must be `datarecs.io` or a `datarecs.io` subdomain. |
| `tenant-slug` | Yes | — | Your DataRecs tenant slug (e.g. `acme`). Used to construct the OIDC audience as `https://api.datarecs.io/<tenant-slug>`. |
| `tenant-id` | Yes | — | Your DataRecs tenant ID (16 lowercase hexadecimal characters). Sent in the exchange request body for tenant resolution. |

## Outputs

| Output | Description |
|--------|-------------|
| `access-token` | Short-lived DataRecs access token (masked in logs) |

The action also sets the `DATARECS_TOKEN` environment variable for use in subsequent steps.

## Usage

```yaml
name: Deploy with DataRecs
on: push

permissions:
  id-token: write
  contents: read

jobs:
  reconcile:
    runs-on: ubuntu-latest
    steps:
      - name: Authenticate to DataRecs
        uses: datarecs/github-actions-auth@v1
        with:
          tenant-slug: 'acme'
          tenant-id: 'a3f9c1b20e4d8f7a'

      - name: Use DataRecs API
        run: |
          curl -H "Authorization: Bearer $DATARECS_TOKEN" \
            https://api.datarecs.io/connectors/oidc
```

### Using the access token output

```yaml
      - name: Authenticate to DataRecs
        id: auth
        uses: datarecs/github-actions-auth@v1
        with:
          tenant-slug: 'acme'
          tenant-id: 'a3f9c1b20e4d8f7a'

      - name: Use token from output
        run: |
          curl -H "Authorization: Bearer ${{ steps.auth.outputs.access-token }}" \
            https://api.datarecs.io/connectors/oidc
```

### Custom API URL (staging / self-hosted)

```yaml
      - name: Authenticate to DataRecs (staging)
        uses: datarecs/github-actions-auth@v1
        with:
          api-url: 'https://api.staging.datarecs.io'
          tenant-slug: 'acme'
          tenant-id: 'a3f9c1b20e4d8f7a'
```

The audience will be constructed as `https://api.staging.datarecs.io/acme`. Ensure your OIDC
Connector's audience field matches this value.

## How It Works

1. The action constructs the OIDC audience as `https://<api-url-host>/<tenant-slug>`.
2. It requests an OIDC token from the GitHub Actions runtime using that audience.
3. It sends a `POST` request to `{api-url}/auth/oidc/exchange` with the OIDC token and tenant ID.
4. The edge router parses the `aud` claim to route the request to the correct Cell (no signature
   verification at the edge — R7.5).
5. The Cell's `core-api` verifies the JWT signature (GitHub JWKS), issuer, audience slug, and
   claim conditions, then returns a short-lived access token.
6. The access token is masked in logs, set as the `access-token` output, and exported as the
   `DATARECS_TOKEN` environment variable.

## Error Handling

If the token exchange fails, the action will fail the workflow step with the error code and message from the DataRecs STS. Common errors:

| Error Code | Description |
|------------|-------------|
| `INVALID_TENANT` | The specified tenant ID was not found |
| `ISSUER_NOT_CONFIGURED` | No OIDC connector is configured for GitHub Actions in the specified tenant |
| `AUDIENCE_SLUG_MISMATCH` | The token audience slug does not match the resolved tenant (wrong slug or wrong audience format) |
| `AUDIENCE_MISMATCH` | The token audience does not match the connector's configured audience |
| `CLAIM_CONDITION_FAILED` | A claim condition on the connector did not match (e.g., wrong repository or branch) |
| `INVALID_SIGNATURE` | The OIDC token signature could not be verified |
| `TOKEN_EXPIRED` | The OIDC token has expired |

## Security

- The access token is automatically masked in GitHub Actions logs via `core.setSecret()`.
- Tokens are short-lived (1 hour) and scoped to the permissions defined in your OIDC Connector.
- No long-lived secrets or API keys are required.
- The audience convention (`https://api.datarecs.io/<slug>`) ensures the token is scoped to a
  specific tenant. A token minted for one tenant cannot be used to authenticate to another tenant's
  Cell — the Cell rejects it with `AUDIENCE_SLUG_MISMATCH`.

## License

MIT
