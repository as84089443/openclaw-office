#!/bin/sh
set -euo pipefail

# Internal layer: runtime/bootstrap + health orchestration. Prefer selfhost-zero-touch-deploy.sh for operator use.

QUIET="${OPENCLAW_SELFHOST_QUIET:-0}"

log() {
  if [ "$QUIET" != "1" ]; then
    printf '[openclaw-autopilot] %s\n' "$1"
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
    echo "[openclaw-autopilot] command failed: $label" >&2
    echo "[openclaw-autopilot] log: $log_file" >&2
    tail -n 80 "$log_file" >&2
  } || true
  return "$rc"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    return 1
  fi
}

resolve_source_file() {
  for candidate in "$@"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

copy_file_if_missing() {
  source_path="$1"
  target_path="$2"
  label="$3"

  if [ -f "$target_path" ]; then
    log "runtime ${label} exists: ${target_path}"
    return
  fi

  if [ -z "$source_path" ] || [ ! -f "$source_path" ]; then
    echo "missing required source for ${label}: ${source_path}" >&2
    return 1
  fi

  cp "$source_path" "$target_path"
  log "bootstrap: copied ${label} from ${source_path}"
}

ensure_json_file() {
  target_path="$1"
  label="$2"

  if [ -f "$target_path" ]; then
    return
  fi

  mkdir -p "$(dirname "$target_path")"
  cat <<'EOF' > "$target_path"
{}
EOF
  log "bootstrap: created fallback ${label}: ${target_path}"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${OPENCLAW_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
WORKSPACE_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
PUBLIC_URL="${OFFICE_PUBLIC_URL:-https://copilot.bw-space.com}"
PUBLIC_HEALTH_PATH="${OFFICE_PUBLIC_HEALTH_PATH:-/api/health}"
RUNTIME_ENV_REL="${OPENCLAW_RUNTIME_ENV:-runtime/.env.production}"
RUNTIME_DIR="${OPENCLAW_RUNTIME_DIR:-./runtime}"
RUNTIME_CLOUDFLARE_DIR="${OPENCLAW_RUNTIME_CLOUDFLARE_DIR:-./runtime/cloudflared}"
RUNTIME_IDENTITY_SOURCE="${OPENCLAW_IDENTITY_SOURCE_DIR:-$HOME/.openclaw/identity}"

RESOLVED_OPENCLAW_JSON="$(resolve_source_file \
  "${OPENCLAW_SOURCE_OPENCLAW_JSON:-}" \
  "$PROJECT_ROOT/openclaw.json" \
  "$WORKSPACE_ROOT/openclaw.json" \
  "$HOME/openclaw.json" \
  "$HOME/.openclaw/openclaw.json" \
  "$WORKSPACE_ROOT/.openclaw/openclaw.json" \
  || true)"

RESOLVED_OFFICE_CONFIG="$(resolve_source_file \
  "${OPENCLAW_SOURCE_OFFICE_CONFIG:-}" \
  "$PROJECT_ROOT/openclaw-office.config.json" \
  "$WORKSPACE_ROOT/openclaw-office.config.json" \
  "$PROJECT_ROOT/openclaw-office.config.example.json" \
  "$WORKSPACE_ROOT/.openclaw/openclaw-office.config.json" \
  "$WORKSPACE_ROOT/.openclaw/openclaw-office.config.example.json" \
  "$HOME/.openclaw/openclaw-office.config.json" \
  "$HOME/.openclaw/openclaw-office.config.example.json" \
  || true)"

SOURCE_OPENCLAW_JSON="$RESOLVED_OPENCLAW_JSON"
SOURCE_OFFICE_CONFIG="$RESOLVED_OFFICE_CONFIG"
LOCAL_HEALTH_URL="${OFFICE_LOCAL_HEALTH_URL:-http://127.0.0.1:4200/api/health}"
DELAY_SECONDS="${AUTOPILOT_HEALTH_WAIT_SECONDS:-30}"
SKIP_PUBLIC="${OPENCLAW_SKIP_PUBLIC:-0}"

cd "$PROJECT_ROOT"

need_cmd docker
need_cmd curl
need_cmd python3

if [ ! -d "$RUNTIME_DIR" ]; then
  mkdir -p "$RUNTIME_DIR"
fi

RUNTIME_ENV_PATH="$RUNTIME_ENV_REL"
if [ -f "$RUNTIME_ENV_PATH" ]; then
  log "runtime env exists: $RUNTIME_ENV_PATH"
else
  if [ -f ".env.example" ]; then
    cp ".env.example" "$RUNTIME_ENV_PATH"
    log "created runtime env from .env.example"
  else
    log "warning: .env.example missing, creating minimal runtime env"
    printf 'FNB_PUBLIC_BASE_URL=%s\n' "$PUBLIC_URL" > "$RUNTIME_ENV_PATH"
  fi
fi

python3 - "$RUNTIME_ENV_PATH" "$PUBLIC_URL" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
public_url = sys.argv[2]
lines = path.read_text().splitlines()
updated = False

for i, line in enumerate(lines):
    if line.startswith("FNB_PUBLIC_BASE_URL="):
        lines[i] = f"FNB_PUBLIC_BASE_URL={public_url}"
        updated = True
        break

if not updated:
    lines.append(f"FNB_PUBLIC_BASE_URL={public_url}")

path.write_text("\n".join(lines) + "\n")
PY

if [ ! -f "$SOURCE_OPENCLAW_JSON" ]; then
  echo "[openclaw-autopilot] openclaw.json not found. Set OPENCLAW_SOURCE_OPENCLAW_JSON to a valid path." >&2
  echo "tried: $PROJECT_ROOT/openclaw.json, $WORKSPACE_ROOT/openclaw.json, $HOME/.openclaw/openclaw.json" >&2
  exit 1
fi

copy_file_if_missing "$SOURCE_OPENCLAW_JSON" "$RUNTIME_DIR/openclaw.json" "openclaw.json"
copy_file_if_missing "$SOURCE_OFFICE_CONFIG" "$RUNTIME_DIR/openclaw-office.config.json" "openclaw-office.config.json"

mkdir -p "$RUNTIME_DIR/openclaw-state"
if [ -f "$RUNTIME_IDENTITY_SOURCE/device.json" ]; then
  cp "$RUNTIME_IDENTITY_SOURCE/device.json" "$RUNTIME_DIR/openclaw-state/device.json"
  log "bootstrap: synced device.json from identity source"
else
  ensure_json_file "$RUNTIME_DIR/openclaw-state/device.json" "identity device"
fi

if [ -f "$RUNTIME_IDENTITY_SOURCE/device-auth.json" ]; then
  cp "$RUNTIME_IDENTITY_SOURCE/device-auth.json" "$RUNTIME_DIR/openclaw-state/device-auth.json"
  log "bootstrap: synced device-auth.json from identity source"
else
  ensure_json_file "$RUNTIME_DIR/openclaw-state/device-auth.json" "identity device-auth"
fi

if [ "$SKIP_PUBLIC" != "1" ]; then
  if [ ! -f "$RUNTIME_CLOUDFLARE_DIR/config.yml" ] || [ -z "$(ls -1 "$RUNTIME_CLOUDFLARE_DIR"/*.json 2>/dev/null || true)" ]; then
    log "runtime tunnel config missing, fallback to SKIP_PUBLIC=1"
    SKIP_PUBLIC="1"
  fi
fi

log "start one-click deploy"
if run_quiet_command one-click \
  OPENCLAW_SKIP_PUBLIC="$SKIP_PUBLIC" \
  OPENCLAW_RUNTIME_ENV="$RUNTIME_ENV_PATH" \
  OPENCLAW_SELFHOST_QUIET="$QUIET" \
  OFFICE_PUBLIC_URL="$PUBLIC_URL" \
  sh scripts/selfhost-one-click.sh "$PUBLIC_URL"; then
  log "deploy command done"
else
  log "deploy failed"
  exit 1
fi

log "wait for local health"
for i in $(seq 1 "${DELAY_SECONDS}"); do
  if curl -fsS "$LOCAL_HEALTH_URL" >/dev/null; then
    break
  fi
  if [ "$i" = "${DELAY_SECONDS}" ]; then
    log "local health check timeout"
    exit 1
  fi
  sleep 1
done

if [ "$SKIP_PUBLIC" != "1" ]; then
  PUBLIC_HEALTH_URL="${PUBLIC_URL%/}${PUBLIC_HEALTH_PATH}"
  if curl -fsS "$PUBLIC_HEALTH_URL" >/dev/null; then
    log "public health ok: $PUBLIC_HEALTH_URL"
  else
    log "public health not ready yet: $PUBLIC_HEALTH_URL"
  fi
fi

if docker ps --filter "name=openclaw-maintenance" --filter "status=running" --format '{{.Names}}' | grep -q '^openclaw-maintenance$'; then
  log "maintenance loop active: openclaw-maintenance auto backup/update is on"
else
  log "maintenance loop not detected; if enabled in compose, check container restart policy or logs"
fi

if [ -x "scripts/selfhost-restore.sh" ] && [ -x "scripts/selfhost-update.sh" ]; then
  if [ -f "${RUNTIME_CLOUDFLARE_DIR}/config.yml" ]; then
    log "maintenance enabled: openclaw-maintenance will run daily backup/update tasks"
  else
    log "maintenance enabled in core compose; backup/update runs on schedule when openclaw-maintenance container is present"
  fi
fi

log "office URL: ${PUBLIC_URL%/}/office"
log "autopilot finished"
