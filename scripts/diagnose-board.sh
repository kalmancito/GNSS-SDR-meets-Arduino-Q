#!/usr/bin/env bash
# Health report of a board running the Yocto image. Read-only.
#
# Run it on the board, or from a PC without copying anything:
#
#   ssh root@<board> 'bash -s' < scripts/diagnose-board.sh
#   ssh root@<board> 'bash -s' < scripts/diagnose-board.sh > docs/logs/diagnose-$(date -u +%Y%m%d).txt
#
# Each section ends with OK / PROBLEM lines; the exit status is the number of
# problems found (0 = healthy).
set -u

problems=0
section() { printf '\n=== %s ===\n' "$*"; }
ok() { printf 'OK       %s\n' "$*"; }
problem() { printf 'PROBLEM  %s\n' "$*"; problems=$((problems + 1)); }
note() { printf 'NOTE     %s\n' "$*"; }
have() { command -v "$1" > /dev/null 2>&1; }

section "System"
echo "Date (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
grep -E '^(PRETTY_NAME|VERSION_ID|BUILD_ID)=' /etc/os-release 2> /dev/null
uname -a
echo "Model: $(tr -d '\0' < /sys/firmware/devicetree/base/model 2> /dev/null)"
echo "Uptime: $(uptime)"
[ "$(uname -m)" = "aarch64" ] && ok "64-bit ARM kernel" || problem "unexpected architecture $(uname -m)"

section "Memory and storage"
head -n 5 /proc/meminfo
df -h / /var 2> /dev/null
lsblk -o NAME,SIZE,TYPE,PARTLABEL,MOUNTPOINTS 2> /dev/null | head -n 60
avail_mb=$(df -Pm / | awk 'NR==2 {print $4}')
if [ "${avail_mb:-0}" -lt 2000 ]; then
    problem "only ${avail_mb} MB free on / (a 100 s test capture needs 1600 MB). Is gnss-resize-rootfs.service done?"
else
    ok "${avail_mb} MB free on /"
fi
if dmesg 2> /dev/null | grep -qiE 'out of memory|oom-killer'; then problem "the OOM killer has run since boot (dmesg)"; else ok "no OOM kills since boot"; fi

section "Boot slot (A/B)"
if have qbootctl; then
    qbootctl 2>&1 | head -n 20    # without arguments it prints the slot table
    if systemctl is-active --quiet qbootctl-bless-boot.service 2> /dev/null || systemctl show -p Result --value qbootctl-bless-boot.service 2> /dev/null | grep -q success; then
        ok "boot marked successful (qbootctl-bless-boot)"
    else
        problem "qbootctl-bless-boot.service has not succeeded: the bootloader may fall back to the other slot after a few reboots"
    fi
else
    problem "qbootctl is not installed"
fi

section "Failed units"
failed="$(systemctl --failed --no-legend --plain 2> /dev/null)"
if [ -z "$failed" ]; then ok "no failed units"; else echo "$failed"; note "failed units listed above (gnss-sdr.service is expected to fail when no SDR is connected)"; fi

section "Time"
timedatectl 2> /dev/null | grep -E 'Local time|synchronized|NTP service'
timedatectl 2> /dev/null | grep -q 'synchronized: yes' && ok "clock synchronized" || note "clock not synchronized (no network?)"

section "Network"
ip -brief addr 2> /dev/null
have nmcli && nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device 2> /dev/null

section "USB"
if have lsusb; then
    lsusb
    lsusb -t 2> /dev/null
    if lsusb | grep -qiE '0bda:(2832|2838)'; then
        ok "RTL-SDR dongle present"
        lsmod 2> /dev/null | grep -q dvb_usb_rtl28xxu && problem "dvb_usb_rtl28xxu is loaded and will claim the dongle" || ok "DVB driver not loaded"
    else
        note "no RTL-SDR dongle on the bus (USB-C in host mode? powered hub?)"
    fi
else
    problem "lsusb not installed"
fi
role="$(cat /sys/class/usb_role/*/role 2> /dev/null | tr '\n' ' ')"
[ -n "$role" ] && echo "USB role: $role"

section "Receiver"
if have gnss-sdr; then
    gnss-sdr --version 2>&1 | head -n 3
    ok "gnss-sdr installed"
else
    problem "gnss-sdr not found"
fi
echo "Profiles: $(ls /etc/gnss-sdr/*.conf 2> /dev/null | xargs -n 1 basename 2> /dev/null | tr '\n' ' ')"
grep -vE '^\s*(#|$)' /etc/default/gnss-sdr 2> /dev/null
cat /run/gnss-sdr/selected.env 2> /dev/null && echo "(profile selected at run time, above)"
for unit in gnss-sdr rtl-tcp gnss-web-monitor arduino-router gnss-led-bridge; do
    printf '%-22s %s / %s\n' "$unit" "$(systemctl is-enabled "$unit" 2> /dev/null)" "$(systemctl is-active "$unit" 2> /dev/null)"
done
echo "--- last receiver log lines ---"
journalctl -u gnss-sdr -n 25 --no-pager 2> /dev/null
if [ -f /var/lib/gnss-sdr/.volk_gnsssdr/volk_gnsssdr_config ]; then
    ok "VOLK kernels profiled ($(grep -c . /var/lib/gnss-sdr/.volk_gnsssdr/volk_gnsssdr_config) entries)"
else
    note "volk_gnsssdr_profile has not been run: generic kernels are in use (see scripts/benchmark-gnss.sh --profile)"
fi

section "Web monitor"
if have curl; then
    if status="$(curl -fsS --max-time 3 http://127.0.0.1:8080/api/gnss/status 2> /dev/null)"; then
        ok "API answers: $status"
        curl -fsS --max-time 3 http://127.0.0.1:8080/api/latest/pvt 2> /dev/null | cut -c1-300
        echo
    else
        problem "no answer from http://127.0.0.1:8080/api/gnss/status"
    fi
fi

section "Link to the STM32"
ls -l /dev/ttyHS1 2>&1
[ -c /dev/ttyHS1 ] && ok "/dev/ttyHS1 exists" || problem "/dev/ttyHS1 missing: the kernel's device tree does not enable the UART to the MCU (try the linux-arduino kernel)"
[ -S /var/run/arduino-router.sock ] && ok "router socket present" || problem "/var/run/arduino-router.sock missing (arduino-router not running)"
have gpiodetect && gpiodetect 2>&1
journalctl -u arduino-router -u gnss-led-bridge -n 15 --no-pager 2> /dev/null

section "Temperature and CPU"
for z in /sys/class/thermal/thermal_zone*; do
    [ -r "$z/temp" ] && printf '%-24s %s mC\n' "$(cat "$z/type" 2> /dev/null)" "$(cat "$z/temp" 2> /dev/null)"
done
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2> /dev/null | tr '\n' ' '
echo
ps -eo pid,pcpu,pmem,rss,comm --sort=-pcpu 2> /dev/null | head -n 8

section "Kernel log (last lines)"
dmesg 2> /dev/null | tail -n 40

printf '\n%s problem(s) found.\n' "$problems"
exit "$problems"
