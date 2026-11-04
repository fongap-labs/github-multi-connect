# MCP Hub source Environment staging deployment

## Responsibility boundary

Action Worker remains the authority for PR Governance, CI Evidence and Main Write Guard. The manual source-repository workflow checks GitHub status evidence plus the successful control workflow runs, but cannot independently validate the control-plane HMAC without receiving the global signing secret. These checks add protection and are not a replacement for central governance.

The only deployment workflow is `.github/workflows/deploy-mcp-hub.yml`. It runs only when manually dispatched on `main`, limits the environment to `mcp-hub-staging`, and performs an additional source SHA and central status check before using any credentials. The old Action Worker cross-repository source-script deploy context is denied by `scripts/deploy.sh`.

## GitHub configuration

Configure in `fongap-labs/mcp-hub` → Settings → Environments → `mcp-hub-staging`:

| Type | Name | Example/description |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID_SECONDARY` | Secondary account ID |
| Variable | `MCP_D1_ID` | UUID of physical `mcp-hub` D1 database |
| Variable | `MCP_PUBLIC_URL` | `https://mcp.135468.xyz` |
| Variable | `MCP_ACTIVE_ID` | Existing encrypted keyring active ID, e.g. `v1` |
| Variable | `MCP_OAUTH_TTL` | `900` |
| Variable | `GMC_WRITE_MODE` | `disabled` |
| Variable | `GMC_CONTENT_MODE` | `disabled` |
| Secret | `CLOUDFLARE_API_TOKEN_SECONDARY` | Cloudflare least-privilege deploy credential |
| Secret | `MCP_ADMIN_KEY` | Admin login key |
| Secret | `MCP_APPROVAL_KEY` | Browser OAuth approval key |
| Secret | `MCP_COOKIE_KEY` | Admin cookie signer |
| Secret | `MCP_KEYRING_JSON` | Preserve actual existing AES keyring bytes |
| Secret | `MCP_INGEST_JWK` | Preserve actual existing RSA private key bytes |

Protect the GitHub Environment with required reviewers and limit branch access to `main`. Keep encrypted offline backups of the keyring and JWK. Never paste runtime secrets into Action Worker or source control. The deploy step uses a temporary mode-0600 JSON file, passed to Wrangler with `--secrets-file`, and removes it after use. All npm installation and tests happen in steps without runtime secrets.

## Deployment order

1. Confirm current `main` has successful Action Worker `CI Evidence` and `Main Write Guard` results.
2. Confirm `mcp.135468.xyz` belongs to the selected Cloudflare account and the old `workers.dev`/preview URLs remain disabled.
3. Create `mcp-hub` D1 and migrate existing encrypted data with a tested recovery path. Preserve keyring and private JWK. Do not delete old D1.
4. Configure Variables and Environment Secrets above, including review protections.
5. In this repository, open Actions → Deploy MCP Hub (manual staging), select `main` and `mcp-hub-staging`, and run. Review the GitHub Environment deployment before approving.
6. The workflow verifies exact main SHA, status origin, central workflow run, and prior merge; validates tests; then runs Wrangler dry run, D1 migrations, Worker deployment, and health/OAuth checks on `/` and `/github`.
7. Failed health checks attempt Worker code rollback only. D1 migrations are not rolled back. Record migration and release provenance before considering a production environment.

**Deployment is not automatic.** Workflow code merged into GitHub does not create a Cloudflare database, set environment values, or deploy anything. Both `GMC_WRITE_MODE` and `GMC_CONTENT_MODE` remain disabled by default.
