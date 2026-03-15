#!/bin/zsh
set -euo pipefail

LAUNCH_AGENTS_DIR="/Users/brian/Library/LaunchAgents"
OFFICE_LABEL="ai.openclaw.office"
TUNNEL_LABEL="ai.openclaw.copilot-tunnel"

/bin/launchctl bootout "gui/$UID/$OFFICE_LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootout "gui/$UID/$TUNNEL_LABEL" >/dev/null 2>&1 || true

rm -f "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"

echo "Uninstalled:"
echo "  - $OFFICE_LABEL"
echo "  - $TUNNEL_LABEL"
