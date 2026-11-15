#!/usr/bin/env python3
"""Judge a GNSS-SDR run from its console output, one processing stage at a time.

The stages are reported independently because "the program ran" says nothing
about "the receiver computed a position":

    config        the configuration was accepted and the flowgraph started
    samples       the input samples were opened and read
    acquisition   at least one satellite was acquired
    tracking      satellites stayed in track
    telemetry     navigation messages were decoded
    pvt           position fixes were computed
    accuracy      the fixes agree with a known reference position

Each stage is PASS, FAIL or NOT RUN. A stage whose evidence is absent is never
reported as PASS, and without a log file everything is NOT RUN.

The patterns are the literal messages GNSS-SDR v0.0.22 prints (checked against
its source: dll_pll_veml_tracking.cc, gps_l1_ca_telemetry_decoder_gs.cc,
rtklib_pvt_gs.cc, file_source_base.cc, main.cc).

Usage:
    test-pvt-output.py gnss-sdr.out
    test-pvt-output.py gnss-sdr.out --reference 41.27,1.98,80 --max-error-m 50
    test-pvt-output.py gnss-sdr.out --csv fixes.csv --json report.json
    test-pvt-output.py --self-test

Exit status: 0 all stages that ran passed and pvt passed; 1 a stage failed;
             3 nothing could be evaluated (NOT RUN).
"""

import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")

RE_INIT = re.compile(r"Initializing GNSS-SDR v(\S+)")
RE_FILE = re.compile(r"Processing file (.+), which contains (\d+) samples \((\d+) bytes\)")
RE_DURATION = re.compile(r"GNSS signal recorded time to be processed: ([0-9.]+) \[s\]")
RE_TRACK = re.compile(r"Tracking of GPS L1 C/A signal started on channel (\d+) for satellite (.+)")
RE_LOSS = re.compile(r"Loss of lock in channel (\d+), satellite (.+?) !")
RE_NAV = re.compile(r"New GPS NAV message received in channel (\d+)")
RE_FIRST_FIX = re.compile(r"First position fix at (.+)")
RE_POSITION = re.compile(
    r"Position at (.+?) using (\d+) observations is Lat = (-?[0-9.]+) \[deg\], "
    r"Long = (-?[0-9.]+) \[deg\], Height = (-?[0-9.]+) \[m\]"
)
RE_RUNTIME = re.compile(r"Total GNSS-SDR run time: ([0-9.]+)")
RE_ENDED = re.compile(r"GNSS-SDR program ended")
RE_FATAL = re.compile(r"(terminate called|Segmentation fault|std::bad_alloc|Aborted|core dumped)", re.I)

PASS, FAIL, NOT_RUN = "PASS", "FAIL", "NOT RUN"
STAGES = ["config", "samples", "acquisition", "tracking", "telemetry", "pvt", "accuracy"]


def horizontal_error_m(lat, lon, ref_lat, ref_lon):
    """Distance on the local tangent plane; ample for errors of metres to km."""
    m_per_deg = 111320.0
    north = (lat - ref_lat) * m_per_deg
    east = (lon - ref_lon) * m_per_deg * math.cos(math.radians(ref_lat))
    return math.hypot(north, east)


def percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil(q / 100.0 * len(ordered)) - 1))
    return ordered[idx]


def analyse(text, reference=None, max_error_m=50.0, min_fixes=1):
    """Return (stages, details). stages maps stage name -> (status, explanation)."""
    lines = [ANSI.sub("", ln) for ln in text.splitlines()]
    d = {
        "version": None, "file": None, "samples": None, "signal_s": None,
        "tracking_starts": 0, "satellites": set(), "losses": 0, "nav_messages": 0,
        "nav_channels": set(), "first_fix": None, "fixes": [], "run_time_s": None,
        "ended": False, "fatal": None,
    }
    for ln in lines:
        if (m := RE_INIT.search(ln)):
            d["version"] = m.group(1)
        elif (m := RE_FILE.search(ln)):
            d["file"], d["samples"] = m.group(1), int(m.group(2))
        elif (m := RE_DURATION.search(ln)):
            d["signal_s"] = float(m.group(1))
        elif (m := RE_TRACK.search(ln)):
            d["tracking_starts"] += 1
            d["satellites"].add(m.group(2).strip())
        elif (m := RE_LOSS.search(ln)):
            d["losses"] += 1
        elif (m := RE_NAV.search(ln)):
            d["nav_messages"] += 1
            d["nav_channels"].add(int(m.group(1)))
        elif (m := RE_FIRST_FIX.search(ln)):
            d["first_fix"] = m.group(1).strip()
        elif (m := RE_POSITION.search(ln)):
            d["fixes"].append({"time": m.group(1).strip(), "observations": int(m.group(2)),
                               "lat": float(m.group(3)), "lon": float(m.group(4)), "height": float(m.group(5))})
        elif (m := RE_RUNTIME.search(ln)):
            d["run_time_s"] = float(m.group(1))
        if RE_ENDED.search(ln):
            d["ended"] = True
        if d["fatal"] is None and (m := RE_FATAL.search(ln)):
            d["fatal"] = ln.strip()

    s = {}
    if not any(ln.strip() for ln in lines):
        return {name: (NOT_RUN, "empty log") for name in STAGES}, d

    # config
    if d["version"] is None:
        s["config"] = (FAIL, "no 'Initializing GNSS-SDR' line: the program did not start with this configuration")
    elif d["fatal"]:
        s["config"] = (FAIL, f"abnormal termination: {d['fatal']}")
    else:
        s["config"] = (PASS, f"GNSS-SDR v{d['version']} started")

    # samples (file sources announce the file; live sources are judged downstream)
    if d["samples"] is not None:
        if d["samples"] > 0:
            dur = f", {d['signal_s']:.1f} s of signal" if d["signal_s"] is not None else ""
            s["samples"] = (PASS, f"{d['samples']} samples read from {d['file']}{dur}")
        else:
            s["samples"] = (FAIL, f"{d['file']} contains no samples")
    elif d["tracking_starts"] > 0:
        s["samples"] = (PASS, "no file announcement (live source); samples reached the tracking loops")
    else:
        s["samples"] = (NOT_RUN, "no evidence that samples were read") if s["config"][0] == PASS else (NOT_RUN, "program did not start")

    # acquisition: GNSS-SDR prints nothing on a successful acquisition; a
    # tracking start is the proof that one happened.
    n_sat = len(d["satellites"])
    if d["tracking_starts"] > 0:
        s["acquisition"] = (PASS, f"{n_sat} satellite(s) acquired: {', '.join(sorted(d['satellites']))}")
    elif s["samples"][0] == PASS:
        s["acquisition"] = (FAIL, "samples were read but no satellite was acquired (wrong format/rate, no signal, or too little gain)")
    else:
        s["acquisition"] = (NOT_RUN, "no samples")

    # tracking: sustained tracking is shown by navigation data coming out of a channel.
    if d["tracking_starts"] == 0:
        s["tracking"] = (NOT_RUN, "nothing was acquired")
    elif d["nav_messages"] > 0:
        s["tracking"] = (PASS, f"{len(d['nav_channels'])} channel(s) kept lock long enough to deliver data; {d['losses']} loss(es) of lock")
    else:
        s["tracking"] = (FAIL, f"{d['tracking_starts']} tracking start(s) but no channel held lock long enough to decode data; {d['losses']} loss(es) of lock")

    # telemetry
    if d["nav_messages"] > 0:
        s["telemetry"] = (PASS, f"{d['nav_messages']} GPS NAV message(s) decoded on {len(d['nav_channels'])} channel(s)")
    elif d["tracking_starts"] > 0:
        s["telemetry"] = (FAIL, "no navigation message decoded")
    else:
        s["telemetry"] = (NOT_RUN, "nothing was tracked")

    # pvt
    n_fix = len(d["fixes"])
    if n_fix >= min_fixes:
        lat = sum(f["lat"] for f in d["fixes"]) / n_fix
        lon = sum(f["lon"] for f in d["fixes"]) / n_fix
        hgt = sum(f["height"] for f in d["fixes"]) / n_fix
        first = f"; first fix at {d['first_fix']}" if d["first_fix"] else ""
        s["pvt"] = (PASS, f"{n_fix} fix(es), mean {lat:.6f} deg, {lon:.6f} deg, {hgt:.1f} m{first}")
    elif d["nav_messages"] > 0:
        s["pvt"] = (FAIL, f"{n_fix} fix(es) (need {min_fixes}): data was decoded but no position was computed "
                          "(capture too short for ephemeris from 4 satellites?)")
    else:
        s["pvt"] = (NOT_RUN, "no navigation data")

    # accuracy
    if reference is None:
        s["accuracy"] = (NOT_RUN, "no --reference position given")
    elif n_fix == 0:
        s["accuracy"] = (NOT_RUN, "no fixes to compare")
    else:
        ref_lat, ref_lon, ref_h = reference
        errs = [horizontal_error_m(f["lat"], f["lon"], ref_lat, ref_lon) for f in d["fixes"]]
        mean_e, p95, max_e = sum(errs) / len(errs), percentile(errs, 95), max(errs)
        d["horizontal_error_m"] = {"mean": mean_e, "p95": p95, "max": max_e}
        text_ = f"horizontal error mean {mean_e:.1f} m, 95% {p95:.1f} m, max {max_e:.1f} m (limit: 95% <= {max_error_m:g} m)"
        if ref_h is not None:
            v = [abs(f["height"] - ref_h) for f in d["fixes"]]
            d["vertical_error_m"] = {"mean": sum(v) / len(v), "max": max(v)}
            text_ += f"; vertical mean {sum(v) / len(v):.1f} m"
        s["accuracy"] = (PASS if p95 <= max_error_m else FAIL, text_)

    return s, d


def parse_reference(text):
    parts = [p.strip() for p in text.split(",")]
    if len(parts) not in (2, 3):
        raise argparse.ArgumentTypeError("expected LAT,LON or LAT,LON,HEIGHT")
    vals = [float(p) for p in parts]
    return (vals[0], vals[1], vals[2] if len(vals) == 3 else None)


def report(stages, out=sys.stdout):
    for name in STAGES:
        status, why = stages[name]
        print(f"{name:<12} {status:<8} {why}", file=out)


def exit_status(stages):
    statuses = [stages[n][0] for n in STAGES]
    if FAIL in statuses:
        return 1
    if stages["pvt"][0] == PASS:
        return 0
    return 3


# Format samples for --self-test. SYNTHETIC: written by hand from the message
# formats in the GNSS-SDR source to exercise this parser. They are not the
# output of a receiver run and are evidence of nothing but the parser.
_SELFTEST_FIX = """\
Initializing GNSS-SDR v0.0.22 ... Please wait.
Processing file /x/capture.dat, which contains 400000000 samples (1600000000 bytes)
GNSS signal recorded time to be processed: 99.999 [s]
Tracking of GPS L1 C/A signal started on channel 0 for satellite GPS PRN 01 (Block IIF)
Tracking of GPS L1 C/A signal started on channel 1 for satellite GPS PRN 11 (Block IIR)
Loss of lock in channel 1, satellite GPS PRN 11 (Block IIR) !
New GPS NAV message received in channel 0: subframe 1 from satellite GPS PRN 01 (Block IIF)
First position fix at 2013-Apr-04 06:23:31.740000 UTC is Lat = 41.2749 [deg], Long = 1.9875 [deg], Height= 75.5 [m]
\x1b[1m\x1b[32mPosition at 2013-Apr-04 06:23:32.000000 UTC using 5 observations is Lat = 41.274900 [deg], Long = 1.987500 [deg], Height = 75.50 [m]\x1b[0m
Position at 2013-Apr-04 06:23:33.000000 UTC using 5 observations is Lat = 41.275000 [deg], Long = 1.987600 [deg], Height = 80.50 [m]
Total GNSS-SDR run time: 61.5 [seconds]
GNSS-SDR program ended.
"""
_SELFTEST_NO_SIGNAL = """\
Initializing GNSS-SDR v0.0.22 ... Please wait.
Processing file /x/noise.dat, which contains 8000000 samples (32000000 bytes)
GNSS-SDR program ended.
"""


def self_test():
    ok = True

    def check(cond, what):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + what)
        ok = ok and cond

    s, d = analyse(_SELFTEST_FIX)
    check([s[n][0] for n in STAGES] == [PASS] * 6 + [NOT_RUN], "full run: six stages pass, accuracy not run without a reference")
    check(len(d["fixes"]) == 2 and d["fixes"][0]["lat"] == 41.2749, "position lines parsed, including ANSI-coloured ones")
    check(d["losses"] == 1 and d["tracking_starts"] == 2 and d["nav_messages"] == 1, "tracking, loss-of-lock and NAV counters")
    check(exit_status(s) == 0, "exit status 0 with a fix")

    s, d = analyse(_SELFTEST_FIX, reference=(41.27495, 1.98755, 78.0), max_error_m=50)
    check(s["accuracy"][0] == PASS and d["horizontal_error_m"]["max"] < 10, "accuracy passes near the reference")
    s, _ = analyse(_SELFTEST_FIX, reference=(41.0, 2.0, None), max_error_m=50)
    check(s["accuracy"][0] == FAIL and exit_status(s) == 1, "accuracy fails 30 km away")

    s, _ = analyse(_SELFTEST_NO_SIGNAL)
    check(s["samples"][0] == PASS and s["acquisition"][0] == FAIL, "samples read but nothing acquired -> acquisition FAIL")
    check(s["tracking"][0] == NOT_RUN and s["pvt"][0] == NOT_RUN and exit_status(s) == 1, "later stages NOT RUN, never PASS")

    s, _ = analyse("")
    check(all(s[n][0] == NOT_RUN for n in STAGES) and exit_status(s) == 3, "empty log -> everything NOT RUN")

    s, _ = analyse("bash: gnss-sdr: command not found\n")
    check(s["config"][0] == FAIL and s["pvt"][0] == NOT_RUN, "program did not start -> config FAIL")

    cut = _SELFTEST_FIX.split("First position fix")[0]
    s, _ = analyse(cut)
    check(s["telemetry"][0] == PASS and s["pvt"][0] == FAIL, "data decoded but no fix -> pvt FAIL")
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Judge a GNSS-SDR run from its console output.")
    ap.add_argument("log", nargs="?", help="file with gnss-sdr's standard output")
    ap.add_argument("--reference", type=parse_reference, help="known position: LAT,LON[,HEIGHT] in degrees and metres")
    ap.add_argument("--max-error-m", type=float, default=50.0, help="limit for the 95th percentile horizontal error (default 50)")
    ap.add_argument("--min-fixes", type=int, default=1)
    ap.add_argument("--csv", help="write the position fixes to this CSV file")
    ap.add_argument("--json", help="write the full report to this JSON file")
    ap.add_argument("--self-test", action="store_true", help="check this script's parser on built-in format samples")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    if not args.log or not Path(args.log).is_file():
        stages = {n: (NOT_RUN, "no log file" if not args.log else f"{args.log} not found") for n in STAGES}
        report(stages)
        return 3

    text = Path(args.log).read_text(encoding="utf-8", errors="replace")
    stages, details = analyse(text, args.reference, args.max_error_m, args.min_fixes)
    report(stages)

    if args.csv and details["fixes"]:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["time", "observations", "lat", "lon", "height"])
            w.writeheader()
            w.writerows(details["fixes"])
    if args.json:
        details = dict(details, satellites=sorted(details["satellites"]), nav_channels=sorted(details["nav_channels"]))
        details["n_fixes"] = len(details.pop("fixes"))
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"log": args.log, "stages": {k: {"status": v[0], "detail": v[1]} for k, v in stages.items()},
                       "details": details}, f, indent=2)
    return exit_status(stages)


if __name__ == "__main__":
    sys.exit(main())
