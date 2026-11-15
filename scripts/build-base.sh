#!/usr/bin/env bash
# Build the pinned Qualcomm BSP image for the UNO Q, without the product layer.
# This is the reference point (test B01): if it does not build, nothing on top
# of it will, and the problem is not in this repository's layer.
#
#   scripts/build-base.sh [extra kas-container build arguments]
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_linux
mkdir -p "$LOG_DIR" "$DL_DIR" "$SSTATE_DIR"
log="$LOG_DIR/build-base-$(timestamp).log"

info "kas file : kas/uno-q-upstream.yml"
info "Caches   : DL_DIR=$DL_DIR  SSTATE_DIR=$SSTATE_DIR"
info "Log      : $log"

cd "$REPO_DIR"
set +e
kas_container build kas/uno-q-upstream.yml "$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e
[ "$rc" -eq 0 ] || die "base build failed (exit $rc). Log: $log"

info "Artifacts in $DEPLOY_DIR:"
ls -1 "$DEPLOY_DIR" | sed 's/^/    /'
info "B01 PASS. Next: scripts/build-gnss-image.sh"
