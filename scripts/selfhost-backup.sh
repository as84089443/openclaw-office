#!/bin/sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/openclaw-office-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-openclaw-office}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
STAGING_DIR="$(mktemp -d)"
ARCHIVE_PATH="$BACKUP_DIR/openclaw-office-$TIMESTAMP.tgz"

mkdir -p "$BACKUP_DIR"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

cd "$APP_DIR"

mkdir -p "$STAGING_DIR/runtime" "$STAGING_DIR/data"

cp docker-compose.selfhost.yml "$STAGING_DIR/" 2>/dev/null || true
cp docker-compose.selfhost.public.yml "$STAGING_DIR/" 2>/dev/null || true
cp runtime/.env.production "$STAGING_DIR/runtime/" 2>/dev/null || true
cp runtime/openclaw.json "$STAGING_DIR/runtime/" 2>/dev/null || true
cp runtime/openclaw-office.config.json "$STAGING_DIR/runtime/" 2>/dev/null || true

if [ -d runtime/openclaw-state ]; then
  mkdir -p "$STAGING_DIR/runtime/openclaw-state"
  cp runtime/openclaw-state/device.json "$STAGING_DIR/runtime/openclaw-state/" 2>/dev/null || true
  cp runtime/openclaw-state/device-auth.json "$STAGING_DIR/runtime/openclaw-state/" 2>/dev/null || true
fi

if [ -d runtime/cloudflared ]; then
  mkdir -p "$STAGING_DIR/runtime/cloudflared"
  cp runtime/cloudflared/config.yml "$STAGING_DIR/runtime/cloudflared/" 2>/dev/null || true
  cp runtime/cloudflared/*.json "$STAGING_DIR/runtime/cloudflared/" 2>/dev/null || true
fi

if command -v "$DOCKER_BIN" >/dev/null 2>&1 && "$DOCKER_BIN" ps --format '{{.Names}}' | grep -x "$APP_CONTAINER_NAME" >/dev/null 2>&1; then
  "$DOCKER_BIN" exec "$APP_CONTAINER_NAME" sh -lc 'cp /app/data/openclaw-office.db /app/data/openclaw-office.db.snapshot 2>/dev/null || true'
fi

cp -R data/. "$STAGING_DIR/data/" 2>/dev/null || true

tar -C "$STAGING_DIR" -czf "$ARCHIVE_PATH" .

find "$BACKUP_DIR" -type f -name 'openclaw-office-*.tgz' -mtime +"$RETENTION_DAYS" -delete

echo "$ARCHIVE_PATH"
