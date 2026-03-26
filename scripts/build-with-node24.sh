#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="${OPENCLAW_NODE_BIN:-/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/bin/node}"
NPM_CLI="${OPENCLAW_NPM_CLI:-/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/lib/node_modules/npm/bin/npm-cli.js}"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "[openclaw-office] 找不到固定 Node 24：$NODE_BIN" >&2
  exit 1
fi

if [[ ! -f "$NPM_CLI" ]]; then
  echo "[openclaw-office] 找不到 npm-cli.js：$NPM_CLI" >&2
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:$PATH"

cd "$PROJECT_ROOT"
exec "$NODE_BIN" "$NPM_CLI" run build:raw
