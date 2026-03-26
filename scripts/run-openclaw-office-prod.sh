#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
PORT_TO_CHECK=4201
LSOF_BIN="/usr/sbin/lsof"
FNM_NODE_BIN="/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/bin/node"
FNM_NPM_BIN="/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/bin/npm"
NODE_BIN="${OPENCLAW_NODE_BIN:-$FNM_NODE_BIN}"
NPM_BIN="${OPENCLAW_NPM_BIN:-$FNM_NPM_BIN}"

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="/opt/homebrew/bin/node"
fi

if [[ ! -x "$NPM_BIN" ]]; then
  NPM_BIN="/opt/homebrew/bin/npm"
fi

export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/Users/brian/.local/bin:/Users/brian/.npm-global/bin:$PATH"
export NODE_ENV=production

cd "$PROJECT_ROOT"

ensure_native_runtime() {
  if ! "$NODE_BIN" -e "require('better-sqlite3')" >/dev/null 2>&1; then
    echo "[openclaw-office] better-sqlite3 與目前 Node 不相容，改用 Node 24 重新編譯..."
    "$NPM_BIN" run rebuild:native
  fi
}

resolve_port() {
  if [[ -n "${PORT:-}" ]]; then
    printf '%s\n' "$PORT"
    return
  fi

  local config_path="$PROJECT_ROOT/openclaw-office.config.json"
  if [[ -f "$config_path" ]]; then
    local configured_port=""
    configured_port="$(python3 - "$config_path" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    value = payload.get("deployment", {}).get("port") or payload.get("port") or 4201
    print(int(value))
except Exception:
    print(4201)
PY
)"
    printf '%s\n' "$configured_port"
    return
  fi

  printf '%s\n' "4201"
}

if [[ "${OPENCLAW_FORCE_LOCAL:-0}" != "1" ]]; then
  PORT_TO_CHECK="$(resolve_port)"
  if "$LSOF_BIN" -nP -iTCP:"$PORT_TO_CHECK" -sTCP:LISTEN -t 1>/dev/null 2>&1; then
    echo "[openclaw-office] port $PORT_TO_CHECK already bound. skip host startup."
    exit 0
  fi
fi

if [[ ! -f ".next/BUILD_ID" ]]; then
  "$NPM_BIN" run build
fi

ensure_native_runtime

exec "$NODE_BIN" start.js
