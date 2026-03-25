#!/bin/bash

set -u

HOME_DIR="${HOME:-/Users/$(id -un)}"
RUNTIME_DIR="$HOME_DIR/.openclaw/runtime"
STATE_FILE="$RUNTIME_DIR/work-mode-state.json"
LAUNCH_AGENT_DIR="$HOME_DIR/Library/LaunchAgents"
USER_DOMAIN="gui/$(id -u)"

CORE_SERVICES=(
  "ai.openclaw.gateway"
  "ai.openclaw.gpt-proxy"
  "ai.openclaw.copilot-tunnel"
  "ai.openclaw.office"
)

STOP_SERVICES=(
  "ai.openclaw.n8n"
  "ai.openclaw.merchant-copilot-worker"
  "com.bw.openclaw-control-center"
  "com.bw.opencli-daemon"
  "com.bw.opencli-bridge-chrome"
  "com.bw.cron-status-sync-watcher"
  "com.bwstudio.studio-booking-form-pull"
  "com.openclaw.dashboard"
  "homebrew.mxcl.cliproxyapi"
  "homebrew.mxcl.colima"
)

PROCESS_PATTERNS=(
  "autoresearch-mlx"
  "esun-automation-profile"
  "opencli-debug-profile"
  "mcporter"
  "agent-browser"
)

ensure_runtime_dir() {
  mkdir -p "$RUNTIME_DIR"
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

json_array() {
  local first=1
  printf '['
  for item in "$@"; do
    if [ "$first" -eq 0 ]; then
      printf ', '
    fi
    first=0
    json_escape "$item"
  done
  printf ']'
}

iso_timestamp() {
  node -e 'process.stdout.write(new Date().toISOString())'
}

get_state_mode() {
  if [ ! -f "$STATE_FILE" ]; then
    return 0
  fi

  node - "$STATE_FILE" <<'EOF'
const fs = require('fs')
const path = process.argv[2]
try {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'))
  process.stdout.write(String(payload.mode || ''))
} catch (_error) {
  process.stdout.write('')
}
EOF
}

get_state_backup_path() {
  if [ ! -f "$STATE_FILE" ]; then
    return 0
  fi

  node - "$STATE_FILE" <<'EOF'
const fs = require('fs')
const path = process.argv[2]
try {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'))
  process.stdout.write(String(payload.cronBackupPath || ''))
} catch (_error) {
  process.stdout.write('')
}
EOF
}

write_state() {
  local mode="$1"
  local timestamp="$2"
  local backup_path="${3:-}"

  ensure_runtime_dir

  {
    printf '{\n'
    printf '  "mode": %s,\n' "$(json_escape "$mode")"
    if [ "$mode" = "work" ]; then
      printf '  "activatedAt": %s,\n' "$(json_escape "$timestamp")"
    else
      printf '  "activatedAt": null,\n'
    fi
    printf '  "updatedAt": %s,\n' "$(json_escape "$timestamp")"
    if [ -n "$backup_path" ]; then
      printf '  "cronBackupPath": %s,\n' "$(json_escape "$backup_path")"
    else
      printf '  "cronBackupPath": null,\n'
    fi
    printf '  "stoppedServices": %s,\n' "$(json_array "${STOP_SERVICES[@]}")"
    printf '  "killedProcessPatterns": %s,\n' "$(json_array "${PROCESS_PATTERNS[@]}")"
    printf '  "coreServices": %s\n' "$(json_array "${CORE_SERVICES[@]}")"
    printf '}\n'
  } > "$STATE_FILE"
}

service_is_loaded() {
  local label="$1"
  launchctl print "${USER_DOMAIN}/${label}" >/dev/null 2>&1
}

bootout_service() {
  local label="$1"
  local plist_path="$LAUNCH_AGENT_DIR/${label}.plist"
  if [ -f "$plist_path" ]; then
    launchctl bootout "$USER_DOMAIN" "$plist_path" >/dev/null 2>&1 || true
  fi
}

bootstrap_service() {
  local label="$1"
  local plist_path="$LAUNCH_AGENT_DIR/${label}.plist"
  if [ -f "$plist_path" ]; then
    launchctl bootstrap "$USER_DOMAIN" "$plist_path" >/dev/null 2>&1 || true
  fi
}

terminate_pattern() {
  local pattern="$1"
  pkill -TERM -f "$pattern" >/dev/null 2>&1 || true
}

latest_backup_path() {
  local candidate=''

  candidate="$(get_state_backup_path)"
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi

  find "$RUNTIME_DIR" -maxdepth 1 -type f -name 'crontab-backup-*.txt' -print 2>/dev/null | sort -r | head -n 1
}

backup_crontab() {
  local backup_path="$RUNTIME_DIR/crontab-backup-$(date +%s).txt"
  ensure_runtime_dir

  if crontab -l >/dev/null 2>&1; then
    crontab -l > "$backup_path" 2>/dev/null || true
  else
    printf '# No crontab entries\n' > "$backup_path"
  fi

  printf '%s' "$backup_path"
}

clear_crontab() {
  printf '# Work Mode active - crontab suspended\n' | crontab - >/dev/null 2>&1 || true
}

restore_crontab() {
  local backup_path="$1"

  if [ -n "$backup_path" ] && [ -f "$backup_path" ]; then
    crontab "$backup_path" >/dev/null 2>&1 || true
    return 0
  fi

  printf '# Work Mode deactivated - no saved crontab backup\n' | crontab - >/dev/null 2>&1 || true
}

emit_status() {
  local service_lines=''
  local process_lines=''
  local core_lines=''

  for label in "${STOP_SERVICES[@]}"; do
    if service_is_loaded "$label"; then
      service_lines="${service_lines}${label}|running"$'\n'
    else
      service_lines="${service_lines}${label}|stopped"$'\n'
    fi
  done

  for label in "${CORE_SERVICES[@]}"; do
    if service_is_loaded "$label"; then
      core_lines="${core_lines}${label}|running"$'\n'
    else
      core_lines="${core_lines}${label}|stopped"$'\n'
    fi
  done

  for pattern in "${PROCESS_PATTERNS[@]}"; do
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      process_lines="${process_lines}${pattern}|running"$'\n'
    else
      process_lines="${process_lines}${pattern}|stopped"$'\n'
    fi
  done

  STATE_FILE="$STATE_FILE" SERVICE_LINES="$service_lines" PROCESS_LINES="$process_lines" CORE_LINES="$core_lines" node <<'EOF'
const fs = require('fs')
const os = require('os')
const path = require('path')

const stateFile = process.env.STATE_FILE
const serviceLines = (process.env.SERVICE_LINES || '').split('\n').filter(Boolean)
const processLines = (process.env.PROCESS_LINES || '').split('\n').filter(Boolean)
const coreLines = (process.env.CORE_LINES || '').split('\n').filter(Boolean)

const parseEntries = (lines) => lines.map((line) => {
  const [name, state] = line.split('|')
  return { name, running: state === 'running' }
})

let state = {}
if (stateFile) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch (_error) {
    state = {}
  }
}

const serviceStatus = parseEntries(serviceLines)
const processStatus = parseEntries(processLines)
const coreStatus = parseEntries(coreLines)

const stoppedServices = serviceStatus.filter((entry) => !entry.running).map((entry) => entry.name)
const runningServices = serviceStatus.filter((entry) => entry.running).map((entry) => entry.name)
const stoppedProcesses = processStatus.filter((entry) => !entry.running).map((entry) => entry.name)
const runningProcesses = processStatus.filter((entry) => entry.running).map((entry) => entry.name)
const coreRunningServices = coreStatus.filter((entry) => entry.running).map((entry) => entry.name)
const coreStoppedServices = coreStatus.filter((entry) => !entry.running).map((entry) => entry.name)

const backupPath = state.cronBackupPath || null
const expandedBackupPath = backupPath ? backupPath.replace(/^~(?=$|\/)/, os.homedir()) : null
const cronBackedUp = Boolean(expandedBackupPath && fs.existsSync(path.resolve(expandedBackupPath)))

const mode = state.mode === 'work' || state.mode === 'normal'
  ? state.mode
  : 'normal'

const since = mode === 'work'
  ? (state.activatedAt || state.updatedAt || null)
  : (state.updatedAt || null)

const payload = {
  ok: true,
  mode,
  since,
  activatedAt: state.activatedAt || null,
  updatedAt: state.updatedAt || null,
  cronBackupPath: backupPath,
  cronBackedUp,
  coreServices: coreStatus.map((entry) => entry.name),
  coreRunningServices,
  coreStoppedServices,
  stoppedServices,
  runningServices,
  stoppedProcesses,
  runningProcesses,
  serviceStatus,
  processStatus,
  summary: {
    coreServiceCount: coreStatus.length,
    coreRunningCount: coreRunningServices.length,
    stoppedServiceCount: stoppedServices.length,
    stoppedServiceTargetCount: serviceStatus.length,
    stoppedProcessCount: stoppedProcesses.length,
    stoppedProcessTargetCount: processStatus.length,
  },
}

process.stdout.write(`${JSON.stringify(payload)}\n`)
EOF
}

activate() {
  local current_mode
  current_mode="$(get_state_mode)"
  if [ "$current_mode" = "work" ]; then
    emit_status
    return 0
  fi

  local backup_path
  backup_path="$(backup_crontab)"
  clear_crontab

  for label in "${STOP_SERVICES[@]}"; do
    bootout_service "$label"
  done

  for pattern in "${PROCESS_PATTERNS[@]}"; do
    terminate_pattern "$pattern"
  done

  write_state "work" "$(iso_timestamp)" "$backup_path"
  emit_status
}

deactivate() {
  local current_mode
  current_mode="$(get_state_mode)"
  if [ "$current_mode" != "work" ]; then
    emit_status
    return 0
  fi

  local backup_path
  backup_path="$(latest_backup_path)"
  restore_crontab "$backup_path"

  for label in "${STOP_SERVICES[@]}"; do
    bootstrap_service "$label"
  done

  write_state "normal" "$(iso_timestamp)" "$backup_path"
  emit_status
}

case "${1:-status}" in
  activate)
    activate
    ;;
  deactivate)
    deactivate
    ;;
  status)
    emit_status
    ;;
  *)
    printf 'Usage: %s {activate|deactivate|status}\n' "$0" >&2
    exit 1
    ;;
esac
