#!/bin/sh
set -euo pipefail

# Internal layer: compose bring-up only. Prefer selfhost-zero-touch-deploy.sh for operator use.

PROJECT_ROOT="${OPENCLAW_PROJECT_ROOT:-/Users/brian/.openclaw/openclaw-office}"
COMPOSE_FILE_A="${OPENCLAW_COMPOSE_A:-docker-compose.selfhost.yml}"
COMPOSE_FILE_B="${OPENCLAW_COMPOSE_B:-docker-compose.selfhost.public.yml}"
RUNTIME_ENV="${OPENCLAW_RUNTIME_ENV:-runtime/.env.production}"
RUNTIME_CLOUDFLARE_DIR="${OPENCLAW_RUNTIME_CLOUDFLARE_DIR:-./runtime/cloudflared}"
SKIP_PUBLIC="${OPENCLAW_SKIP_PUBLIC:-0}"
QUIET="${OPENCLAW_SELFHOST_QUIET:-0}"
PUBLIC_URL="${1:-${OFFICE_PUBLIC_URL:-https://copilot.bw-space.com}}"
PUBLIC_HEALTH_PATH="${OFFICE_PUBLIC_HEALTH_PATH:-/api/health}"
LOCAL_HEALTH_URL="${OFFICE_LOCAL_HEALTH_URL:-http://127.0.0.1:4200/api/health}"
LOCAL_OFFICE_URL="${OFFICE_LOCAL_OFFICE_URL:-http://127.0.0.1:4200/office}"
DELAY_SECONDS="${OPENCLAW_HEALTH_WAIT_SECONDS:-30}"

log() {
  if [ "$QUIET" != "1" ]; then
    printf '[openclaw-office] %s\n' "$1"
  fi
}

run_quiet_command() {
  label="$1"
  shift

  if [ "$QUIET" != "1" ]; then
    "$@"
    return
  fi

  mkdir -p /tmp/openclaw-selfhost-logs
  log_file="/tmp/openclaw-selfhost-logs/${label}-$(date +%Y%m%d%H%M%S).log"

  if "$@" >"$log_file" 2>&1; then
    return 0
  fi
  rc=$?
  {
    echo "[openclaw-office] command failed: $label" >&2
    echo "[openclaw-office] log: $log_file" >&2
    tail -n 80 "$log_file" >&2
  } || true
  return "$rc"
}

cd "$PROJECT_ROOT"

if [ ! -f "$RUNTIME_ENV" ]; then
  log "runtime env not found: $RUNTIME_ENV" >&2
  exit 1
fi

log "set FNB_PUBLIC_BASE_URL=$PUBLIC_URL"
python3 - "$RUNTIME_ENV" "$PUBLIC_URL" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
value = sys.argv[2]
lines = path.read_text().splitlines()
updated = False

for i, line in enumerate(lines):
    if line.startswith("FNB_PUBLIC_BASE_URL="):
        lines[i] = f"FNB_PUBLIC_BASE_URL={value}"
        updated = True
        break

if not updated:
    lines.append(f"FNB_PUBLIC_BASE_URL={value}")

path.write_text("\n".join(lines) + "\n")
PY

if ! command -v docker >/dev/null 2>&1; then
  log "docker not found" >&2
  exit 1
fi

COMPOSE_CMD=""
HAS_DOCKER_COMPOSE_PLUGIN=0
if docker compose version >/dev/null 2>&1; then
  HAS_DOCKER_COMPOSE_PLUGIN=1
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  log "docker compose not available" >&2
  exit 1
fi

log "bring up services with ${COMPOSE_FILE_A}"
if [ "$QUIET" = "1" ]; then
  if [ "$HAS_DOCKER_COMPOSE_PLUGIN" = "1" ]; then
    run_quiet_command "compose-core" docker compose -f "$COMPOSE_FILE_A" up -d --build --remove-orphans
  else
    run_quiet_command "compose-core" "$COMPOSE_CMD" -f "$COMPOSE_FILE_A" up -d --build --remove-orphans
  fi
else
  if [ "$HAS_DOCKER_COMPOSE_PLUGIN" = "1" ]; then
    docker compose -f "$COMPOSE_FILE_A" up -d --build --remove-orphans
  else
    "$COMPOSE_CMD" -f "$COMPOSE_FILE_A" up -d --build --remove-orphans
  fi
fi

USE_PUBLIC_COMPOSE=0
if [ "$SKIP_PUBLIC" = "0" ]; then
  if [ -f "${RUNTIME_CLOUDFLARE_DIR}/config.yml" ] && [ -n "$(ls -1 ${RUNTIME_CLOUDFLARE_DIR}/*.json 2>/dev/null || true)" ]; then
    USE_PUBLIC_COMPOSE=1
  else
    log "notice: skip public compose (runtime cloudflare config not ready at ${RUNTIME_CLOUDFLARE_DIR})"
    log "if you need public entry via Tunnel, add runtime/cloudflared/config.yml + credentials json"
  fi
else
  log "SKIP_PUBLIC=1 -> skip public compose stack"
fi

if [ "$USE_PUBLIC_COMPOSE" -eq 1 ]; then
  log "bring up services with ${COMPOSE_FILE_B}"
  if [ "$QUIET" = "1" ]; then
    if [ "$HAS_DOCKER_COMPOSE_PLUGIN" = "1" ]; then
      run_quiet_command "compose-public" docker compose -f "$COMPOSE_FILE_A" -f "$COMPOSE_FILE_B" up -d --build --remove-orphans
    else
      run_quiet_command "compose-public" "$COMPOSE_CMD" -f "$COMPOSE_FILE_A" -f "$COMPOSE_FILE_B" up -d --build --remove-orphans
    fi
  else
    if [ "$HAS_DOCKER_COMPOSE_PLUGIN" = "1" ]; then
      docker compose -f "$COMPOSE_FILE_A" -f "$COMPOSE_FILE_B" up -d --build --remove-orphans
    else
      "$COMPOSE_CMD" -f "$COMPOSE_FILE_A" -f "$COMPOSE_FILE_B" up -d --build --remove-orphans
    fi
  fi
else
  log "public compose disabled; keep only core office service"
fi

log "wait for local health (max ${DELAY_SECONDS}s)"
i=1
while [ "$i" -le "$DELAY_SECONDS" ]; do
  if curl -fsS "$LOCAL_HEALTH_URL" >/dev/null; then
    log "local health ok"
    break
  fi
  if [ "$i" = "$DELAY_SECONDS" ]; then
    log "local health check timeout" >&2
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$QUIET" != "1" ]; then
  echo "[openclaw-office] local verify"
  curl -I -s "$LOCAL_OFFICE_URL" | head -n 5 || true
fi

if [ -n "${PUBLIC_URL}" ] && [ "$USE_PUBLIC_COMPOSE" -eq 1 ]; then
  PUBLIC_HEALTH_URL="${PUBLIC_URL%/}${PUBLIC_HEALTH_PATH}"
  log "public verify: $PUBLIC_HEALTH_URL"
  if curl -I -s "$PUBLIC_HEALTH_URL" | grep -qi '^HTTP'; then
    log "public health endpoint reachable"
  else
    log "public health endpoint not reachable (keep checking Tunnel/Domain settings)"
  fi
else
  log "public verify skipped (no public compose)"
fi

if [ "$QUIET" = "1" ]; then
  printf '%s\n' "[openclaw-office] done"
else
  log "done"
  log "office URL: ${PUBLIC_URL%/}/office"
fi
