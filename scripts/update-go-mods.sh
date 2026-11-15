#!/usr/bin/env bash
# Generate the pinned list of Go modules for the arduino-router recipe.
#
#   scripts/update-go-mods.sh
#
# Runs `bitbake -c update_modules arduino-router` in the kas container. That
# task needs the network (it resolves the module graph) and writes, next to the
# recipe:
#
#   meta-gnss-uno-q/recipes-mcu/arduino-router/arduino-router-go-mods.inc
#   meta-gnss-uno-q/recipes-mcu/arduino-router/arduino-router-licenses.inc
#
# Commit both files. After that the recipe builds with no network access.
# Re-run only when the arduino-router version (SRCREV) changes.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_linux
cd "$REPO_DIR"
recipe_dir="meta-gnss-uno-q/recipes-mcu/arduino-router"

info "Resolving Go modules for arduino-router"
kas_container shell kas/uno-q-gnss-sdr.yml -c 'bitbake -c update_modules arduino-router'

for f in arduino-router-go-mods.inc arduino-router-licenses.inc; do
    [ -s "$recipe_dir/$f" ] || die "$recipe_dir/$f was not generated."
    info "$f: $(grep -c . "$recipe_dir/$f") lines"
done
info "Review and commit the two .inc files, then: scripts/build-gnss-image.sh --recipe arduino-router"
