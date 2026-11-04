# MCP Hub central staging deployment

MCP Hub uses the same Action Worker `source-script` deployment workflow as AI Gateway; no source-owned deploy GitHub Actions workflow remains.

1. Configure Action Worker **Actions Variables**: `CLOUDFLARE_ACCOUNT_ID_SECONDARY`, `MCP_PUBLIC_URL=https://mcp.135468.xyz`, `MCP_D1_ID`, `MCP_ACTIVE_ID`, `MCP_OAUTH_TTL=900`, `GMC_WRITE_MODE=disabled`, `GMC_CONTENT_MODE=disabled`; verify `AW_REPOSITORY_POLICY` grants `fongap-labs/mcp-hub` deploy.
2. In Action Worker **Settings → Environments → mcp-hub-ops**, configure original values of `MCP_ADMIN_KEY`, `MCP_APPROVAL_KEY`, `MCP_COOKIE_KEY`, `MCP_KEYRING_JSON`, `MCP_INGEST_JWK`. Backup all encrypted keys offline. GitHub cannot read these from the old MCP Hub Environment.
3. Confirm `CLOUDFLARE_API_TOKEN_SECONDARY` exists in Action Worker Actions Secrets (no fallback); Cloudflare Account ID remains a Variable.
4. Confirm Cloudflare zone and D1 ID, safely migrate/back up any encrypted existing data, and retain the old D1 until recovery is verified.
5. Open **Action Worker → 手动 · 部署服务**, set `source_repository=fongap-labs/mcp-hub`, `environment=mcp-hub-ops`; leave `source_sha` and `product` empty, and disable Main Write Guard bypass.
6. Central validate → approve → checkout exact SHA → filter six Secrets → run `scripts/deploy.sh`: sanitized npm checks, temporary private Worker Secrets file, Wrangler dry run, D1 migrations, deploy and root/GitHub/OAuth/SHA health checks. Worker rollback does not undo D1 migration.

No automatic production deployment is enabled.
