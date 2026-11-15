#!/usr/bin/env bash
# Check the build output without a board: the image contains what it should,
# the receiver binary is a 64-bit ARM executable, the flashing artifacts are
# there, and the device tree has the UART to the STM32.
#
#   scripts/validate-image.sh [--image gnss-uno-q-image] [--deploy DIR]
#
# Prints one line per check (PASS / FAIL / SKIP) and exits non-zero if any
# check failed. SKIP means "could not be checked here", never "fine".
# Passing this script says nothing about behaviour on hardware.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

image="gnss-uno-q-image"
deploy="$DEPLOY_DIR"
while [ "$#" -gt 0 ]; do
    case "$1" in
        --image) image="${2:?}"; shift ;;
        --deploy) deploy="${2:?}"; shift ;;
        -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option $1" ;;
    esac
    shift
done

[ -d "$deploy" ] || die "deploy directory $deploy not found. Build first (scripts/build-gnss-image.sh)."

fails=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; fails=$((fails + 1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$*"; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

newest() { ls -1t "$@" 2> /dev/null | head -n 1; }

# ---- 1. package manifest -----------------------------------------------------
info "Packages in the image"
manifest="$(newest "$deploy/$image-$MACHINE_NAME"*.manifest)"
if [ -z "$manifest" ]; then
    fail "no package manifest for $image in $deploy"
else
    echo "    manifest: $(basename "$manifest")"
    for pkg in gnss-sdr gnss-config rtl-sdr-bin gnss-web-monitor nodejs gnss-led-bridge arduino-router \
        python3-arduino-router-bridge gnss-mcu-flash gnss-tools qbootctl networkmanager openssh-sshd gnss-resize-rootfs; do
        if grep -qE "^$pkg " "$manifest"; then
            pass "$pkg $(grep -E "^$pkg " "$manifest" | awk '{print $3}')"
        else
            fail "$pkg is not installed"
        fi
    done
    # Things that must NOT be there in a headless receiver.
    for pkg in gtk+3 gnuradio-grc qtbase xserver-xorg; do
        if grep -qE "^$pkg " "$manifest"; then fail "$pkg is installed (desktop stack in a headless image)"; else pass "no $pkg"; fi
    done
fi

# ---- 2. flashing artifacts -----------------------------------------------------
info "Flashing artifacts (qcomflash)"
flashdir="$(newest -d "$deploy/$image-$MACHINE_NAME"*.qcomflash)"
if [ -z "$flashdir" ] || [ ! -d "$flashdir" ]; then
    fail "no $image-$MACHINE_NAME*.qcomflash directory in $deploy"
else
    echo "    directory: $(basename "$flashdir")"
    for f in rawprogram0.xml patch0.xml prog_firehose_ddr.elf rootfs.img efi.bin boot.img; do
        if [ -e "$flashdir/$f" ]; then pass "$f"; else fail "$f missing"; fi
    done
    if [ -e "$flashdir/contents.xml" ] && grep -qi 'emmc' "$flashdir/contents.xml"; then
        pass "contents.xml declares eMMC storage"
    else
        fail "contents.xml missing or not for eMMC (the UNO Q has no UFS)"
    fi
fi

# ---- 3. receiver binary ----------------------------------------------------------
info "gnss-sdr executable"
rootfs="${flashdir:+$flashdir/rootfs.img}"
if [ -z "$rootfs" ] || [ ! -e "$rootfs" ]; then
    rootfs="$(newest "$deploy/$image-$MACHINE_NAME"*.ext4)"
fi
if [ -z "$rootfs" ] || [ ! -e "$rootfs" ]; then
    skip "no ext4 root filesystem image found to extract the binary from"
elif ! command -v debugfs > /dev/null 2>&1; then
    skip "debugfs (e2fsprogs) not installed on this host: cannot read $rootfs"
else
    for bin in usr/bin/gnss-sdr usr/bin/volk_gnsssdr_profile usr/bin/rtl_tcp usr/bin/arduino-router; do
        debugfs -R "dump /$bin $tmp/$(basename "$bin")" "$rootfs" > /dev/null 2>&1 || true
        if [ ! -s "$tmp/$(basename "$bin")" ]; then
            fail "/$bin not found in the root filesystem"
            continue
        fi
        if ! command -v readelf > /dev/null 2>&1; then
            skip "/$bin present; readelf (binutils) not installed, architecture not checked"
            continue
        fi
        hdr="$(readelf -h "$tmp/$(basename "$bin")")"
        if grep -q 'Class:.*ELF64' <<< "$hdr" && grep -q 'Machine:.*AArch64' <<< "$hdr"; then
            pass "/$bin is ELF64 AArch64"
        else
            fail "/$bin is not an AArch64 executable: $(grep -E 'Class|Machine' <<< "$hdr" | tr -s ' ' | tr '\n' ';')"
        fi
    done
    if [ -s "$tmp/gnss-sdr" ] && command -v readelf > /dev/null 2>&1; then
        echo "    gnss-sdr links against:"
        readelf -d "$tmp/gnss-sdr" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/        \1/p'
        if readelf -d "$tmp/gnss-sdr" | grep -qE 'NEEDED.*(uhd|osmosdr|zmq)'; then
            fail "gnss-sdr links against a front-end library that should be disabled by default"
        else
            pass "no UHD / osmosdr / ZeroMQ linked in (as configured)"
        fi
    fi
    for f in etc/gnss-sdr/gps-l1ca-file.conf etc/gnss-sdr/gps-l1ca-live.conf etc/default/gnss-sdr \
        usr/lib/systemd/system/gnss-sdr.service usr/lib/systemd/system/gnss-web-monitor.service \
        usr/lib/systemd/system/arduino-router.service usr/share/polkit-1/rules.d/50-gnss-sdr.rules; do
        if debugfs -R "stat /$f" "$rootfs" 2> /dev/null | grep -q 'Type: regular'; then pass "/$f"; else fail "/$f missing"; fi
    done
    if debugfs -R "stat /root/.ssh/authorized_keys" "$rootfs" 2> /dev/null | grep -q 'Type: regular' \
        || debugfs -R "stat /home/root/.ssh/authorized_keys" "$rootfs" 2> /dev/null | grep -q 'Type: regular'; then
        pass "SSH authorized_keys provisioned for root"
    else
        skip "no authorized_keys in the image (expected only for --debug builds)"
    fi
fi

# ---- 4. device tree: UART to the STM32 ----------------------------------------------
info "Device tree"
# Deployed at the top level or under a vendor subdirectory (qcom/), depending
# on the kernel class settings.
dtb="$(find "$deploy" -maxdepth 2 -name '*qrb2210-arduino-imola*.dtb' -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
if [ -z "$dtb" ]; then
    skip "qrb2210-arduino-imola.dtb not found in $deploy"
elif ! command -v dtc > /dev/null 2>&1; then
    skip "dtc (device-tree-compiler) not installed on this host: cannot inspect $(basename "$dtb")"
else
    dtc -I dtb -O dts -q -o "$tmp/board.dts" "$dtb" 2> /dev/null || true
    alias_path="$(sed -n '/aliases {/,/};/s/^[[:space:]]*serial1 = "\(.*\)";/\1/p' "$tmp/board.dts")"
    if [ -z "$alias_path" ]; then
        fail "no 'serial1' alias: /dev/ttyHS1 (link to the STM32) will not exist with this kernel. Try: scripts/build-gnss-image.sh --linux-arduino"
    else
        pass "alias serial1 -> $alias_path (becomes /dev/ttyHS1)"
        node="${alias_path##*/}"
        if awk -v n="$node {" 'index($0, n) {f=1} f && /status = "disabled"/ {bad=1} f && /^\t*};/ {exit} END {exit bad}' "$tmp/board.dts"; then
            pass "$node is enabled"
        else
            fail "$node is disabled in the device tree"
        fi
    fi
fi

# ---- 5. checksums --------------------------------------------------------------------
info "Checksums"
sums="$REPO_DIR/manifests/artifacts.sha256"
{
    echo "# sha256 of the build artifacts - generated by scripts/validate-image.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    [ -n "$manifest" ] && (cd "$deploy" && sha256sum "$(basename "$manifest")")
    if [ -n "$flashdir" ] && [ -d "$flashdir" ]; then
        (cd "$flashdir" && sha256sum rootfs.img efi.bin boot.img rawprogram0.xml patch0.xml 2> /dev/null | sed "s#  #  $(basename "$flashdir")/#")
    fi
} > "$sums"
pass "wrote $sums"

echo
if [ "$fails" -eq 0 ]; then
    info "All checks that could run passed. Hardware tests are still NOT RUN."
else
    die "$fails check(s) failed."
fi
