#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/brian/.openclaw/openclaw-office"
LAUNCH_AGENTS_DIR="/Users/brian/Library/LaunchAgents"
LOG_DIR="/Users/brian/.openclaw/logs"
FNM_NODE_BIN="/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/bin/node"
FNM_NPM_CLI="/Users/brian/.local/share/fnm/node-versions/v24.13.0/installation/lib/node_modules/npm/bin/npm-cli.js"
NODE_BIN="${OPENCLAW_NODE_BIN:-$FNM_NODE_BIN}"
NPM_CLI="${OPENCLAW_NPM_CLI:-$FNM_NPM_CLI}"

OFFICE_LABEL="ai.openclaw.office"
TUNNEL_LABEL="ai.openclaw.copilot-tunnel"
WORKER_LABEL="ai.openclaw.merchant-copilot-worker"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "[openclaw-office] 找不到固定 Node 24：$NODE_BIN" >&2
  exit 1
fi

if [[ ! -f "$NPM_CLI" ]]; then
  echo "[openclaw-office] 找不到 npm-cli.js：$NPM_CLI" >&2
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:$PATH"

cd "$PROJECT_ROOT"
"$NODE_BIN" "$NPM_CLI" run build

cp "$PROJECT_ROOT/launchd/$OFFICE_LABEL.plist" "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist"
cp "$PROJECT_ROOT/launchd/$TUNNEL_LABEL.plist" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"
cp "$PROJECT_ROOT/launchd/$WORKER_LABEL.plist" "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"
chmod 644 "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist" "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"

ensure_agent() {
  local label="$1"
  local plist="$2"
  /bin/launchctl enable "gui/$UID/$label" >/dev/null 2>&1 || true
  if /bin/launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
    /bin/launchctl kickstart -k "gui/$UID/$label"
  else
    /bin/launchctl bootstrap "gui/$UID" "$plist"
    /bin/launchctl kickstart -k "gui/$UID/$label"
  fi
}

ensure_agent "$OFFICE_LABEL" "$LAUNCH_AGENTS_DIR/$OFFICE_LABEL.plist"
ensure_agent "$TUNNEL_LABEL" "$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"
ensure_agent "$WORKER_LABEL" "$LAUNCH_AGENTS_DIR/$WORKER_LABEL.plist"

echo "Installed and started:"
echo "  - $OFFICE_LABEL"
echo "  - $TUNNEL_LABEL"
echo "  - $WORKER_LABEL"
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
