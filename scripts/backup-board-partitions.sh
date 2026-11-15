#!/usr/bin/env bash
# Back up the UNO Q's device-specific eMMC partitions before flashing.
#
#   scripts/backup-board-partitions.sh arduino@<board> [output-dir]
#
# Run it against the FACTORY system, from the PC. It asks for the board's sudo
# password once (reading block devices needs root).
#
# What it saves (to local/board-backup-<date>/ by default; ignored by git):
#   persist, modemst1, modemst2, fsg, fsc   calibration and the modem/Wi-Fi DSP
#                                           file system served by rmtfs
#   devinfo, frp, keystore, misc, secdata,  small state/identity partitions
#   uefivarstore, limits, ssd, dip
#   mmcblk0boot0, mmcblk0boot1              the eMMC hardware boot areas, whole:
#                                           Bluetooth and Wi-Fi MAC addresses
#                                           (bdaddr, wlanaddr), a persist copy, CDT
#   emmc-cid.txt                            identifies the eMMC chip (this board)
#   SHA256SUMS, README.md
#
# Why: the Yocto partition layout places these partitions at different
# offsets from the factory one (docs/flashing-and-recovery.md), so after a
# flash their old content is no longer where the firmware looks for it, and
# restoring the factory image does not bring it back. These files are the only
# way to put it back.
#
# Effect on the board: the images are written to /tmp, which must be a tmpfs
# (RAM); the script refuses otherwise. They are copied to the PC and deleted.
# Nothing is written to the eMMC. Partitions are only read.
#
# The output contains this board's MAC addresses: keep it private, do not
# commit it.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

target="${1:-}"
[ -n "$target" ] && [ "${target#-}" = "$target" ] || { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
out="${2:-$REPO_DIR/local/board-backup-$(date -u +%Y%m%d)}"
remote_dir=/tmp/unoq-partition-backup

need ssh
need sha256sum
[ ! -e "$out" ] || die "$out already exists; choose another directory so backups cannot be mixed."

ssh -o BatchMode=yes -o ConnectTimeout=10 "$target" true \
    || die "cannot log in to $target without a password (set up an SSH key first)."
login_user="$(ssh -o BatchMode=yes "$target" 'id -un')"
case "$login_user" in
    '' | *[!A-Za-z0-9_.-]*) die "unexpected remote user name; refusing to build the sudo command." ;;
esac

# Runs as root on the board. POSIX sh; passed base64-encoded so no quoting
# survives two shells.
remote_script='set -eu
owner="$1"
dir='"$remote_dir"'
fstype=$(findmnt -n -o FSTYPE -T /tmp || true)
if [ "$fstype" != tmpfs ]; then
    echo "/tmp is \"$fstype\", not tmpfs: refusing to put the backup on the eMMC." >&2
    exit 1
fi
rm -rf "$dir"
mkdir -m 700 "$dir"
cd "$dir"
for label in persist modemst1 modemst2 fsg fsc devinfo frp keystore misc secdata uefivarstore limits ssd dip; do
    dev=""
    # Main eMMC area only: the name "persist" also exists in boot0.
    for d in /sys/class/block/mmcblk0p*; do
        if [ "$(sed -n "s/^PARTNAME=//p" "$d/uevent")" = "$label" ]; then dev="/dev/$(basename "$d")"; break; fi
    done
    if [ -z "$dev" ]; then echo "  skip  $label (no such partition)"; continue; fi
    dd if="$dev" of="$label.img" bs=64k status=none
    echo "  saved $label from $dev ($(stat -c %s "$label.img") bytes)"
done
for b in mmcblk0boot0 mmcblk0boot1; do
    if [ -b "/dev/$b" ]; then
        dd if="/dev/$b" of="$b.img" bs=64k status=none
        echo "  saved $b, whole hardware boot area ($(stat -c %s "$b.img") bytes)"
    fi
done
cat /sys/class/block/mmcblk0/device/cid > emmc-cid.txt 2>/dev/null || true
for d in /sys/class/block/mmcblk0p* /sys/class/block/mmcblk0boot*p*; do
    echo "$(basename "$d") $(sed -n "s/^PARTNAME=//p" "$d/uevent") $(cat "$d/start") $(cat "$d/size")"
done | sort -k1,1V > partition-offsets.txt
sha256sum ./*.img emmc-cid.txt partition-offsets.txt > SHA256SUMS
chown -R -- "$owner" "$dir"
'
encoded="$(printf '%s' "$remote_script" | base64 | tr -d '\n')"

info "Reading partitions on $target (enter the board's sudo password when asked)"
# -t: sudo needs a terminal for the password prompt. Decode inside the root
# shell, then feed the script to sh on stdin. Decoding into sh -c would break
# when the script contains quotes or newlines.
ssh -t "$target" "sudo sh -c 'printf %s $encoded | base64 -d | sh -s -- $login_user'" \
    || die "the backup failed on the board; nothing was copied."

info "Copying to $out"
mkdir -p "$out"
ssh -o BatchMode=yes "$target" "tar -C $remote_dir -cf - ." | tar -xf - -C "$out"
ssh -o BatchMode=yes "$target" "rm -rf $remote_dir"

(cd "$out" && sha256sum -c --quiet SHA256SUMS) || die "checksum mismatch after the copy: do not rely on $out."
for f in modemst1 modemst2 fsg fsc mmcblk0boot0; do
    [ -s "$out/$f.img" ] || die "$f.img is missing or empty: the backup is incomplete."
done

cat > "$out/README.md" << EOF
# Partition backup of an Arduino UNO Q

Taken on $(date -u +%Y-%m-%d) (UTC) from \`$target\` with \`scripts/backup-board-partitions.sh\`,
while the board ran: $(ssh -o BatchMode=yes "$target" '. /etc/os-release; echo "$PRETTY_NAME, kernel $(uname -r)"').

**Contains this board's MAC addresses. Private: do not commit or publish.**
These images belong to this board only (eMMC CID in \`emmc-cid.txt\`).
Never write them to another board.

\`partition-offsets.txt\`: name, first sector and size (512-byte sectors) of
each partition at the time of the backup. \`SHA256SUMS\`: checksums of the images.

How and when to restore them: docs/flashing-and-recovery.md, section
"Calibration and identity partitions".
EOF

info "Backup complete and verified:"
ls -l "$out" | sed 's/^/    /'
