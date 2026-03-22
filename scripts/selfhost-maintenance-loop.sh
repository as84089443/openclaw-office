#!/bin/sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ALERT_ON_FAILURE="${ALERT_ON_FAILURE:-1}"
ALERT_ON_SUCCESS="${ALERT_ON_SUCCESS:-0}"
LOOP_INTERVAL_SECONDS="${LOOP_INTERVAL_SECONDS:-60}"
NOTIFY_TASK_PREFIX="${NOTIFY_TASK_PREFIX:-openclaw-selfhost}"
RUN_ONCE="${RUN_ONCE:-0}"
RUN_ONCE_TASKS="${RUN_ONCE_TASKS:-backup,update}"

BACKUP_MARKER="/tmp/openclaw-selfhost-backup"
UPDATE_MARKER="/tmp/openclaw-selfhost-update"

run_once_per_day() {
  task="$1"
  marker_prefix="$2"
  command_path="$3"
  today="$(date +%Y%m%d)"
  marker="$marker_prefix-$today"

  if [ -f "$marker" ]; then
    return 0
  fi

  echo "[$(date +%Y-%m-%d' '%H:%M:%S)] running $task"
  if [ -x "$command_path" ]; then
    if output="$("$command_path" 2>&1)"; then
      :
    else
      status=$?
      fail_output="$output"
      echo "[$(date +%Y-%m-%d' '%H:%M:%S)] $task failed (exit=$status)"
      echo "$fail_output"
      if [ "$ALERT_ON_FAILURE" = "1" ] && [ -x "$SCRIPT_DIR/selfhost-notify.sh" ]; then
        "$SCRIPT_DIR/selfhost-notify.sh" "$NOTIFY_TASK_PREFIX-$task" "failure" "$task failed (exit $status)" "$fail_output" >/dev/null 2>&1 || true
      fi
      return 0
    fi
  else
    echo "[$(date +%Y-%m-%d' '%H:%M:%S)] command missing or not executable: $command_path"
    if [ "$ALERT_ON_FAILURE" = "1" ] && [ -x "$SCRIPT_DIR/selfhost-notify.sh" ]; then
      "$SCRIPT_DIR/selfhost-notify.sh" "$NOTIFY_TASK_PREFIX-$task" "error" "command missing or not executable" "$command_path" >/dev/null 2>&1 || true
    fi
    return 0
  fi

  touch "$marker"
  :
  if [ "$ALERT_ON_SUCCESS" = "1" ] && [ -x "$SCRIPT_DIR/selfhost-notify.sh" ]; then
    "$SCRIPT_DIR/selfhost-notify.sh" "$NOTIFY_TASK_PREFIX-$task" "success" "$task completed" "" >/dev/null 2>&1 || true
  fi
}

run_task_direct() {
  task="$1"
  command_path="$2"

  echo "[$(date +%Y-%m-%d' '%H:%M:%S)] running $task (manual test)"
  if [ -x "$command_path" ]; then
    if output="$("$command_path" 2>&1)"; then
      if [ -n "$output" ]; then
        echo "$output"
      fi
      if [ "$ALERT_ON_SUCCESS" = "1" ] && [ -x "$SCRIPT_DIR/selfhost-notify.sh" ]; then
        "$SCRIPT_DIR/selfhost-notify.sh" "$NOTIFY_TASK_PREFIX-$task" "success" "$task completed" "" >/dev/null 2>&1 || true
      fi
      return 0
    else
      status=$?
      fail_output="$output"
      echo "[$(date +%Y-%m-%d' '%H:%M:%S)] $task failed (exit=$status)"
      echo "$fail_output"
      if [ "$ALERT_ON_FAILURE" = "1" ] && [ -x "$SCRIPT_DIR/selfhost-notify.sh" ]; then
        "$SCRIPT_DIR/selfhost-notify.sh" "$NOTIFY_TASK_PREFIX-$task" "failure" "$task failed (exit $status)" "$fail_output" >/dev/null 2>&1 || true
      fi
      return 0
    fi
  else
    echo "[$(date +%Y-%m-%d' '%H:%M:%S)] command missing or not executable: $command_path"
    if [ "$ALERT_ON_FAILURE" = "1" ] && [ -x "$SCRIPT_DIR/selfhost-notify.sh" ]; then
      "$SCRIPT_DIR/selfhost-notify.sh" "$NOTIFY_TASK_PREFIX-$task" "error" "command missing or not executable" "$command_path" >/dev/null 2>&1 || true
    fi
    return 0
  fi
}

run_one_round() {
  tasks="$1"

  backup=1
  update=1
  if [ "$tasks" != "all" ]; then
    backup=0
    update=0
    IFS=','
    for t in $tasks; do
      case "$t" in
        backup)
          backup=1
          ;;
        update)
          update=1
          ;;
      esac
    done
  fi

  if [ "$backup" = "1" ]; then
    run_task_direct "selfhost backup" "$SCRIPT_DIR/selfhost-backup.sh"
  fi
  if [ "$update" = "1" ]; then
    run_task_direct "selfhost update" "$SCRIPT_DIR/selfhost-update.sh"
  fi
}

if [ "$RUN_ONCE" = "1" ]; then
  run_one_round "$RUN_ONCE_TASKS"
  exit 0
fi

while true; do
  hm="$(date +%H:%M)"

  case "$hm" in
    "02:30")
      run_once_per_day "selfhost backup" "$BACKUP_MARKER" "$SCRIPT_DIR/selfhost-backup.sh"
      ;;
    "03:00")
      run_once_per_day "selfhost update" "$UPDATE_MARKER" "$SCRIPT_DIR/selfhost-update.sh"
      ;;
  esac

  # keep marker files bounded even if the container is long-running
  find /tmp -type f -name 'openclaw-selfhost-*' -mtime +7 -delete 2>/dev/null || true

  sleep "$LOOP_INTERVAL_SECONDS"
done
