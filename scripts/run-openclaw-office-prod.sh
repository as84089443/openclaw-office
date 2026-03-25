#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
PORT_TO_CHECK=4200
LSOF_BIN="/usr/sbin/lsof"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/Users/brian/.local/bin:/Users/brian/.npm-global/bin:$PATH"
export NODE_ENV=production

cd "$PROJECT_ROOT"

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
    value = payload.get("deployment", {}).get("port") or payload.get("port") or 4200
    print(int(value))
except Exception:
    print(4200)
PY
)"
    printf '%s\n' "$configured_port"
    return
  fi

  printf '%s\n' "4200"
}

if [[ "${OPENCLAW_FORCE_LOCAL:-0}" != "1" ]]; then
  PORT_TO_CHECK="$(resolve_port)"
  if "$LSOF_BIN" -nP -iTCP:"$PORT_TO_CHECK" -sTCP:LISTEN -t 1>/dev/null 2>&1; then
    echo "[openclaw-office] port $PORT_TO_CHECK already bound. skip host startup."
    exit 0
  fi
fi

if [[ ! -f ".next/BUILD_ID" ]]; then
  /opt/homebrew/bin/npm run build
fi

exec /opt/homebrew/bin/node start.js
