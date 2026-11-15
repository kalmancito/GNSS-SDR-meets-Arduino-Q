#!/usr/bin/env bash
# Build the product: the GNSS-SDR receiver image, or a single recipe of it.
#
#   scripts/build-gnss-image.sh                    image for the product
#   scripts/build-gnss-image.sh --debug            image with password-less root (bring-up)
#   scripts/build-gnss-image.sh --recipe gnss-sdr  only that recipe (test B03)
#   scripts/build-gnss-image.sh --parse            only parse all recipes (test B02)
#   scripts/build-gnss-image.sh --linux-arduino    use Arduino's kernel instead of the BSP default
#
# Anything after "--" is passed to bitbake / kas.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_linux

kas_files="kas/uno-q-gnss-sdr.yml"
recipe=""
parse_only=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --debug) kas_files="$kas_files:kas/include/debug.yml" ;;
        --linux-arduino) kas_files="$kas_files:kas/include/linux-arduino.yml" ;;
        --recipe) recipe="${2:?--recipe needs a recipe name}"; shift ;;
        --parse) parse_only=1 ;;
        --) shift; break ;;
        -h | --help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option $1 (see --help)" ;;
    esac
    shift
done

mkdir -p "$LOG_DIR" "$DL_DIR" "$SSTATE_DIR"
cd "$REPO_DIR"

if [ "$parse_only" -eq 1 ]; then
    log="$LOG_DIR/parse-$(timestamp).log"
    info "Parsing all recipes ($kas_files). Log: $log"
    set +e
    kas_container shell "$kas_files" -c 'bitbake -p && bitbake-layers show-layers' 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    set -e
    [ "$rc" -eq 0 ] || die "parse failed (exit $rc). Log: $log"
    info "B02 PASS."
    exit 0
fi

if [ -n "$recipe" ]; then
    log="$LOG_DIR/build-$recipe-$(timestamp).log"
    info "Building recipe $recipe ($kas_files). Log: $log"
    set +e
    kas_container build "$kas_files" --target "$recipe" "$@" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    set -e
    [ "$rc" -eq 0 ] || die "$recipe failed (exit $rc). Log: $log"
    info "$recipe built. Inspect it with scripts/inspect-bitbake.sh $recipe"
    exit 0
fi

if [ ! -f local/authorized_keys ] && [[ "$kas_files" != *debug.yml* ]]; then
    warn "local/authorized_keys does not exist: the product image will have no way to log in."
    warn "Create it (see local/README.md) or build with --debug for bring-up."
fi

log="$LOG_DIR/build-image-$(timestamp).log"
info "Building gnss-uno-q-image ($kas_files). Log: $log"
set +e
kas_container build "$kas_files" "$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e
[ "$rc" -eq 0 ] || die "image build failed (exit $rc). Log: $log"

info "Image built. Next: scripts/validate-image.sh"
