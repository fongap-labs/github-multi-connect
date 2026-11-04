#!/usr/bin/env bash
# Trusted CI control invoked by fongap-labs/action-worker.
set -Eeuo pipefail
TARGET_ROOT="${1:-}"
if [[ -z "$TARGET_ROOT" || ! -d "$TARGET_ROOT" ]]; then
  echo 'central-ci: target checkout path is required' >&2
  exit 64
fi
cd "$TARGET_ROOT"
node --version
node --check src/index.js
node --check src/admin.js
node --check src/admin-ui.js
node --check src/brand.js
node --check src/crypto.js
node --check src/github.js
node --check src/mcp.js
node --check src/oauth.js
node --check src/tokens.js
node --check src/util.js
node --experimental-sqlite --test tests/*.test.js
