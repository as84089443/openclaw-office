#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

DEFAULT_CONFIG="/Users/brian/.openclaw/openclaw-office/scripts/cloudflared-openclaw-copilot.yml"
OVERRIDE_CONFIG="/Users/brian/.cloudflared/openclaw-copilot.override.yml"
CONFIG_PATH="${OPENCLAW_COPILOT_TUNNEL_CONFIG:-}"

if [[ -z "$CONFIG_PATH" ]]; then
  if [[ -f "$OVERRIDE_CONFIG" ]]; then
    CONFIG_PATH="$OVERRIDE_CONFIG"
  else
    CONFIG_PATH="$DEFAULT_CONFIG"
  fi
fi

exec /opt/homebrew/bin/cloudflared \
  --config "$CONFIG_PATH" \
  tunnel run openclaw
