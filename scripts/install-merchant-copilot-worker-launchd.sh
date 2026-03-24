#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
LAUNCH_AGENTS_DIR="/Users/brian/Library/LaunchAgents"
LOG_DIR="/Users/brian/.openclaw/logs"
WORKER_LABEL="ai.openclaw.merchant-copilot-worker"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

cp "$PROJECT_ROOT/launchd/$WORKER_LABEL.plist" "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"
chmod 644 "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"

if /bin/launchctl print "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1; then
  /bin/launchctl enable "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1 || true
  /bin/launchctl kickstart -k "gui/$UID/$WORKER_LABEL"
else
  /bin/launchctl enable "gui/$UID/$WORKER_LABEL" >/dev/null 2>&1 || true
  /bin/launchctl bootstrap "gui/$UID" "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"
  /bin/launchctl kickstart -k "gui/$UID/$WORKER_LABEL"
fi

echo "Installed and started:"
echo "  - $WORKER_LABEL"
