#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PREFERRED_NODE_BIN="${OPENCLAW_NODE_BIN:-/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/bin/node}"
PREFERRED_NPM_CLI="${OPENCLAW_NPM_CLI:-/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/lib/node_modules/npm/bin/npm-cli.js}"

if [ -x "$PREFERRED_NODE_BIN" ] && [ -f "$PREFERRED_NPM_CLI" ]; then
  NODE_BIN="$PREFERRED_NODE_BIN"
  NPM_CLI="$PREFERRED_NPM_CLI"
else
  NODE_BIN="$(command -v node)"
  if [ -z "$NODE_BIN" ]; then
    echo "[openclaw-office] 找不到 node" >&2
    exit 1
  fi
  NPM_CLI="$(npm root -g 2>/dev/null)/npm/bin/npm-cli.js"
  if [ ! -f "$NPM_CLI" ]; then
    NPM_BIN="$(command -v npm || true)"
    if [ -z "$NPM_BIN" ]; then
      echo "[openclaw-office] 找不到 npm" >&2
      exit 1
    fi
    cd "$PROJECT_ROOT"
    "$NPM_BIN" run rebuild:native
    exec "$NPM_BIN" run build:raw
  fi
fi

export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:$PATH"

cd "$PROJECT_ROOT"
"$NODE_BIN" "$NPM_CLI" run rebuild:native
exec "$NODE_BIN" "$NPM_CLI" run build:raw
