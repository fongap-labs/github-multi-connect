# MCP Hub migration and deployment safety

## Target identities

- Repository: `fongap-labs/mcp-hub` (renamed from `fongap-labs/github-multi-connect`).
- Cloudflare Worker: `mcp-hub`; Custom Domain: `mcp.135468.xyz`.
- Cloudflare D1: physical name `mcp-hub`, application binding `MCP_DB`, UUID in `MCP_D1_ID`.
- Root MCP: `https://mcp.135468.xyz`; GitHub MCP: `https://mcp.135468.xyz/github`.
- Shared administration and OAuth: `/admin`, `/authorize`, `/oauth/*`, `/.well-known/*`.
- Platform config and Secrets use `MCP_*`; GitHub-only switches retain `GMC_WRITE_MODE` and `GMC_CONTENT_MODE`.
- Staging Environment: `mcp-hub-staging` in the **source** GitHub repository.

## D1 is a separate data resource

Renaming a GitHub repository does not rename D1, Workers, GitHub Environments or Cloudflare Custom Domains. D1 database identity cannot be changed simply by writing another name next to its existing UUID.

**For a new, unused installation:** create a `mcp-hub` D1 database in the intended SECONDARY Cloudflare account. Save the actual UUID as `MCP_D1_ID`; apply only the checked-in migrations.

**If an existing D1 may contain GitHub Token ciphertext or OAuth records:**

1. Freeze credential writes and export/backup the existing `github-multi-connect` database before any migration. Keep it and its original ID unchanged.
2. Create a separate `mcp-hub` database. Verify table structure and migrate/export-import records into this new database with an audited, encrypted transfer. Do not point a new database name at an old UUID without checking the actual resource.
3. Preserve the actual values of AES keyring (`GMC_KEYRING_JSON` → `MCP_KEYRING_JSON`) and browser private JWK (`GMC_INGEST_JWK` → `MCP_INGEST_JWK`). Renaming the environment variable must not change its secret material.
4. Compare row counts and decrypt a known test connection before switching traffic. Do not delete the source database until a reviewed retention and recovery period ends.
5. Old OAuth grants, Access Tokens and Refresh Tokens contain the old URL as `resource`; they must **not** silently inherit permission to the new origin. Require fresh client authorization at each new resource URI.

## Security and CI prerequisites

All runtime secrets belong in `fongap-labs/mcp-hub` → Settings → Environments → `mcp-hub-staging`, not in Action Worker. `CLOUDFLARE_ACCOUNT_ID_SECONDARY` belongs in Variables; `CLOUDFLARE_API_TOKEN_SECONDARY` is a Secret.

A deployment job in `fongap-labs/action-worker` cannot directly read another repository's Environment Secrets. The source-context job and central status attestation must be implemented and reviewed separately; the old central deploy entrypoint must fail closed until then. **Do not deploy by copying or downgrading a runtime Secret.**

Verify that Action Worker `AW_REPOSITORY_POLICY` includes the **renamed** repository, and that the GitHub App installation and `AW_DISPATCH_TOKEN` cover it. The central `policies/deploy-*.json` entries must be updated to the new repository name and `mcp-hub-staging`. CI Evidence, PR Governance, validate-merge and Main Write Guard must all pass at the exact commit being deployed.

Deploy only after confirming ownership of the `135468.xyz` Cloudflare Zone and absence of conflicting DNS records for `mcp.135468.xyz`. Keep `workers_dev: false` and `preview_urls: false`; both configurations and health checks must reject the old `*.workers.dev` default.

This PR changes code and governance only; it does not mutate Cloudflare D1 resources, provision environment secrets, or automatically deploy.
