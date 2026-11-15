#!/usr/bin/env bash
# Write the Yocto image to the UNO Q's eMMC with qdl - with the brakes on.
#
#   scripts/flash-guarded.sh [--flashdir DIR]              dry run (default)
#   scripts/flash-guarded.sh [--flashdir DIR] --execute    really write
#
# THIS ERASES THE BOARD. The Yocto partition layout replaces the factory one:
# the Debian system and everything under /home/arduino are gone afterwards.
# The dry run shows exactly which partitions would be written and checks the
# preconditions; it never talks to the device.
#
# --execute additionally requires:
#   * the board visible in EDL mode (USB id 05c6:9008),
#   * --recovery-image FILE: the factory image, already downloaded, as proof
#     that there is a way back (docs/flashing-and-recovery.md),
#   * --inventory DIR: the output of scripts/capture-board-info.sh,
#   * typing the confirmation phrase.
#
# Entering EDL needs a jumper on the JCTL header (GND - USB_BOOT) fitted BEFORE
# plugging USB-C. That is a manual step; see docs/flashing-and-recovery.md.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

EDL_USB_ID="05c6:9008"
CONFIRM_PHRASE="erase the eMMC of this UNO Q"

image="gnss-uno-q-image"
flashdir=""
execute=0
recovery=""
inventory=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --flashdir) flashdir="${2:?}"; shift ;;
        --image) image="${2:?}"; shift ;;
        --execute) execute=1 ;;
        --recovery-image) recovery="${2:?}"; shift ;;
        --inventory) inventory="${2:?}"; shift ;;
        -h | --help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option $1 (see --help)" ;;
    esac
    shift
done

if [ -z "$flashdir" ]; then
    flashdir="$(ls -1dt "$DEPLOY_DIR/$image-$MACHINE_NAME"*.qcomflash 2> /dev/null | head -n 1 || true)"
fi
[ -n "$flashdir" ] && [ -d "$flashdir" ] || die "no qcomflash directory found. Build the image or pass --flashdir DIR."
flashdir="$(cd "$flashdir" && pwd)"

# ---- 1. is this really an UNO Q eMMC image? ---------------------------------------
info "Flash directory: $flashdir"
for f in rawprogram0.xml patch0.xml prog_firehose_ddr.elf; do
    [ -f "$flashdir/$f" ] || die "$f is missing from $flashdir: not a complete qcomflash directory."
done
[ -f "$flashdir/contents.xml" ] && grep -qi 'emmc' "$flashdir/contents.xml" \
    || die "contents.xml does not describe an eMMC image. The UNO Q has an eMMC; refusing to continue."
case "$(basename "$flashdir")" in
    *"$MACHINE_NAME"*) ;;
    *) die "'$(basename "$flashdir")' does not look like an image for machine $MACHINE_NAME. Files built for another board (e.g. RB3 Gen 2) must never be written to an UNO Q." ;;
esac

# ---- 2. what would be written --------------------------------------------------------
info "Partitions that will be written (from rawprogram0.xml):"
python3 - "$flashdir/rawprogram0.xml" "$flashdir" << 'EOF'
import os, sys, xml.etree.ElementTree as ET
xml, base = sys.argv[1], sys.argv[2]
rows, missing = [], 0
for prog in ET.parse(xml).getroot().iter("program"):
    name = prog.get("filename") or ""
    if not name:
        continue  # declared in the table but left untouched
    path = os.path.join(base, name)
    size = os.path.getsize(path) if os.path.exists(path) else None
    missing += size is None
    rows.append((prog.get("label", "?"), name, size))
print("    %-18s %-34s %s" % ("PARTITION", "FILE", "SIZE"))
for label, name, size in rows:
    print("    %-18s %-34s %s" % (label, name, "MISSING" if size is None else "%.1f MiB" % (size / 2**20)))
print("    %d partitions written; the GPT is replaced (patch0.xml)." % len(rows))
sys.exit(1 if missing else 0)
EOF

cmd=(qdl --storage emmc --debug prog_firehose_ddr.elf rawprogram0.xml patch0.xml)
info "Command (run inside the flash directory):"
echo "    ${cmd[*]}"
echo "    --storage emmc is essential: qdl assumes UFS by default."

if [ "$execute" -ne 1 ]; then
    echo
    info "Dry run: nothing was written and the device was not contacted."
    echo "    To flash: fit the EDL jumper, connect the board, then re-run with"
    echo "    --execute --recovery-image FILE --inventory DIR"
    exit 0
fi

# ---- 3. preconditions for a real write --------------------------------------------------
require_linux
need qdl "Build it from https://github.com/linux-msm/qdl (v2.x) or install your distribution's package."
need lsusb "Install usbutils."

[ -n "$recovery" ] && [ -s "$recovery" ] \
    || die "--recovery-image FILE is required and must exist: download the factory image first ('arduino-flasher-cli download unoq'), so the board can be restored whatever happens."
[ -n "$inventory" ] && [ -f "$inventory/block-devices.txt" ] \
    || die "--inventory DIR is required: run scripts/capture-board-info.sh against the factory system first."
info "Recovery image: $recovery ($(du -h "$recovery" | cut -f1))"
info "Inventory     : $inventory"

if systemctl is-active --quiet ModemManager 2> /dev/null; then
    die "ModemManager is running and will grab the EDL serial port. Stop it first: sudo systemctl stop ModemManager"
fi

lsusb -d "$EDL_USB_ID" > /dev/null 2>&1 \
    || die "no device in EDL mode ($EDL_USB_ID). Unplug the board, short GND and USB_BOOT on the JCTL header, plug USB-C again. In normal mode the board shows up as 2341:0078."
[ "$(lsusb -d "$EDL_USB_ID" | wc -l)" -eq 1 ] \
    || die "more than one device in EDL mode is connected; disconnect the others."

echo
warn "About to ERASE the eMMC of the connected board and write the image above."
warn "The factory system and the data in /home/arduino will be lost."
read -r -p "Type '$CONFIRM_PHRASE' to continue: " answer
[ "$answer" = "$CONFIRM_PHRASE" ] || die "confirmation phrase not entered; nothing was written."

mkdir -p "$LOG_DIR"
log="$LOG_DIR/flash-$(timestamp).log"
info "Flashing. Do not unplug the board. Log: $log"
set +e
(cd "$flashdir" && "${cmd[@]}") 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e
[ "$rc" -eq 0 ] || die "qdl failed (exit $rc). The board may not boot: do NOT retry blindly, read $log and docs/flashing-and-recovery.md."

info "Flash completed. Remove the EDL jumper, power-cycle the board and watch the serial console."
