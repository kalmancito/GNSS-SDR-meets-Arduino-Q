#!/usr/bin/env bash
# Check (and optionally prepare) the Linux build host.
#
#   scripts/bootstrap-host.sh             report only, change nothing
#   scripts/bootstrap-host.sh --install   also download kas-container to ~/.local/bin
#
# It never installs system packages: it tells you what is missing and how to
# get it. Exit status 0 = ready to build, 1 = something is missing.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install=0
[ "${1:-}" = "--install" ] && install=1

require_linux
problems=0
problem() { warn "$*"; problems=$((problems + 1)); }

info "Host: $(. /etc/os-release 2> /dev/null && echo "$PRETTY_NAME" || uname -sr), $(uname -m), $(nproc) CPUs"
[ "$(uname -m)" = "x86_64" ] || problem "the Qualcomm BSP is built and tested on x86_64 hosts; this is $(uname -m)."

# ---- memory -----------------------------------------------------------------
mem_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
swap_gb=$(awk '/SwapTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
info "Memory: ${mem_gb} GB RAM, ${swap_gb} GB swap"
if [ "$mem_gb" -lt 16 ]; then
    problem "less than 16 GB of RAM: GNU Radio, Node.js and the kernel link steps may be killed by the OOM killer. Add swap and limit parallelism (BB_NUMBER_THREADS, PARALLEL_MAKE)."
fi

# ---- disk -------------------------------------------------------------------
mkdir -p "$DL_DIR" "$SSTATE_DIR"
for dir in "$KAS_WORK_DIR" "$DL_DIR" "$SSTATE_DIR"; do
    free_gb=$(df -BG --output=avail "$dir" | tail -n 1 | tr -dc '0-9')
    info "Free space under $dir: ${free_gb} GB"
done
work_free=$(df -BG --output=avail "$KAS_WORK_DIR" | tail -n 1 | tr -dc '0-9')
[ "$work_free" -ge 120 ] || problem "less than 120 GB free under $KAS_WORK_DIR (build tree + layers; rm_work is enabled but peaks are large)."

# ---- container runtime --------------------------------------------------------
runtime=""
if command -v docker > /dev/null 2>&1; then
    runtime=docker
    if ! docker info > /dev/null 2>&1; then
        problem "docker is installed but this user cannot talk to the daemon. Add the user to the 'docker' group (then log in again) or start the service."
    fi
elif command -v podman > /dev/null 2>&1; then
    runtime=podman
else
    problem "neither docker nor podman found. Install one, e.g. on Debian/Ubuntu: sudo apt install docker.io && sudo usermod -aG docker \$USER"
fi
[ -n "$runtime" ] && info "Container runtime: $runtime ($($runtime --version 2> /dev/null | head -n 1))"

# ---- tools --------------------------------------------------------------------
for tool in git python3 curl; do
    command -v "$tool" > /dev/null 2>&1 || problem "'$tool' not found."
done

# ---- kas-container --------------------------------------------------------------
if command -v kas-container > /dev/null 2>&1 || [ -x "$HOME/.local/bin/kas-container" ]; then
    info "kas-container: found"
elif [ "$install" -eq 1 ]; then
    info "Downloading kas-container $KAS_VERSION to ~/.local/bin"
    mkdir -p "$HOME/.local/bin"
    curl -fsSL -o "$HOME/.local/bin/kas-container" \
        "https://raw.githubusercontent.com/siemens/kas/$KAS_VERSION/kas-container"
    chmod +x "$HOME/.local/bin/kas-container"
else
    problem "kas-container not found. Re-run with --install to download version $KAS_VERSION to ~/.local/bin."
fi

# ---- network ---------------------------------------------------------------------
for url in https://github.com https://git.yoctoproject.org https://gitlab.com; do
    curl -fsS --max-time 15 -o /dev/null "$url" || problem "cannot reach $url (needed to fetch sources)."
done

echo
if [ "$problems" -eq 0 ]; then
    info "Host is ready. Next: scripts/build-base.sh"
else
    die "$problems problem(s) found; see the warnings above."
fi
