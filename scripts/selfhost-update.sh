#!/bin/zsh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/openclaw-office}"
BRANCH="${BRANCH:-master}"

cd "$APP_DIR"

git fetch origin
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/$BRANCH)"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "up-to-date"
  exit 0
fi

git reset --hard "origin/$BRANCH"
/usr/local/bin/docker-compose -f docker-compose.selfhost.yml -f docker-compose.selfhost.public.yml up -d --build

echo "updated:$REMOTE"
