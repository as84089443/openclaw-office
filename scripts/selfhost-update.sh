#!/bin/sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BRANCH="${BRANCH:-master}"
DOCKER_COMPOSE_BIN="${DOCKER_COMPOSE_BIN:-/usr/local/bin/docker-compose}"
SKIP_PUBLIC="${OPENCLAW_SKIP_PUBLIC:-0}"
RUNTIME_CLOUDFLARE_DIR="${OPENCLAW_RUNTIME_CLOUDFLARE_DIR:-./runtime/cloudflared}"
COMPOSE_FILES_ARGS="-f docker-compose.selfhost.yml"

cd "$APP_DIR"
if [ "$SKIP_PUBLIC" = "0" ]; then
  if [ -f "${RUNTIME_CLOUDFLARE_DIR}/config.yml" ] && [ -n "$(ls -1 ${RUNTIME_CLOUDFLARE_DIR}/*.json 2>/dev/null || true)" ]; then
    COMPOSE_FILES_ARGS="-f docker-compose.selfhost.yml -f docker-compose.selfhost.public.yml"
  else
    echo "[openclaw-office] skip public compose for update (no cloudflared config)"
  fi
else
  echo "[openclaw-office] OPENCLAW_SKIP_PUBLIC=1, skip public compose for update"
fi

git fetch origin
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/$BRANCH)"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "up-to-date"
  exit 0
fi

git reset --hard "origin/$BRANCH"

if [ "$DOCKER_COMPOSE_BIN" = "docker compose" ]; then
  docker compose $COMPOSE_FILES_ARGS up -d --build
else
  "$DOCKER_COMPOSE_BIN" $COMPOSE_FILES_ARGS up -d --build
fi

echo "updated:$REMOTE"
