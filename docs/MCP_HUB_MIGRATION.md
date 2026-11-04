# MCP Hub migration and deployment safety

## Target identities

- Repository: `fongap-labs/mcp-hub` (renamed from `fongap-labs/github-multi-connect`).
- Cloudflare Worker: `mcp-hub`; Custom Domain: `mcp.135468.xyz`.
- Cloudflare D1: physical name `mcp-hub`, application binding `MCP_DB`, UUID in `MCP_D1_ID`.
- Root MCP: `https://mcp.135468.xyz`; GitHub MCP: `https://mcp.135468.xyz/github`.
- Shared administration and OAuth: `/admin`, `/authorize`, `/oauth/*`, `/.well-known/*`.
- Platform config and Secrets use `MCP_*`; GitHub-only switches retain `GMC_WRITE_MODE` and `GMC_CONTENT_MODE`.
- Staging Environment: `mcp-hub-staging` in the **Action Worker** GitHub repository.

## D1 is a separate data resource

Renaming a GitHub repository does not rename D1, Workers, GitHub Environments or Cloudflare Custom Domains. D1 database identity cannot be changed simply by writing another name next to its existing UUID.

**For a new, unused installation:** create a `mcp-hub` D1 database in the intended SECONDARY Cloudflare account. Save the actual UUID as `MCP_D1_ID`; apply only the checked-in migrations.

**If an existing D1 may contain GitHub Token ciphertext or OAuth records:**

1. Freeze credential writes and export/backup the existing `github-multi-connect` database before any migration. Keep it and its original ID unchanged.
2. Create a separate `mcp-hub` database. Verify table structure and migrate/export-import records into this new database with an audited, encrypted transfer. Do not point a new database name at an old UUID without checking the actual resource.
3. Preserve the actual values of AES keyring (`GMC_KEYRING_JSON` → `MCP_KEYRING_JSON`) and browser private JWK (`GMC_INGEST_JWK` → `MCP_INGEST_JWK`). Renaming the environment variable must not change its secret material.
4. Compare row counts and decrypt a known test connection before switching traffic. Do not delete the source database until a reviewed retention and recovery period ends.
5. Old OAuth grants, Access Tokens and Refresh Tokens contain the old URL as `resource`; they must **not** silently inherit permission to the new origin. Require fresh client authorization at each new resource URI.

## Action Worker central deployment

MCP Hub is deployed only by the **same Action Worker source-script workflow as AI Gateway**, through [手动 · 部署服务](https://github.com/fongap-labs/action-worker/actions/workflows/deploy-source-script.yml). There is no independent MCP Hub deploy workflow. Action Worker validates the current main SHA, signed CI Evidence, Main Write Guard and central environment/runner policies before checking out and running the reviewed source script.

Source-repository Environment Secrets cannot be read by an Action Worker job. Configure the same original AES keyring/JWK and three other runtime Secrets as **Action Worker** Environment Secrets in `mcp-hub-staging`. Keep an offline backup. The `CLOUDFLARE_API_TOKEN_SECONDARY` stays in Action Worker Secrets and `CLOUDFLARE_ACCOUNT_ID_SECONDARY` stays in Action Worker Variables; no fallback token and no credential values in source control. Central Secret policy allows exactly six Secrets.

Check that `AW_REPOSITORY_POLICY` enables `fongap-labs/mcp-hub` and that `policies/deploy-environments.json` and `policies/deploy-secrets.json` approve only the intended staging scope. Do not deploy until `135468.xyz` is in the correct Cloudflare account, D1 backup/migration is verified, and no conflicting DNS record exists. Keep `workers_dev: false` and `preview_urls: false`. Worker rollback does not undo D1 schema/data migration.

This change does not mutate Cloudflare databases, import secrets or deploy the Worker.
