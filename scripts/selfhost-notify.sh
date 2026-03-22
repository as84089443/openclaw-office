#!/bin/sh
set -euo pipefail

TASK="${1:-selfhost}"
SEVERITY="${2:-info}"
MESSAGE="${3:-notification}"
DETAILS="${4:-}"

ALERT_ENABLED="${ALERT_ENABLED:-1}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-${DISCORD_WEBHOOK_URL:-}}"
ALERT_TELEGRAM_BOT_TOKEN="${ALERT_TELEGRAM_BOT_TOKEN:-}"
ALERT_TELEGRAM_CHAT_ID="${ALERT_TELEGRAM_CHAT_ID:-}"
ALERT_HOST="${ALERT_HOSTNAME:-$(hostname)}"
ALERT_THROTTLE_SECONDS="${ALERT_THROTTLE_SECONDS:-900}"

safe_json_escape() {
  printf '%s' "$1" | sed ':a;N;$!ba;s/\\/\\\\/g;s/"/\\"/g;s/\r/\\r/g;s/\n/\\n/g'
}

should_send() {
  cache_key="$1"
  cache_file="/tmp/openclaw-selfhost-alert-${cache_key}"
  now_ts="$(date +%s)"
  last_epoch=0

  if [ -f "$cache_file" ]; then
    raw_epoch="$(cat "$cache_file" 2>/dev/null || echo 0)"
    case "$raw_epoch" in
      ''|*[!0-9]*)
        last_epoch=0
        ;;
      *)
        last_epoch="$raw_epoch"
        ;;
    esac
  fi

  if [ $(( now_ts - last_epoch )) -lt "$ALERT_THROTTLE_SECONDS" ]; then
    return 1
  fi

  echo "$now_ts" > "$cache_file"
}

send_discord() {
  if [ -z "$ALERT_WEBHOOK_URL" ]; then
    return 0
  fi

  safe_message="$(safe_json_escape "[$ALERT_HOST] [selfhost][$TASK/$SEVERITY] $MESSAGE")"
  content="$safe_message"
  if [ -n "$DETAILS" ]; then
    safe_details="$(safe_json_escape "$DETAILS")"
    content="${content}\\n${safe_details}"
  fi

  payload="{\"content\":\"$content\"}"

  curl -fsS \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$payload" \
    "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}

send_telegram() {
  if [ -z "$ALERT_TELEGRAM_BOT_TOKEN" ] || [ -z "$ALERT_TELEGRAM_CHAT_ID" ]; then
    return 0
  fi

  if [ -n "$DETAILS" ]; then
    text="$(printf '%s\n%s' "$MESSAGE" "$DETAILS")"
  else
    text="$MESSAGE"
  fi
  curl -fsS \
    -G \
    --data-urlencode "chat_id=$ALERT_TELEGRAM_CHAT_ID" \
    --data-urlencode "text=$text" \
    "https://api.telegram.org/bot$ALERT_TELEGRAM_BOT_TOKEN/sendMessage" >/dev/null 2>&1 || true
}

if [ "$ALERT_ENABLED" != "1" ]; then
  exit 0
fi

if [ -z "$ALERT_WEBHOOK_URL" ] && [ -z "$ALERT_TELEGRAM_BOT_TOKEN" ] && [ -z "$ALERT_TELEGRAM_CHAT_ID" ]; then
  exit 0
fi

case "$SEVERITY" in
  failure|error|warning|success|info|running|start|done) ;;
  *) SEVERITY="info" ;;
esac

cache_key="$(printf '%s' "$TASK" | tr -cd 'A-Za-z0-9._-')"
if [ -z "$cache_key" ]; then
  cache_key="selfhost-unknown"
fi
if should_send "$cache_key"; then
  send_discord
  send_telegram
fi
