#!/bin/sh
set -euo pipefail

CHROME_APP="${OPENCLAW_BROWSER_APP:-Google Chrome}"
LOCAL_BASE="${OFFICE_LOCAL_BASE_URL:-http://127.0.0.1:4200}"
PUBLIC_BASE="${OFFICE_PUBLIC_URL:-https://copilot.bw-space.com}"
PATH_SUFFIX="${OFFICE_UI_PATH:-/office}"
MODE="auto"
PRINT_ONLY="0"

usage() {
  cat <<'EOF'
Usage: open-office-ui.sh [options]

Options:
  --local           open local /office
  --public          open public /office
  --url <url>       open custom url directly
  --path <path>     override path suffix (default: /office)
  --print           print resolved url without opening browser
  --help            show this help
EOF
}

TARGET_URL=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --local)
      MODE="local"
      shift
      ;;
    --public)
      MODE="public"
      shift
      ;;
    --url)
      TARGET_URL="$2"
      MODE="custom"
      shift 2
      ;;
    --path)
      PATH_SUFFIX="$2"
      shift 2
      ;;
    --print)
      PRINT_ONLY="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

trim_base() {
  printf '%s' "$1" | sed 's#/*$##'
}

join_url() {
  base="$(trim_base "$1")"
  path="$2"
  case "$path" in
    /*) printf '%s%s\n' "$base" "$path" ;;
    *) printf '%s/%s\n' "$base" "$path" ;;
  esac
}

is_local_ready() {
  curl -fsS --max-time 2 "$(join_url "$LOCAL_BASE" "/api/health")" >/dev/null 2>&1
}

if [ -z "$TARGET_URL" ]; then
  case "$MODE" in
    local)
      TARGET_URL="$(join_url "$LOCAL_BASE" "$PATH_SUFFIX")"
      ;;
    public)
      TARGET_URL="$(join_url "$PUBLIC_BASE" "$PATH_SUFFIX")"
      ;;
    auto)
      if is_local_ready; then
        TARGET_URL="$(join_url "$LOCAL_BASE" "$PATH_SUFFIX")"
      else
        TARGET_URL="$(join_url "$PUBLIC_BASE" "$PATH_SUFFIX")"
      fi
      ;;
    *)
      echo "unsupported mode: $MODE" >&2
      exit 1
      ;;
  esac
fi

if [ "$PRINT_ONLY" = "1" ]; then
  printf '%s\n' "$TARGET_URL"
  exit 0
fi

if command -v open >/dev/null 2>&1; then
  open -a "$CHROME_APP" "$TARGET_URL"
  printf '[open-office-ui] opened %s in %s\n' "$TARGET_URL" "$CHROME_APP"
  exit 0
fi

echo "macOS open command not found; use this URL manually: $TARGET_URL" >&2
exit 1
