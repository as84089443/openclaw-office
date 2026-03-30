#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PREFERRED_NODE_BIN="${OPENCLAW_NODE_BIN:-/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/bin/node}"
PREFERRED_NPM_CLI="${OPENCLAW_NPM_CLI:-/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/lib/node_modules/npm/bin/npm-cli.js}"

if [ -x "$PREFERRED_NODE_BIN" ]; then
  NODE_BIN="$PREFERRED_NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "[openclaw-office] 找不到 node" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "[openclaw-office] 用法：scripts/run-with-node24.sh <npm-args...>" >&2
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:$PATH"

cd "$PROJECT_ROOT"

if [ "$1" = "exec" ]; then
  shift
  if [ "$#" -gt 0 ] && [ "$1" = "--" ]; then
    shift
  fi
  if [ "$#" -eq 0 ]; then
    echo "[openclaw-office] exec 需要提供命令" >&2
    exit 1
  fi

  if [ "$1" = "node" ]; then
    shift
    exec "$NODE_BIN" "$@"
  fi

  exec env PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:$PATH" "$@"
fi

if [ -f "$PREFERRED_NPM_CLI" ] && [ "$NODE_BIN" = "$PREFERRED_NODE_BIN" ]; then
  exec "$NODE_BIN" "$PREFERRED_NPM_CLI" "$@"
fi

NPM_BIN="$(command -v npm || true)"
if [ -z "$NPM_BIN" ]; then
  echo "[openclaw-office] 找不到 npm" >&2
  exit 1
fi

exec "$NPM_BIN" "$@"
