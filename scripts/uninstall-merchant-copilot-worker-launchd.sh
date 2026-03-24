#!/bin/zsh
set -euo pipefail

LAUNCH_AGENTS_DIR="/Users/brian/Library/LaunchAgents"
WORKER_LABEL="ai.openclaw.merchant-copilot-worker"

/bin/launchctl bootout "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1 || true
/bin/launchctl disable "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1 || true
rm -f "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"

echo "Uninstalled:"
echo "  - $WORKER_LABEL"
