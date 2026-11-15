# Shared helpers for the scripts in this directory. Source it; do not run it.
# shellcheck shell=bash

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"

# kas release the BSP's own CI builds with (meta-qcom-arduino .github/workflows).
KAS_VERSION="${KAS_VERSION:-5.5}"

# Persistent caches, outside the build tree so they survive `rm -rf build`.
export DL_DIR="${DL_DIR:-$HOME/yocto-cache/downloads}"
export SSTATE_DIR="${SSTATE_DIR:-$HOME/yocto-cache/sstate-cache}"
# kas puts the build directory and the layer checkouts here.
export KAS_WORK_DIR="${KAS_WORK_DIR:-$REPO_DIR}"
export KAS_BUILD_DIR="${KAS_BUILD_DIR:-$REPO_DIR/build}"

MACHINE_NAME="uno-q"
DEPLOY_DIR="$KAS_BUILD_DIR/tmp/deploy/images/$MACHINE_NAME"
LOG_DIR="${LOG_DIR:-$REPO_DIR/artifacts/logs}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() {
    command -v "$1" > /dev/null 2>&1 || die "'$1' not found. ${2:-}"
}

require_linux() {
    [ "$(uname -s)" = "Linux" ] || die "this script must run on the Linux build host (found $(uname -s))."
}

# kas-container from PATH, or the copy bootstrap-host.sh downloads.
kas_container() {
    if command -v kas-container > /dev/null 2>&1; then
        kas-container "$@"
    elif [ -x "$HOME/.local/bin/kas-container" ]; then
        "$HOME/.local/bin/kas-container" "$@"
    else
        die "kas-container not found. Run scripts/bootstrap-host.sh --install first."
    fi
}

timestamp() { date -u +%Y%m%dT%H%M%SZ; }
