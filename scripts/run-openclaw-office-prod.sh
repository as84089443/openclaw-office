#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
PORT_TO_CHECK=4200
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/brian/.local/bin:/Users/brian/.npm-global/bin:$PATH"
export NODE_ENV=production

cd "$PROJECT_ROOT"

if [[ "${OPENCLAW_FORCE_LOCAL:-0}" != "1" ]]; then
  PORT_TO_CHECK="${PORT:-$PORT_TO_CHECK}"
  if lsof -nP -iTCP:"$PORT_TO_CHECK" -sTCP:LISTEN -t 1>/dev/null 2>&1; then
    echo "[openclaw-office] port $PORT_TO_CHECK already bound. skip host startup."
    exit 0
  fi
fi

if [[ ! -f ".next/BUILD_ID" ]]; then
  /opt/homebrew/bin/npm run build
fi

exec /opt/homebrew/bin/node start.js
