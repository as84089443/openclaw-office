#!/bin/sh
set -euo pipefail

# Canonical single-node selfhost entrypoint for operators.

log() {
  if [ "${OPENCLAW_SELFHOST_QUIET:-0}" != "1" ]; then
    printf '[openclaw-zero-touch] %s\n' "$1"
  fi
}

run_quiet_command() {
  label="$1"
  shift

  if [ "$quiet" != "1" ]; then
    "$@"
    return
  fi

  mkdir -p /tmp/openclaw-selfhost-logs
  log_file="/tmp/openclaw-selfhost-logs/${label}-$(date +%Y%m%d%H%M%S).log"

  if "$@" >"$log_file" 2>&1; then
    return 0
  fi
  rc=$?
  {
    echo "[openclaw-zero-touch] command failed: $label" >&2
    echo "[openclaw-zero-touch] log: $log_file" >&2
    tail -n 80 "$log_file" >&2
  } || true
  return "$rc"
}

ensure_required_scripts() {
  for required in \
    "$project_root/scripts/selfhost-auto-deploy.sh" \
    "$project_root/scripts/selfhost-autopilot.sh" \
    "$project_root/scripts/selfhost-one-click.sh"
  do
    if [ ! -f "$required" ]; then
      echo "required selfhost script not found: $required" >&2
      echo "the target checkout is missing the selfhost automation files; sync or publish the updated repo before zero-touch deploy" >&2
      return 1
    fi
  done
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    return 1
  fi
}

usage() {
  cat <<'EOF'
Usage: selfhost-zero-touch-deploy.sh [options]

Options:
  --mode host|nas               執行模式，預設 host
  --public-url <url>            公網入口 URL（host mode 使用）
  --skip-public                 禁用 public compose
  --root <path>                 專案根目錄（預設：當前工作目錄）
  --host-root <path>            host 模式下的 --root 別名
  --nas-root <path>             nas 模式下的 --root 別名
  --repo-url <url>              不存在時 clone 的來源（預設 https://github.com/as84089443/openclaw-office.git）
  --branch <name>               需要 checkout/pull 的分支（預設 master）
  --bootstrap-env <file>        以這個 env 檔覆蓋/補齊 runtime env（可選）
  --git-sync                    同步 git（預設不 pull，避免本機脏檔阻塞）
  --install-docker              Docker 不在本機時自動安裝
  --dry-run                     僅輸出演算的指令，不實際部署
  --quiet                       不輸出中間流程（只保留錯誤與完成訊息）
  --help                        顯示說明
EOF
}

mode="host"
public_url="${OFFICE_PUBLIC_URL:-https://copilot.bw-space.com}"
skip_public="0"
project_root="${OPENCLAW_PROJECT_ROOT:-$(pwd)}"
repo_url="${OPENCLAW_SELFHOST_REPO_URL:-https://github.com/as84089443/openclaw-office.git}"
repo_branch="${OPENCLAW_SELFHOST_REPO_BRANCH:-master}"
bootstrap_env="${OPENCLAW_SELFHOST_BOOTSTRAP_ENV:-}"
auto_install_docker="0"
dry_run="0"
git_sync="0"
quiet="${OPENCLAW_SELFHOST_QUIET:-0}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      mode="$2"
      shift 2
      ;;
    --public-url)
      public_url="$2"
      shift 2
      ;;
    --skip-public)
      skip_public="1"
      shift
      ;;
    --root)
      project_root="$2"
      shift 2
      ;;
    --host-root)
      project_root="$2"
      shift 2
      ;;
    --nas-root)
      project_root="$2"
      shift 2
      ;;
    --repo-url)
      repo_url="$2"
      shift 2
      ;;
    --branch)
      repo_branch="$2"
      shift 2
      ;;
    --bootstrap-env)
      bootstrap_env="$2"
      shift 2
      ;;
    --git-sync)
      git_sync="1"
      shift
      ;;
    --install-docker)
      auto_install_docker="1"
      shift
      ;;
    --dry-run)
      dry_run="1"
      shift
      ;;
    --quiet)
      quiet="1"
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

export OPENCLAW_SELFHOST_QUIET="$quiet"

if [ "$mode" != "host" ] && [ "$mode" != "nas" ]; then
  echo "invalid --mode: $mode (host|nas)" >&2
  exit 1
fi

if [ "$mode" = "nas" ]; then
  skip_public="1"
fi

if [ ! -d "$project_root" ]; then
  mkdir -p "$project_root"
fi

if [ ! -d "$project_root" ]; then
  echo "project root not found: $project_root" >&2
  exit 1
fi

if [ -z "${OPENCLAW_PROJECT_ROOT:-}" ]; then
  export OPENCLAW_PROJECT_ROOT="$project_root"
fi

merge_env_file() {
  source_file="$1"
  target_file="$2"

  if [ ! -f "$source_file" ]; then
    echo "[openclaw-zero-touch] skip merge: bootstrap env not found: $source_file" >&2
    return 0
  fi

  if [ ! -f "$target_file" ]; then
    mkdir -p "$(dirname "$target_file")"
    cp "$source_file" "$target_file"
    return 0
  fi

  python3 - "$source_file" "$target_file" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])

def parse_env(path):
  values = {}
  order = []
  for line in path.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
      continue
    if "=" not in line:
      continue
    k, v = line.split("=", 1)
    values[k.strip()] = v
    order.append((k.strip(), v))
  return values, order

if target.read_text(encoding="utf-8").strip() == "":
  target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
  raise SystemExit(0)

source_values, source_order = parse_env(source)
target_lines = target.read_text(encoding="utf-8").splitlines()
index_by_key = {}
for i, line in enumerate(target_lines):
  if line.strip().startswith("#") or "=" not in line:
    continue
  key = line.split("=", 1)[0].strip()
  if key not in index_by_key:
    index_by_key[key] = i

for key, val in source_order:
  if key in index_by_key:
    target_lines[index_by_key[key]] = f"{key}={val}"
  else:
    target_lines.append(f"{key}={val}")

target.write_text("\n".join(target_lines) + "\n", encoding="utf-8")
PY
}

bootstrap_runtime() {
  cd "$project_root"

  if [ -d .git ]; then
    if [ "$git_sync" = "1" ]; then
      log "detected existing git checkout; sync branch and pull"
      need_cmd git
      git config user.name >/dev/null 2>&1 || true
      git fetch --all --prune
      if git rev-parse --verify --quiet "$repo_branch" >/dev/null 2>&1; then
        git checkout "$repo_branch"
      else
        if git ls-remote --heads origin "$repo_branch" >/dev/null 2>&1; then
          git checkout -b "$repo_branch" "origin/$repo_branch"
        else
          log "repo branch not found locally/remote: $repo_branch, keep current branch"
        fi
      fi
      git pull --ff-only "origin" "$repo_branch" || log "pull skipped (offline or no remote branch changes)"
    else
      log "git sync disabled; keep existing checkout and continue runtime bootstrap"
    fi
  else
    if [ -z "$(ls -A "$project_root" 2>/dev/null)" ]; then
      need_cmd git
      if ! git clone --depth=1 --branch "$repo_branch" "$repo_url" "$project_root"; then
        log "branch clone failed, fallback to default branch"
        git clone --depth=1 "$repo_url" "$project_root"
      fi
      log "cloned repository to $project_root"
      cd "$project_root"
      if git rev-parse --verify --quiet "$repo_branch" >/dev/null 2>&1; then
        git checkout "$repo_branch" >/dev/null 2>&1 || true
      elif git ls-remote --heads origin "$repo_branch" >/dev/null 2>&1; then
        git checkout -b "$repo_branch" "origin/$repo_branch" >/dev/null 2>&1 || true
      fi
    else
      log "project root has non-git files; skipped git bootstrap"
    fi
  fi

  mkdir -p runtime
  if [ -f runtime/.env.production ]; then
    log "runtime env exists: runtime/.env.production"
  elif [ -f .env.example ]; then
    cp .env.example runtime/.env.production
    log "created runtime env from .env.example"
  else
    printf 'FNB_PUBLIC_BASE_URL=%s\n' "$public_url" > runtime/.env.production
    log "created minimal runtime env"
  fi

  if [ -n "$bootstrap_env" ]; then
    merge_env_file "$bootstrap_env" "$project_root/runtime/.env.production"
    log "merged bootstrap env: $bootstrap_env"
  fi

  if [ ! -f "$project_root/runtime/openclaw.json" ] && [ -f openclaw.json ]; then
    cp openclaw.json runtime/openclaw.json
    log "copied openclaw.json to runtime"
  fi
  if [ ! -f "$project_root/runtime/openclaw-office.config.json" ] && [ -f openclaw-office.config.json ]; then
    cp openclaw-office.config.json runtime/openclaw-office.config.json
    log "copied openclaw-office.config.json to runtime"
  fi
  mkdir -p runtime/openclaw-state
  if [ -f "$HOME/.openclaw/identity/device.json" ]; then
    cp "$HOME/.openclaw/identity/device.json" runtime/openclaw-state/device.json
  elif [ ! -f runtime/openclaw-state/device.json ]; then
    printf '{}\n' > runtime/openclaw-state/device.json
  fi
  if [ -f "$HOME/.openclaw/identity/device-auth.json" ]; then
    cp "$HOME/.openclaw/identity/device-auth.json" runtime/openclaw-state/device-auth.json
  elif [ ! -f runtime/openclaw-state/device-auth.json ]; then
    printf '{}\n' > runtime/openclaw-state/device-auth.json
  fi
}

run_autopilot() {
  args="--mode $mode"
  if [ "$mode" = "host" ] && [ -n "$public_url" ]; then
    args="$args --public-url $public_url"
  fi
  if [ "$skip_public" = "1" ]; then
    args="$args --skip-public"
  fi
  if [ "$auto_install_docker" = "1" ]; then
    args="$args --install-docker"
  fi

  if [ "$dry_run" = "1" ]; then
    if [ "$quiet" != "1" ]; then
      log "dry-run mode active"
      log "target project: $project_root"
      log "repo: ${repo_url} (branch ${repo_branch})"
      log "bootstrap env: ${bootstrap_env:-<none>}"
      log "would execute:"
    fi
    log "OPENCLAW_PROJECT_ROOT=$project_root OPENCLAW_RUNTIME_ENV=runtime/.env.production OPENCLAW_SOURCE_OPENCLAW_JSON=$project_root/openclaw.json OPENCLAW_SOURCE_OFFICE_CONFIG=$project_root/openclaw-office.config.json sh scripts/selfhost-auto-deploy.sh $args"
    return 0
  fi

  if [ "$auto_install_docker" = "1" ] && [ ! -x "$project_root/scripts/selfhost-install-docker.sh" ]; then
    echo "missing selfhost-install-docker.sh in project root" >&2
    exit 1
  fi

  cd "$project_root"
  ensure_required_scripts
  run_quiet_command "auto-deploy" \
    env \
    OPENCLAW_PROJECT_ROOT="$project_root" \
    OPENCLAW_RUNTIME_ENV="runtime/.env.production" \
    OPENCLAW_SOURCE_OPENCLAW_JSON="$project_root/openclaw.json" \
    OPENCLAW_SOURCE_OFFICE_CONFIG="$project_root/openclaw-office.config.json" \
    OPENCLAW_SELFHOST_MODE="$mode" \
    sh scripts/selfhost-auto-deploy.sh $args
}

cd "$project_root"
if [ "$dry_run" != "1" ]; then
  need_cmd curl
fi
if [ "$dry_run" != "1" ] && { [ -n "$bootstrap_env" ] || [ ! -f "$project_root/runtime/.env.production" ]; }; then
  need_cmd python3
fi

if [ "$dry_run" = "1" ]; then
  run_autopilot
  exit 0
fi

bootstrap_runtime
ensure_required_scripts

run_autopilot

if [ "$dry_run" != "1" ]; then
  if [ "$mode" = "host" ] && [ "$skip_public" != "1" ]; then
    log "health check (public): $public_url/api/health"
  else
    log "health check (local): http://127.0.0.1:4200/api/health"
  fi
  if [ "$quiet" = "1" ]; then
    printf '%s\n' '[openclaw-zero-touch] done'
  else
    log "zero-touch deploy complete"
  fi
fi
