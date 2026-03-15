#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
LAUNCH_AGENTS_DIR="/Users/brian/Library/LaunchAgents"
LOG_DIR="/Users/brian/.openclaw/logs"

OFFICE_LABEL="ai.openclaw.office"
TUNNEL_LABEL="ai.openclaw.copilot-tunnel"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

cd "$PROJECT_ROOT"
/opt/homebrew/bin/npm run build

cp "$PROJECT_ROOT/launchd/$OFFICE_LABEL.plist" "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist"
cp "$PROJECT_ROOT/launchd/$TUNNEL_LABEL.plist" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"
chmod 644 "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"

ensure_agent() {
  local label="$1"
  local plist="$2"
  if /bin/launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
    /bin/launchctl kickstart -k "gui/$UID/$label"
  else
    /bin/launchctl bootstrap "gui/$UID" "$plist"
    /bin/launchctl kickstart -k "gui/$UID/$label"
  fi
}

ensure_agent "$OFFICE_LABEL" "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist"
ensure_agent "$TUNNEL_LABEL" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"

echo "Installed and started:"
echo "  - $OFFICE_LABEL"
echo "  - $TUNNEL_LABEL"
echo
echo "Waiting for health..."
for _ in {1..20}; do
  if curl -fsS https://copilot.bw-space.com/api/health; then
    echo
    exit 0
  fi
  sleep 1
done

echo "Health check did not return 200 within 20 seconds" >&2
exit 1
