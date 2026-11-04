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
# TypeScript is a development-only compiler; no extra runtime framework is shipped.
npm install --no-audit --no-fund --ignore-scripts
npm run validate
