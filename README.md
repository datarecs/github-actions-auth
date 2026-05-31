# DataRecs GitHub Actions Auth

A GitHub Action that exchanges a GitHub Actions OIDC token for a short-lived DataRecs access token using keyless OIDC federation.

## Prerequisites

Your GitHub Actions workflow **must** have the `id-token: write` permission to request OIDC tokens from the GitHub Actions runtime. Without this permission, the action will fail.

```yaml
permissions:
  id-token: write
```

You must also have an OIDC Connector configured in your DataRecs tenant that:
- Has `https://token.actions.githubusercontent.com` as the issuer URL
- Has the correct audience value matching your tenant (e.g., `https://api.datarecs.io/<tenant-id>`)
- Has claim conditions that match your repository and workflow context

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-url` | No | `https://api.datarecs.io` | DataRecs API base URL |
| `audience` | Yes | — | OIDC token audience (should include your tenant ID, e.g., `https://api.datarecs.io/<tenant-id>`) |
| `tenant-id` | Yes | — | Your DataRecs tenant ID |

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
          audience: 'https://api.datarecs.io/tenant-abc123'
          tenant-id: 'tenant-abc123'

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
          audience: 'https://api.datarecs.io/tenant-abc123'
          tenant-id: 'tenant-abc123'

      - name: Use token from output
        run: |
          curl -H "Authorization: Bearer ${{ steps.auth.outputs.access-token }}" \
            https://api.datarecs.io/connectors/oidc
```

### Custom API URL

For self-hosted or staging environments:

```yaml
      - name: Authenticate to DataRecs (staging)
        uses: datarecs/github-actions-auth@v1
        with:
          api-url: 'https://api.staging.datarecs.io'
          audience: 'https://api.staging.datarecs.io/tenant-abc123'
          tenant-id: 'tenant-abc123'
```

## How It Works

1. The action requests an OIDC token from the GitHub Actions runtime using the configured `audience` value.
2. It sends a `POST` request to `{api-url}/auth/oidc/exchange` with the OIDC token and tenant ID.
3. The DataRecs STS validates the token signature, checks claim conditions against your OIDC Connector configuration, and returns a short-lived access token.
4. The access token is masked in logs, set as the `access-token` output, and exported as the `DATARECS_TOKEN` environment variable.

## Error Handling

If the token exchange fails, the action will fail the workflow step with the error code and message from the DataRecs STS. Common errors:

| Error Code | Description |
|------------|-------------|
| `INVALID_TENANT` | The specified tenant ID was not found |
| `ISSUER_NOT_CONFIGURED` | No OIDC connector is configured for GitHub Actions in the specified tenant |
| `AUDIENCE_MISMATCH` | The token audience does not match the connector configuration |
| `CLAIM_CONDITION_FAILED` | A claim condition on the connector did not match (e.g., wrong repository or branch) |
| `INVALID_SIGNATURE` | The OIDC token signature could not be verified |
| `TOKEN_EXPIRED` | The OIDC token has expired |

## Security

- The access token is automatically masked in GitHub Actions logs via `core.setSecret()`.
- Tokens are short-lived (1 hour) and scoped to the permissions defined in your OIDC Connector.
- No long-lived secrets or API keys are required.

## License

MIT
