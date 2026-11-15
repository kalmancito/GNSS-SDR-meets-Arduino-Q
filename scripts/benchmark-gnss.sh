#!/usr/bin/env bash
# Measure how fast the board processes a recorded capture. Run ON THE BOARD.
#
#   benchmark-gnss.sh --capture FILE [--profile-name gps-l1ca-file] [--label TEXT] [--out DIR]
#   benchmark-gnss.sh --profile        run volk_gnsssdr_profile once (takes minutes), then exit
#
# Processes the whole file as fast as the CPU allows (the file profile has
# enable_throttle_control=false) and reports the ratio
#
#     real-time factor = signal duration / wall-clock time
#
# > 1 means the receiver keeps up with a live signal at that sample rate and
# channel count, with that much margin. It is a throughput figure: it does not
# measure USB losses or jitter, which only a live test shows.
#
# Appends one row to DIR/benchmark.csv and saves the receiver's output next to
# it, so results stay traceable to image, configuration and input.
set -euo pipefail

capture=""
profile="gps-l1ca-file"
label=""
out="/var/lib/gnss-sdr/benchmarks"
run_volk_profile=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --capture) capture="${2:?}"; shift ;;
        --profile-name) profile="${2:?}"; shift ;;
        --label) label="${2:?}"; shift ;;
        --out) out="${2:?}"; shift ;;
        --profile) run_volk_profile=1 ;;
        -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "error: unknown option $1" >&2; exit 2 ;;
    esac
    shift
done

die() { echo "error: $*" >&2; exit 1; }
run_as_gnss() {
    if [ "$(id -un)" = "gnss" ]; then HOME=/var/lib/gnss-sdr "$@"; else runuser -u gnss -- env HOME=/var/lib/gnss-sdr "$@"; fi
}

if [ "$run_volk_profile" -eq 1 ]; then
    echo "Selecting the fastest VOLK kernels for this CPU (this takes several minutes)..."
    run_as_gnss volk_gnsssdr_profile
    echo "Saved to /var/lib/gnss-sdr/.volk_gnsssdr/volk_gnsssdr_config"
    exit 0
fi

conf="/etc/gnss-sdr/$profile.conf"
[ -r "$conf" ] || die "profile $conf not found."
[ -n "$capture" ] && [ -r "$capture" ] || die "--capture FILE is required and must be readable."
if systemctl is-active --quiet gnss-sdr.service; then
    die "gnss-sdr.service is running; stop it first (systemctl stop gnss-sdr) so the measurement is not shared."
fi

conf_get() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\\([^;]*\\).*\$/\\1/p" "$conf" | tail -n 1 | tr -d '[:space:]'; }
fs="$(conf_get 'SignalSource\.sampling_frequency')"
item="$(conf_get 'SignalSource\.item_type')"
channels="$(conf_get 'Channels_1C\.count')"
case "$item" in
    ibyte) bytes_per_sample=2 ;;      # interleaved I/Q, 8 bit each
    ishort) bytes_per_sample=4 ;;     # interleaved I/Q, 16 bit each
    gr_complex) bytes_per_sample=8 ;; # interleaved I/Q, 32-bit float each
    byte) bytes_per_sample=1 ;;
    short) bytes_per_sample=2 ;;
    *) die "do not know the sample size of item_type '$item'." ;;
esac
size=$(stat -c %s "$capture")
duration=$(awk -v s="$size" -v b="$bytes_per_sample" -v f="$fs" 'BEGIN {printf "%.3f", s / b / f}')

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="$out/$stamp"
mkdir -p "$run_dir"
chown -R gnss:gnss "$out" 2> /dev/null || true

echo "Capture : $capture ($size bytes, $item at $fs S/s = ${duration} s of signal)"
echo "Profile : $conf ($channels channels)"
echo "Output  : $run_dir"

temp_before="$(cat /sys/class/thermal/thermal_zone0/temp 2> /dev/null || echo NA)"
volk_profiled=no
[ -f /var/lib/gnss-sdr/.volk_gnsssdr/volk_gnsssdr_config ] && volk_profiled=yes

# /usr/bin/time -v gives wall clock, CPU time and peak memory of the process.
[ -x /usr/bin/time ] || die "/usr/bin/time not installed (package 'time')."
set +e
(cd "$run_dir" && run_as_gnss /usr/bin/time -v -o "$run_dir/time.txt" \
    gnss-sdr --config_file="$conf" --signal_source="$capture" --log_dir="$run_dir") \
    > "$run_dir/gnss-sdr.out" 2>&1
rc=$?
set -e
temp_after="$(cat /sys/class/thermal/thermal_zone0/temp 2> /dev/null || echo NA)"

field() { sed -n "s/^[[:space:]]*$1: //p" "$run_dir/time.txt" | head -n 1; }
elapsed_raw="$(field 'Elapsed (wall clock) time (h:mm:ss or m:ss)')"
wall=$(awk -F: '{ if (NF == 3) print $1 * 3600 + $2 * 60 + $3; else print $1 * 60 + $2 }' <<< "$elapsed_raw")
user="$(field 'User time (seconds)')"
sys="$(field 'System time (seconds)')"
rss_kb="$(field 'Maximum resident set size (kbytes)')"
rtf=$(awk -v d="$duration" -v w="$wall" 'BEGIN { if (w > 0) printf "%.2f", d / w; else print "NA" }')
cpu_pct=$(awk -v u="$user" -v s="$sys" -v w="$wall" 'BEGIN { if (w > 0) printf "%.0f", (u + s) / w * 100; else print "NA" }')

# Evidence of each stage, counted from the receiver's own console output.
tracked=$(grep -c 'Tracking of GPS L1 C/A signal started' "$run_dir/gnss-sdr.out" || true)
subframes=$(grep -c 'New GPS NAV message received' "$run_dir/gnss-sdr.out" || true)
fixes=$(grep -c 'Position at' "$run_dir/gnss-sdr.out" || true)
oom=$(dmesg 2> /dev/null | grep -ciE 'out of memory|oom-killer' || true)

csv="$out/benchmark.csv"
[ -f "$csv" ] || echo "utc,label,image_build,gnss_sdr,profile,capture,capture_sha256_16,item_type,fs_sps,channels,signal_s,wall_s,user_s,sys_s,cpu_pct,max_rss_kb,real_time_factor,tracking_starts,nav_messages,pvt_fixes,volk_profiled,temp_before_mC,temp_after_mC,oom_events,exit_status" > "$csv"
build_id="$(sed -n 's/^BUILD_ID=//p' /etc/os-release | tr -d '"')"
version="$(gnss-sdr --version 2>&1 | head -n 1 | awk '{print $NF}')"
sha="$(sha256sum "$capture" | cut -c1-16)"
echo "$stamp,$label,$build_id,$version,$profile,$(basename "$capture"),$sha,$item,$fs,$channels,$duration,$wall,$user,$sys,$cpu_pct,$rss_kb,$rtf,$tracked,$subframes,$fixes,$volk_profiled,$temp_before,$temp_after,$oom,$rc" >> "$csv"

echo
echo "Wall clock        : ${wall} s for ${duration} s of signal"
echo "Real-time factor  : ${rtf}   (>1 = faster than real time)"
echo "CPU               : ${cpu_pct}% of one core-second per second (4 cores = 400%)"
echo "Peak memory (RSS) : $((rss_kb / 1024)) MB"
echo "Tracking starts   : $tracked   NAV messages: $subframes   PVT fixes: $fixes"
echo "Exit status       : $rc"
echo "Row appended to   : $csv"
[ "$rc" -eq 0 ] || echo "WARNING: gnss-sdr exited with status $rc; see $run_dir/gnss-sdr.out"
[ "$fixes" -gt 0 ] || echo "NOTE: no position fix in this run: the timing is valid, but it is not a PVT result."
