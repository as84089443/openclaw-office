#!/bin/sh
set -euo pipefail

# Internal compatibility wrapper. Prefer selfhost-zero-touch-deploy.sh or selfhost-zero-touch-pipeline.sh for operator use.

log() {
  if [ "${OPENCLAW_SELFHOST_QUIET:-0}" != "1" ]; then
    printf '[openclaw-auto-deploy] %s\n' "$1"
  fi
}

run_quiet_command() {
  label="$1"
  shift

  if [ "${OPENCLAW_SELFHOST_QUIET:-0}" != "1" ]; then
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
    echo "[openclaw-auto-deploy] command failed: $label" >&2
    echo "[openclaw-auto-deploy] log: $log_file" >&2
    tail -n 80 "$log_file" >&2
  } || true
  return "$rc"
}

PROJECT_ROOT="${OPENCLAW_PROJECT_ROOT:-/Users/brian/.openclaw/openclaw-office}"
MODE="${OPENCLAW_SELFHOST_MODE:-host}"
OFFICE_PUBLIC_URL="${OFFICE_PUBLIC_URL:-https://copilot.bw-space.com}"
DELAY_SECONDS="${AUTOPILOT_HEALTH_WAIT_SECONDS:-30}"
AUTO_INSTALL_DOCKER="${OPENCLAW_AUTO_INSTALL_DOCKER:-0}"
SKIP_PUBLIC="0"
QUIET="${OPENCLAW_SELFHOST_QUIET:-0}"

usage() {
  cat <<'EOF'
Usage: selfhost-auto-deploy.sh [options]

Options:
  --mode host|nas          host (default) or nas
  --public-url <url>       public base url
  --skip-public            force SKIP_PUBLIC=1
  --public                 force SKIP_PUBLIC=0
  --quiet                  don't print intermediate logs
  --install-docker         auto install docker when missing
  --health-wait <seconds>  local health wait timeout
  --help                   show this help
EOF
}

if [ -z "$PROJECT_ROOT" ]; then
  echo "OPENCLAW_PROJECT_ROOT is required" >&2
  exit 1
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --public-url)
      OFFICE_PUBLIC_URL="$2"
      shift 2
      ;;
    --skip-public)
      SKIP_PUBLIC="1"
      shift
      ;;
    --public)
      SKIP_PUBLIC="0"
      shift
      ;;
    --install-docker)
      AUTO_INSTALL_DOCKER="1"
      shift
      ;;
    --health-wait)
      DELAY_SECONDS="$2"
      shift 2
      ;;
    --quiet)
      QUIET="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ "$MODE" != "host" ] && [ "$MODE" != "nas" ]; then
  echo "Invalid --mode: $MODE (only host|nas)" >&2
  exit 1
fi

if [ "$MODE" = "nas" ]; then
  SKIP_PUBLIC="1"
fi

export OPENCLAW_SELFHOST_QUIET="$QUIET"

if [ "$AUTO_INSTALL_DOCKER" = "1" ] && ! command -v docker >/dev/null 2>&1; then
  if [ -x "${PROJECT_ROOT}/scripts/selfhost-install-docker.sh" ]; then
    sh "${PROJECT_ROOT}/scripts/selfhost-install-docker.sh"
  else
    echo "docker missing and installer script not found" >&2
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found; set --install-docker if you want automatic installation" >&2
  exit 1
fi

export OPENCLAW_SKIP_PUBLIC="$SKIP_PUBLIC"
export AUTOPILOT_HEALTH_WAIT_SECONDS="$DELAY_SECONDS"
export OFFICE_PUBLIC_URL="$OFFICE_PUBLIC_URL"
export OPENCLAW_RUNTIME_ENV="${OPENCLAW_RUNTIME_ENV:-runtime/.env.production}"

cd "$PROJECT_ROOT"

if [ ! -f "$OPENCLAW_RUNTIME_ENV" ] && [ -f .env.example ]; then
  cp .env.example "$OPENCLAW_RUNTIME_ENV"
fi

if [ "${OPENCLAW_AUTO_DRY_RUN:-0}" = "1" ]; then
  if [ "$QUIET" = "1" ]; then
    printf '%s\n' "[openclaw-auto-deploy] DRY-RUN: skipped execution"
  else
    log "DRY-RUN: skipped execution"
  fi
  exit 0
fi

if [ "$QUIET" = "1" ]; then
  run_quiet_command "selfhost-autopilot" sh scripts/selfhost-autopilot.sh
else
  sh scripts/selfhost-autopilot.sh
fi

if [ "$QUIET" = "1" ]; then
  printf '%s\n' "[openclaw-auto-deploy] done"
else
  log "done"
  log "mode=$MODE public=$OFFICE_PUBLIC_URL skip_public=$SKIP_PUBLIC"
fi
