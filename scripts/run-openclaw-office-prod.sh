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

export PATH="$(dirname "$NODE_BIN"):/Users/brian/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/Users/brian/.local/bin:/Users/brian/.npm-global/bin:$PATH"
export NODE_ENV=production
# 穩定優先：避免 gateway websocket 流量拖垮 Office HTTP 回應
export OPENCLAW_OFFICE_DISABLE_GATEWAY="${OPENCLAW_OFFICE_DISABLE_GATEWAY:-1}"

cd "$PROJECT_ROOT"

ensure_clawx_operator_ingress_patch() {
  "$NODE_BIN" /Users/brian/.openclaw/scripts/apply-clawx-discord-operator-ingress-patch.mjs
}

ensure_native_runtime() {
  if ! "$NODE_BIN" -e "require('better-sqlite3')" >/dev/null 2>&1; then
    echo "[openclaw-office] better-sqlite3 與目前 Node 不相容，改用 Node 24 重新編譯..."
    "$NPM_BIN" run rebuild:native
  fi
}

ensure_build_runtime() {
  local build_id_path="$PROJECT_ROOT/.next/BUILD_ID"
  local required_paths=(
    "$PROJECT_ROOT/.next/server/app/research/page.js"
    "$PROJECT_ROOT/.next/server/app/api/autoresearch/route.js"
    "$PROJECT_ROOT/.next/server/app/writer/page.js"
  )

  if [[ ! -f "$build_id_path" ]]; then
    echo "[openclaw-office] 找不到 production build，先重建..."
    "$NPM_BIN" run build
    return
  fi

  local missing=0
  local path
  for path in "${required_paths[@]}"; do
    if [[ ! -f "$path" ]]; then
      echo "[openclaw-office] 缺少 build 產物：$path"
      missing=1
    fi
  done

  if [[ "$missing" -eq 1 ]]; then
    echo "[openclaw-office] production build 不完整，先重建..."
    "$NPM_BIN" run build
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

wait_for_port_release() {
  local port="$1"
  local deadline=$((SECONDS + 12))

  while "$LSOF_BIN" -nP -iTCP:"$port" -sTCP:LISTEN -t 1>/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "[openclaw-office] port $port 仍被占用，放棄這次 launchd 重啟。"
      return 1
    fi
    sleep 1
  done

  return 0
}

if [[ "${OPENCLAW_FORCE_LOCAL:-0}" != "1" ]]; then
  PORT_TO_CHECK="$(resolve_port)"
  if "$LSOF_BIN" -nP -iTCP:"$PORT_TO_CHECK" -sTCP:LISTEN -t 1>/dev/null 2>&1; then
    if [[ "${XPC_SERVICE_NAME:-}" = "ai.openclaw.office" ]]; then
      echo "[openclaw-office] port $PORT_TO_CHECK still bound during launchd restart. waiting for release..."
      if ! wait_for_port_release "$PORT_TO_CHECK"; then
        exit 0
      fi
    else
      echo "[openclaw-office] port $PORT_TO_CHECK already bound. skip host startup."
      exit 0
    fi
  fi
fi

ensure_native_runtime
ensure_build_runtime
ensure_clawx_operator_ingress_patch || echo "[openclaw-office] clawx patch skipped (ClawX.app not present)"

exec "$NODE_BIN" start.js
