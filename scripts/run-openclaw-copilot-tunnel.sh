#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

exec /opt/homebrew/bin/cloudflared \
  --config /Users/brian/.openclaw/openclaw-office/scripts/cloudflared-openclaw-copilot.yml \
  tunnel run openclaw
