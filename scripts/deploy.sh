#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
: "${RUNNER_TEMP:?Central Action Worker deploy runner is required}"
: "${DEPLOY_SOURCE_SHA:?Missing immutable source SHA}"
: "${DEPLOY_ENVIRONMENT:?Missing approved deployment environment}"

# The trusted deployment job must execute in this repository to access
# its own GitHub Environment Secrets. The old central source-script job
# cannot read those Secrets and must fail closed.
if [[ "${GITHUB_REPOSITORY:-}" != "fongap-labs/mcp-hub" || "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo '::error::MCP Hub deploy requires the governed mcp-hub main-branch execution context.' >&2
  exit 77
fi
if [[ "${GITHUB_SHA:-}" != "$DEPLOY_SOURCE_SHA" ]]; then
  echo '::error::Deployment SHA does not match the source workflow checkout.' >&2
  exit 77
fi

work="$(mktemp -d "${RUNNER_TEMP}/mcp-hub-deploy.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
config="$work/wrangler.jsonc"

npm install --ignore-scripts --no-audit --no-fund
npm run validate
node scripts/deployment-config.mjs preflight
node scripts/deployment-config.mjs prepare "$config"

wrangler() { node scripts/with-secondary-cloudflare.mjs "$@"; }
wrangler deploy --dry-run --outdir "$work/build" --config "$config"
# D1 migrations are additive and NOT reverted by a Worker rollback.
wrangler d1 migrations apply mcp-hub --remote --config "$config" --yes
wrangler deploy --config "$config"

healthy=false
for attempt in 1 2 3; do
  if node scripts/deployment-config.mjs health-check; then
    healthy=true
    break
  fi
  if [ "$attempt" -lt 3 ]; then sleep 5; fi
done
if [ "$healthy" != true ]; then
  echo 'Worker verification failed; attempting code-only rollback (D1 is not rolled back).' >&2
  if ! wrangler rollback --yes --config "$config"; then
    echo 'Automatic Worker rollback failed or no prior version exists; manual recovery required.' >&2
  fi
  exit 1
fi

echo "MCP Hub deployment passed checks for commit $DEPLOY_SOURCE_SHA"
