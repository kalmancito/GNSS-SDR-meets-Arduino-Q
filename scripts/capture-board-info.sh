#!/usr/bin/env bash
# Take a read-only inventory of an UNO Q over SSH, and copy its GNSS-SDR
# configuration files. Run it against the FACTORY (Debian) system BEFORE the
# first flash: flashing the Yocto image erases /home/arduino, and the partition
# table, kernel and GPIO layout recorded here are the reference for recovery
# and for the MCU link.
#
#   scripts/capture-board-info.sh arduino@<board> [output-dir]
#
# Nothing is modified on the board. Serial numbers and MAC addresses are
# masked in the saved files so they can be committed to a public repository;
# pass --raw to keep them (do not commit the result).
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

raw=0
args=()
for a in "$@"; do
    case "$a" in
        --raw) raw=1 ;;
        -h | --help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) args+=("$a") ;;
    esac
done
target="${args[0]:-}"
[ -n "$target" ] || die "usage: $0 user@board [output-dir]"
out="${args[1]:-$REPO_DIR/docs/logs/board-inventory-$(date -u +%Y%m%d)}"

need ssh
ssh_cmd=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$target")
"${ssh_cmd[@]}" true || die "cannot log in to $target without a password (set up an SSH key first)."

mkdir -p "$out"
info "Saving inventory of $target to $out"

mask() {
    if [ "$raw" -eq 1 ]; then
        cat
    else
        # MAC addresses, anything labelled as a serial number, the systemd
        # machine id (32 hex digits, also in journal paths) and filesystem UUIDs.
        sed -E 's/([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}/XX:XX:XX:XX:XX:XX/g; s/([Ss]erial( [Nn]umber)?[^:=]*[:=][[:space:]]*)[A-Za-z0-9._-]+/\1<masked>/; s/[0-9a-f]{32}/<machine-id>/g; s/(UUID=)[0-9a-fA-F-]+/\1<masked>/g'
    fi
}

# name | command (run remotely, read-only; failures are recorded, not fatal)
run() {
    local name="$1" cmd="$2"
    {
        echo "\$ $cmd"
        "${ssh_cmd[@]}" "$cmd" 2>&1 || echo "[exit status $?]"
    } | mask > "$out/$name.txt"
    printf '    %-22s %s lines\n' "$name" "$(wc -l < "$out/$name.txt")"
}

run os-release      'cat /etc/os-release'
run uname           'uname -a'
run model           'cat /sys/firmware/devicetree/base/model 2>/dev/null; echo; tr "\0" "\n" < /sys/firmware/devicetree/base/compatible 2>/dev/null'
run cpuinfo         'lscpu 2>/dev/null || cat /proc/cpuinfo'
run meminfo         'head -n 8 /proc/meminfo; free -m'
run block-devices   'lsblk -o NAME,SIZE,TYPE,FSTYPE,PARTLABEL,MOUNTPOINTS 2>/dev/null || lsblk'
run partitions      'ls -l /dev/disk/by-partlabel/ 2>/dev/null; cat /proc/partitions'
# Name, first sector and size (512-byte sectors) of every eMMC partition,
# including the hardware boot areas. flash-guarded.sh compares these with the
# layout it is about to write. Readable without root.
run partition-offsets 'for d in /sys/class/block/mmcblk0p* /sys/class/block/mmcblk0boot*p*; do echo "$(basename $d) $(sed -n "s/^PARTNAME=//p" $d/uevent) $(cat $d/start) $(cat $d/size)"; done | sort -k1,1V; echo; systemctl cat rmtfs.service 2>/dev/null | grep ^ExecStart'
run mounts          'findmnt -A 2>/dev/null || mount'
run disk-usage      'df -h'
run kernel-cmdline  'cat /proc/cmdline'
run kernel-config   'zcat /proc/config.gz 2>/dev/null | grep -E "SERIAL_QCOM_GENI|GPIO_CDEV|GPIO_SYSFS|USB_DWC3|DVB_USB_RTL28XXU|CONFIG_HZ=|PREEMPT" || echo "/proc/config.gz not available"'
run modules         'lsmod'
run usb             'lsusb 2>/dev/null; echo; lsusb -t 2>/dev/null'
run serial-ports    'ls -l /dev/ttyHS* /dev/ttyMSM* /dev/ttyGS* 2>&1'
run gpio            'gpiodetect 2>&1; echo; gpioinfo 2>&1 | head -n 300'
run network         'ip -brief addr 2>/dev/null || ip addr'
run services        'systemctl list-units --type=service --state=running --no-pager; echo; systemctl --failed --no-pager'
run arduino-router  'systemctl cat arduino-router.service 2>&1; echo; arduino-router version 2>&1; ls -l /var/run/arduino-router.sock 2>&1'
run arduino-tools   'for t in arduino-app-cli arduino-cli openocd /opt/openocd/bin/openocd; do command -v $t >/dev/null 2>&1 && { echo "== $t"; $t --version 2>&1 | head -n 3; }; done; ls -la /opt/openocd 2>&1 | head -n 30'
run boot-slots      'if command -v qbootctl >/dev/null 2>&1; then qbootctl 2>&1 | grep -q "must be run as root" && sudo -n qbootctl 2>&1 || qbootctl 2>&1; else echo "qbootctl not installed"; fi'
run thermal         'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null) $(cat $z/temp 2>/dev/null)"; done'
run dmesg-tail      'dmesg 2>/dev/null | tail -n 80 || journalctl -k -n 80 --no-pager'
run gnss-sdr        'command -v gnss-sdr && gnss-sdr --version 2>&1; echo; ls -la ~/gnss-sdr 2>&1 | head -n 40'
run gnss-sdr-libs   'ldd "$(command -v gnss-sdr)" 2>&1 | head -n 60'
run volk-config     'cat ~/.volk_gnsssdr/volk_gnsssdr_config 2>&1 | head -n 200; echo; cat ~/.volk/volk_config 2>&1 | head -n 200'
run captures        'find ~ / -xdev \( -name "*.dat" -o -name "*.bin" -o -name "*.raw" \) -size +50M -printf "%s bytes  %p\n" 2>/dev/null | head -n 40'
run node            'command -v node && node --version; ls ~ 2>&1 | head -n 40'

# ---- GNSS-SDR configuration files (the important part) -------------------------------
info "Copying GNSS-SDR configuration files"
mkdir -p "$out/gnss-sdr-conf"
if "${ssh_cmd[@]}" 'test -d ~/gnss-sdr/conf'; then
    # tar over ssh: no rsync/scp needed on the board, only .conf files travel.
    # When ~/gnss-sdr is a git checkout, copy only the configurations that are
    # new or modified there; the untouched upstream examples are in GNSS-SDR's
    # own repository and would only bury the user's files.
    "${ssh_cmd[@]}" 'cd ~/gnss-sdr/conf &&
        if git -C .. rev-parse --git-dir > /dev/null 2>&1; then
            git -C .. status --porcelain --untracked-files=all -- conf | sed -n "s#^.. conf/##p" | grep "\.conf$"
        else
            find . -name "*.conf" | sed "s#^\./##"
        fi | tr "\n" "\0" | tar --null -cf - -T -' | tar -xf - -C "$out/gnss-sdr-conf"
    "${ssh_cmd[@]}" 'git -C ~/gnss-sdr log -1 --format="checkout: %h %s" 2> /dev/null' > "$out/gnss-sdr-conf/SOURCE.txt" || true
    find "$out/gnss-sdr-conf" -name '*.conf' | sed "s#^$out/#    #"
else
    warn "~/gnss-sdr/conf not found on the board; no configuration files copied."
fi

cat > "$out/README.md" << EOF
# Board inventory

Captured with \`scripts/capture-board-info.sh\` on $(date -u +%Y-%m-%d) (UTC), read-only, over SSH.
$([ "$raw" -eq 1 ] && echo "**Unmasked capture: contains serial numbers / MAC addresses. Do not publish.**" || echo "MAC addresses and serial numbers are masked.")

Each \`.txt\` file starts with the command that produced it.
\`gnss-sdr-conf/\` holds the GNSS-SDR configuration files found in \`~/gnss-sdr/conf\`.
EOF

info "Done. Review the files before committing them."
