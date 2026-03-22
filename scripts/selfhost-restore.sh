#!/bin/sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/openclaw-office-backups}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-openclaw-office}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
DOCKER_COMPOSE_BIN="${DOCKER_COMPOSE_BIN:-/usr/local/bin/docker-compose}"
DOCKER_COMPOSE_FILE_A="${DOCKER_COMPOSE_FILE_A:-docker-compose.selfhost.yml}"
DOCKER_COMPOSE_FILE_B="${DOCKER_COMPOSE_FILE_B:-docker-compose.selfhost.public.yml}"
SKIP_PUBLIC="${OPENCLAW_SKIP_PUBLIC:-0}"
RUNTIME_CLOUDFLARE_DIR="${OPENCLAW_RUNTIME_CLOUDFLARE_DIR:-./runtime/cloudflared}"

TARGET_BACKUP=""
RESTART_SERVICE=1
CONFIRM=1
BACKUP_BEFORE_RESTORE=1

usage() {
  cat <<'EOF'
Usage: selfhost-restore.sh [--file <backup.tgz>] [--latest] [--no-restart] [--yes] [--no-backup-before]

  --file <path>       指定要還原的 backup tar.gz
  --latest            還原最新一筆 backup（預設）
  --no-restart        還原後不重啟 openclaw-office
  --yes               不詢問直接執行（NAS/自動化建議）
  --no-backup-before   不先做預先備份

EOF
}

run_compose_up() {
  compose_cmd="$DOCKER_COMPOSE_BIN"
  compose_file_a="${DOCKER_COMPOSE_FILE_A}"
  compose_file_b="${DOCKER_COMPOSE_FILE_B}"

  if [ "$SKIP_PUBLIC" = "0" ]; then
    if [ -f "${RUNTIME_CLOUDFLARE_DIR}/config.yml" ] && [ -n "$(ls -1 ${RUNTIME_CLOUDFLARE_DIR}/*.json 2>/dev/null || true)" ]; then
      :
    else
      compose_file_b=""
    fi
  else
    compose_file_b=""
  fi

  if [ ! -f "$compose_file_a" ]; then
    compose_file_a=""
  fi
  if [ ! -f "$compose_file_b" ]; then
    compose_file_b=""
  fi

  if [ -n "$compose_file_a" ] && [ -n "$compose_file_b" ]; then
    compose_args="-f $compose_file_a -f $compose_file_b"
  elif [ -n "$compose_file_a" ]; then
    compose_args="-f $compose_file_a"
  elif [ -n "$compose_file_b" ]; then
    compose_args="-f $compose_file_b"
  else
    compose_args=""
  fi

  if [ "$compose_cmd" = "docker compose" ]; then
    docker compose $compose_args up -d --build
  elif command -v "$compose_cmd" >/dev/null 2>&1; then
    "$compose_cmd" $compose_args up -d --build
  elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose $compose_args up -d --build
  elif command -v docker >/dev/null 2>&1 && docker-compose --version >/dev/null 2>&1; then
    docker-compose $compose_args up -d --build
  else
    echo "No docker compose command available." >&2
    return 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --file)
      TARGET_BACKUP="${2:-}"
      shift 2
      ;;
    --latest)
      TARGET_BACKUP="latest"
      shift
      ;;
    --no-restart)
      RESTART_SERVICE=0
      shift
      ;;
    --yes)
      CONFIRM=0
      shift
      ;;
    --no-backup-before)
      BACKUP_BEFORE_RESTORE=0
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$TARGET_BACKUP" ] || [ "$TARGET_BACKUP" = "latest" ]; then
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "Backup directory not found: $BACKUP_DIR" >&2
    exit 1
  fi

  TARGET_BACKUP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'openclaw-office-*.tgz' -print | sort | tail -n 1)"
fi

if [ -z "$TARGET_BACKUP" ] || [ ! -f "$TARGET_BACKUP" ]; then
  echo "No valid backup file found: ${TARGET_BACKUP}" >&2
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "APP_DIR not found: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

echo "[restore] target backup: $TARGET_BACKUP"

if [ "$CONFIRM" -eq 1 ]; then
  printf '這將還原 data/ 與 runtime，會覆蓋現況。確定繼續？(yes/NO): '
  read -r ANSWER
  if [ "$ANSWER" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

STAGING_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

BACKUP_STASH_DIR="$APP_DIR/.restore-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_STASH_DIR"

if [ "$BACKUP_BEFORE_RESTORE" -eq 1 ] && [ -x "$APP_DIR/scripts/selfhost-backup.sh" ]; then
  echo "[restore] taking pre-restore backup"
  "$APP_DIR/scripts/selfhost-backup.sh" > "$BACKUP_STASH_DIR/backup.out" 2>&1 || true
fi

tar -xzf "$TARGET_BACKUP" -C "$STAGING_DIR"

if [ ! -d "$STAGING_DIR/data" ] || [ ! -d "$STAGING_DIR/runtime" ]; then
  echo "Backup archive format invalid: missing data/ or runtime/" >&2
  exit 1
fi

if [ "$RESTART_SERVICE" -eq 1 ] && [ -x "$APP_DIR/scripts/selfhost-notify.sh" ]; then
  "$APP_DIR/scripts/selfhost-notify.sh" "selfhost-restore" "running" "start restore" "backup=$TARGET_BACKUP"
fi

if [ "$RESTART_SERVICE" -eq 1 ]; then
  if command -v "$DOCKER_BIN" >/dev/null 2>&1; then
    if "$DOCKER_BIN" ps --format '{{.Names}}' | grep -x "$APP_CONTAINER_NAME" >/dev/null 2>&1; then
      echo "[restore] stopping $APP_CONTAINER_NAME"
      "$DOCKER_BIN" stop "$APP_CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
  elif [ "$RESTART_SERVICE" -eq 1 ]; then
    echo "[restore] docker cli not found; skip stop/restart operations."
  fi
fi

echo "[restore] backup current data/runtime"
if [ -d "$APP_DIR/data" ]; then
  mv "$APP_DIR/data" "$BACKUP_STASH_DIR/data.before-restore"
fi
if [ -d "$APP_DIR/runtime" ]; then
  mv "$APP_DIR/runtime" "$BACKUP_STASH_DIR/runtime.before-restore"
fi

mkdir -p "$APP_DIR/data" "$APP_DIR/runtime"
cp -a "$STAGING_DIR/data/." "$APP_DIR/data/"
cp -a "$STAGING_DIR/runtime/." "$APP_DIR/runtime/"

echo "[restore] restore completed"
echo "[restore] stash kept at: $BACKUP_STASH_DIR"

if [ "$RESTART_SERVICE" -eq 1 ]; then
  run_compose_up
fi

if [ "$RESTART_SERVICE" -eq 1 ] && [ -x "$APP_DIR/scripts/selfhost-notify.sh" ]; then
  "$APP_DIR/scripts/selfhost-notify.sh" "selfhost-restore" "done" "restore completed" "backup=$TARGET_BACKUP"
fi

echo "restore done"
