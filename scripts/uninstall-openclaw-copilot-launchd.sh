#!/bin/zsh
set -euo pipefail

LAUNCH_AGENTS_DIR="/Users/brian/Library/LaunchAgents"
OFFICE_LABEL="ai.openclaw.office"
TUNNEL_LABEL="ai.openclaw.copilot-tunnel"
WORKER_LABEL="ai.openclaw.merchant-copilot-worker"

/bin/launchctl bootout "gui/$UID/$OFFICE_LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootout "gui/$UID/$TUNNEL_LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootout "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1 || true
/bin/launchctl disable "gui/$UID/$OFFICE_LABEL" >/dev/null 2>&1 || true
/bin/launchctl disable "gui/$UID/$TUNNEL_LABEL" >/dev/null 2>&1 || true
/bin/launchctl disable "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1 || true

rm -f "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist" "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"

echo "Uninstalled:"
echo "  - $OFFICE_LABEL"
echo "  - $TUNNEL_LABEL"
echo "  - $WORKER_LABEL"
