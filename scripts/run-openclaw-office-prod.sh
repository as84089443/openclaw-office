#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/brian/.local/bin:/Users/brian/.npm-global/bin:$PATH"
export NODE_ENV=production

cd "$PROJECT_ROOT"

if [[ ! -f ".next/BUILD_ID" ]]; then
  /opt/homebrew/bin/npm run build
fi

exec /opt/homebrew/bin/node start.js
