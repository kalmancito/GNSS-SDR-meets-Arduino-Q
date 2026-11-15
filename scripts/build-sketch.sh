#!/usr/bin/env bash
# Build the LED matrix sketch for the UNO Q's STM32 with arduino-cli, on a PC.
#
#   scripts/build-sketch.sh [--out DIR]
#
# Produces, in DIR (default: artifacts/sketch):
#
#   sketch.ino.elf-zsk.bin                    the sketch
#   zephyr-arduino_uno_q_stm32u585xx.elf      the loader of the same core version
#   flash_sketch.cfg                          the OpenOCD script of that core version
#   SHA256SUMS, versions.txt
#
# The three files belong together: copy them to the board and write them with
# `gnss-mcu-flash flash LOADER SKETCH CFG --yes`.
#
# The sketch is not built by BitBake: arduino-cli downloads its core and
# toolchain itself, which a reproducible offline build cannot allow. Versions
# are pinned below instead.
#
# You only need this to CHANGE the sketch. A board that was running the demo on
# the factory image already has it: the STM32's flash is separate from the eMMC
# and is not touched when the Linux image is replaced.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CORE="arduino:zephyr"
CORE_VERSION="${CORE_VERSION:-1.1.0}"   # ArduinoCore-zephyr tag 1.1.0 = f07865dd32be
FQBN="arduino:zephyr:unoq"
LIBS=("Arduino_RouterBridge@0.4.4" "Arduino_RPClite@0.3.1" "ArduinoGraphics")
VARIANT="arduino_uno_q_stm32u585xx"

out="$REPO_DIR/artifacts/sketch"
while [ "$#" -gt 0 ]; do
    case "$1" in
        --out) out="${2:?}"; shift ;;
        -h | --help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option $1" ;;
    esac
    shift
done

need arduino-cli "Install it from https://arduino.github.io/arduino-cli/ (it is not needed on the board)."
sketch_dir="$REPO_DIR/apps/led-matrix/sketch"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT

info "Installing core $CORE@$CORE_VERSION and libraries"
arduino-cli core update-index
arduino-cli core install "$CORE@$CORE_VERSION"
for lib in "${LIBS[@]}"; do arduino-cli lib install "$lib"; done

info "Compiling $sketch_dir for $FQBN"
arduino-cli compile --fqbn "$FQBN" --build-path "$build_dir" "$sketch_dir"

data_dir="$(arduino-cli config get directories.data)"
core_dir="$data_dir/packages/arduino/hardware/zephyr/$CORE_VERSION"
loader="$core_dir/firmwares/zephyr-$VARIANT.elf"
cfg="$core_dir/variants/$VARIANT/flash_sketch.cfg"
sketch_bin="$build_dir/sketch.ino.elf-zsk.bin"
for f in "$loader" "$cfg" "$sketch_bin"; do
    [ -f "$f" ] || die "expected build product not found: $f"
done

mkdir -p "$out"
cp "$sketch_bin" "$loader" "$cfg" "$out/"
(cd "$out" && sha256sum sketch.ino.elf-zsk.bin "$(basename "$loader")" flash_sketch.cfg > SHA256SUMS)
{
    echo "built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "repository: $(git -C "$REPO_DIR" rev-parse HEAD 2> /dev/null || echo unknown)"
    echo "core: $CORE@$CORE_VERSION"
    echo "fqbn: $FQBN"
    printf 'library: %s\n' "${LIBS[@]}"
    arduino-cli version
} > "$out/versions.txt"

info "Sketch artifacts in $out:"
ls -l "$out" | sed 's/^/    /'
echo "    Copy the directory to the board, then:"
echo "    gnss-mcu-flash flash $(basename "$loader") sketch.ino.elf-zsk.bin flash_sketch.cfg --yes"
