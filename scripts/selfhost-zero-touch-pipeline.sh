#!/bin/sh
set -euo pipefail

# Canonical multi-node selfhost entrypoint for host + NAS pipelines.

log() {
  if [ "${OPENCLAW_SELFHOST_QUIET:-0}" != "1" ]; then
    printf '[openclaw-zero-touch-pipeline] %s\n' "$1"
  fi
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    return 1
  fi
}

usage() {
  cat <<'EOF'
Usage: selfhost-zero-touch-pipeline.sh [options]

Options:
  --host-root <path>           Host 專案根目錄（預設：OPENCLAW_HOST_ROOT / 當前目錄）
  --nas-root <path>            NAS 專案根目錄（若未提供則跳過 NAS 步驟）
  --repo-url <url>             repo 來源（預設 https://github.com/as84089443/openclaw-office.git）
  --branch <name>              branch（預設 master）
  --bootstrap-env <file>       bootstrap env 檔案（預設 OPENCLAW_SELFHOST_BOOTSTRAP_ENV / OPENCLAW_BOOTSTRAP_ENV / runtime/bootstrap.env）
  --host-public-url <url>      Host 公網網址（預設 https://copilot.bw-space.com）
  --skip-host                  跳過 host 步驟
  --skip-nas                   跳過 nas 步驟
  --git-sync                   每步驟都啟用 git sync
  --install-docker             每步驟缺 docker 時自動安裝
  --dry-run                    只顯示執行序，不實際操作
  --quiet                      不輸出中間流程（只保留錯誤與完成訊息）
  --help
EOF
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_ROOT="${OPENCLAW_HOST_ROOT:-$(pwd)}"
NAS_ROOT="${OPENCLAW_NAS_ROOT:-}"
REPO_URL="${OPENCLAW_SELFHOST_REPO_URL:-https://github.com/as84089443/openclaw-office.git}"
REPO_BRANCH="${OPENCLAW_SELFHOST_REPO_BRANCH:-master}"
BOOTSTRAP_ENV="${OPENCLAW_SELFHOST_BOOTSTRAP_ENV:-${OPENCLAW_BOOTSTRAP_ENV:-runtime/bootstrap.env}}"
HOST_PUBLIC_URL="${OFFICE_PUBLIC_URL:-https://copilot.bw-space.com}"
SKIP_HOST="0"
SKIP_NAS="0"
GIT_SYNC="0"
INSTALL_DOCKER="0"
DRY_RUN="0"
QUIET="0"
LOG_DIR="/tmp/openclaw-zero-touch-pipeline-logs"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host-root)
      HOST_ROOT="$2"
      shift 2
      ;;
    --nas-root)
      NAS_ROOT="$2"
      shift 2
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --branch)
      REPO_BRANCH="$2"
      shift 2
      ;;
    --bootstrap-env)
      BOOTSTRAP_ENV="$2"
      shift 2
      ;;
    --host-public-url)
      HOST_PUBLIC_URL="$2"
      shift 2
      ;;
    --skip-host)
      SKIP_HOST="1"
      shift
      ;;
    --skip-nas)
      SKIP_NAS="1"
      shift
      ;;
    --git-sync)
      GIT_SYNC="1"
      shift
      ;;
    --install-docker)
      INSTALL_DOCKER="1"
      shift
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
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
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

export OPENCLAW_SELFHOST_QUIET="$QUIET"

run_script() {
  stage="$1"
  shift

  if [ "$DRY_RUN" = "1" ]; then
    if [ "$QUIET" != "1" ]; then
      log "dry-run: $stage"
      log "command: $*"
    fi
    return 0
  fi

  if [ "$QUIET" = "1" ]; then
    mkdir -p "$LOG_DIR"
    log_file="$LOG_DIR/${stage}-$(date +%Y%m%d%H%M%S).log"
    if "$@" >"$log_file" 2>&1; then
      return 0
    fi
    rc=$?
    {
      echo "[openclaw-zero-touch-pipeline] command failed: $stage" >&2
      echo "[openclaw-zero-touch-pipeline] log: $log_file" >&2
      tail -n 80 "$log_file" >&2
    } || true
    return "$rc"
  fi

  "$@"
}

if [ "$SKIP_HOST" = "1" ] && [ "$SKIP_NAS" = "1" ]; then
  echo "nothing to run (--skip-host and --skip-nas both set)" >&2
  exit 1
fi

if [ -n "$BOOTSTRAP_ENV" ] && [ ! -f "$BOOTSTRAP_ENV" ]; then
  log "bootstrap env not found, continue without bootstrap file: $BOOTSTRAP_ENV"
  BOOTSTRAP_ENV=""
fi

bootstrap_arg() {
  if [ -n "$BOOTSTRAP_ENV" ]; then
    printf '%s' "--bootstrap-env $BOOTSTRAP_ENV"
  fi
}

if [ "$DRY_RUN" != "1" ] && [ "$SKIP_HOST" != "1" ] && [ "$INSTALL_DOCKER" != "1" ]; then
  need_cmd docker
fi

run_host() {
  args="--mode host --public-url $HOST_PUBLIC_URL $(bootstrap_arg) --repo-url $REPO_URL --branch $REPO_BRANCH"
  if [ "$GIT_SYNC" = "1" ]; then
    args="$args --git-sync"
  fi
  if [ "$INSTALL_DOCKER" = "1" ]; then
    args="$args --install-docker"
  fi

  if [ "$QUIET" != "1" ] && [ "$DRY_RUN" != "1" ]; then
    log "start host deploy"
    log "host root=$HOST_ROOT"
    log "command: OPENCLAW_PROJECT_ROOT=$HOST_ROOT sh scripts/selfhost-zero-touch-deploy.sh $args"
  fi

  run_script host \
    env \
    OPENCLAW_SELFHOST_QUIET="$QUIET" \
    OPENCLAW_PROJECT_ROOT="$HOST_ROOT" \
    OPENCLAW_SELFHOST_REPO_URL="$REPO_URL" \
    OPENCLAW_SELFHOST_REPO_BRANCH="$REPO_BRANCH" \
    sh "$SCRIPT_DIR/selfhost-zero-touch-deploy.sh" $args
}

run_nas() {
  if [ -z "$NAS_ROOT" ]; then
    log "NAS root not set, skip nas step"
    return 0
  fi

  args="--mode nas --skip-public $(bootstrap_arg) --repo-url $REPO_URL --branch $REPO_BRANCH"
  if [ "$GIT_SYNC" = "1" ]; then
    args="$args --git-sync"
  fi

  if [ "$QUIET" != "1" ] && [ "$DRY_RUN" != "1" ]; then
    log "start nas deploy"
    log "nas root=$NAS_ROOT"
    log "command: OPENCLAW_PROJECT_ROOT=$NAS_ROOT sh scripts/selfhost-zero-touch-deploy.sh $args"
  fi

  run_script nas \
    env \
    OPENCLAW_SELFHOST_QUIET="$QUIET" \
    OPENCLAW_PROJECT_ROOT="$NAS_ROOT" \
    OPENCLAW_SELFHOST_REPO_URL="$REPO_URL" \
    OPENCLAW_SELFHOST_REPO_BRANCH="$REPO_BRANCH" \
    sh "$SCRIPT_DIR/selfhost-zero-touch-deploy.sh" $args
}

if [ "$SKIP_HOST" != "1" ]; then
  run_host
  if [ "$QUIET" != "1" ]; then
    log "host deploy done"
  fi
fi

if [ "$SKIP_NAS" != "1" ]; then
  if [ "$SKIP_HOST" = "0" ]; then
    if [ "$QUIET" != "1" ]; then
      log "host finished, continue NAS"
    fi
  fi
  run_nas
  if [ "$QUIET" != "1" ]; then
    log "nas deploy done"
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  if [ "$QUIET" != "1" ]; then
    log "dry-run complete"
  fi
else
  if [ "$QUIET" = "1" ]; then
    printf '%s\n' "[openclaw-zero-touch-pipeline] done"
  else
    log "pipeline complete"
  fi
fi
