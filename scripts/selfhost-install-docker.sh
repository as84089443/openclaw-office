#!/bin/sh
set -euo pipefail

log() {
  printf '[openclaw-install-docker] %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    echo "need root or sudo for: $*" >&2
    return 1
  fi
}

detect_pkg_manager() {
  if need_cmd apt-get; then
    echo apt
    return 0
  fi
  if need_cmd dnf; then
    echo dnf
    return 0
  fi
  if need_cmd yum; then
    echo yum
    return 0
  fi
  if need_cmd apk; then
    echo apk
    return 0
  fi
  if need_cmd brew; then
    echo brew
    return 0
  fi
  echo unknown
}

install_docker() {
  pm="$(detect_pkg_manager)"
  case "$pm" in
    apt|dnf|yum|apk)
      if [ "$pm" = "apt" ]; then
        run_as_root apt-get update
      fi
      run_as_root sh -c 'curl -fsSL https://get.docker.com | sh'
      ;;
    brew)
      log "install via brew"
      if need_cmd docker; then
        log "docker already present"
      else
        if brew list --formula | grep -Fxq docker; then
          brew upgrade docker
        else
          brew install docker
        fi
      fi
      ;;
    *)
      log "no supported package manager found, use official installer"
      log "trying docker convenience installer"
      run_as_root sh -c "curl -fsSL https://get.docker.com | sh"
      ;;
  esac

  run_as_root systemctl enable docker || true
  run_as_root systemctl start docker || true
}

if need_cmd docker; then
  log "docker already installed: $(docker --version 2>/dev/null || true)"
  exit 0
fi

log "docker not found, starting auto-install"
install_docker

if need_cmd docker; then
  log "docker installed: $(docker --version 2>/dev/null || true)"
  log "autoinstall complete"
  exit 0
fi

echo "docker install failed" >&2
exit 1
