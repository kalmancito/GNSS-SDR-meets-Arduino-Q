#!/usr/bin/env python3
"""Static validation of GNSS-SDR configuration files.

GNSS-SDR silently ignores parameters it does not know, so a typo or a name that
upstream renamed just falls back to a default. This checker compares every key
and every implementation name against a reference extracted from the GNSS-SDR
source of the pinned release (tests/gen-gnss-sdr-params.sh), and enforces the
rules this product relies on (monitor ports, no debug dumps, consistent rates).

It validates syntax and names only. Whether the receiver acquires, tracks and
computes a position is established by running it on real samples.

Usage: check_gnss_conf.py --reference REF.txt FILE.conf [FILE.conf ...]
Exit status: 0 = all files valid, 1 = at least one error, 2 = usage error.
"""

import argparse
import re
import sys
from pathlib import Path

LINE_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z0-9_]+)\s*=\s*(.*)$")

# Parameter names GNSS-SDR builds at run time, so they are not string literals
# in the source. Each pattern was checked against the code that builds it.
DYNAMIC_PARAMS = [
    # fir_filter.cc / freq_xlating_fir_filter.cc: "band" + n + "_begin|_end|_error", "ampl" + n + ...
    re.compile(r"^band\d+_(begin|end|error)$"),
    re.compile(r"^ampl\d+_(begin|end)$"),
]

REQUIRED_KEYS = [
    "GNSS-SDR.internal_fs_sps",
    "SignalSource.implementation",
    "SignalConditioner.implementation",
    "Channels_1C.count",
    "Acquisition_1C.implementation",
    "Tracking_1C.implementation",
    "TelemetryDecoder_1C.implementation",
    "Observables.implementation",
    "PVT.implementation",
]

# Contract with the web monitor (apps/web-monitor/server/config.js defaults).
MONITOR_CONTRACT = {
    "PVT.enable_monitor": "true",
    "PVT.monitor_client_addresses": "127.0.0.1",
    "PVT.monitor_udp_port": "1111",
    "Monitor.enable_monitor": "true",
    "Monitor.client_addresses": "127.0.0.1",
    "Monitor.udp_port": "1112",
}


def load_reference(path):
    impl, keys, suffixes = set(), set(), set()
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        kind, _, name = line.partition(" ")
        {"impl": impl, "key": keys, "suffix": suffixes}.get(kind, set()).add(name)
    if not impl or not suffixes:
        raise SystemExit(f"error: {path} is not a valid reference file")
    return impl, keys, suffixes


def parse(path):
    """Return (entries, errors). entries: list of (lineno, role, param, value)."""
    entries, errors = [], []
    seen_header = False
    for lineno, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(";") or line.startswith("#"):
            continue
        if line == "[GNSS-SDR]":
            seen_header = True
            continue
        if line.startswith("["):
            errors.append((lineno, f"unexpected section {line}; the only section is [GNSS-SDR]"))
            continue
        m = LINE_RE.match(line)
        if not m:
            errors.append((lineno, f"not a 'Role.parameter=value' line: {line!r}"))
            continue
        if not seen_header:
            errors.append((lineno, "parameter before the [GNSS-SDR] section header"))
        value = m.group(3).split(";", 1)[0].strip()  # ';' starts a trailing comment
        entries.append((lineno, m.group(1), m.group(2), value))
    if not seen_header:
        errors.append((0, "missing [GNSS-SDR] section header"))
    return entries, errors


def as_number(text):
    try:
        return float(text)
    except ValueError:
        return None


def check(path, impl, keys, suffixes, product_rules=True):
    entries, errors = parse(path)
    values = {}

    for lineno, role, param, value in entries:
        key = f"{role}.{param}"
        if key in values:
            errors.append((lineno, f"{key} is set more than once"))
        values[key] = value

        if value == "":
            errors.append((lineno, f"{key} has an empty value"))

        if param == "implementation":
            if value not in impl:
                errors.append((lineno, f"{key}={value}: unknown implementation for the pinned GNSS-SDR release"))
        elif not (key in keys or param in suffixes or any(p.match(param) for p in DYNAMIC_PARAMS)):
            errors.append((lineno, f"{key}: GNSS-SDR does not read a parameter with this name (typo, or removed upstream?)"))

        if product_rules and param == "dump" and value.lower() == "true":
            errors.append((lineno, f"{key}=true: debug dumps write continuously to the eMMC; not allowed in a shipped profile"))
        if product_rules and value.startswith("./"):
            errors.append((lineno, f"{key}={value}: relative paths depend on the service working directory; use an absolute path"))

    for key in REQUIRED_KEYS:
        if key not in values:
            errors.append((0, f"required parameter {key} is missing"))

    if product_rules:
        for key, expected in MONITOR_CONTRACT.items():
            if values.get(key) != expected:
                errors.append((0, f"{key} must be {expected} for the web monitor (found: {values.get(key, 'not set')})"))

    # Sample-rate consistency along the signal conditioner.
    fs_in = as_number(values.get("SignalSource.sampling_frequency", ""))
    fs_internal = as_number(values.get("GNSS-SDR.internal_fs_sps", ""))
    resampler = values.get("Resampler.implementation")
    if resampler == "Direct_Resampler":
        r_in = as_number(values.get("Resampler.sample_freq_in", ""))
        r_out = as_number(values.get("Resampler.sample_freq_out", ""))
        if fs_in is not None and r_in is not None and fs_in != r_in:
            errors.append((0, f"Resampler.sample_freq_in ({r_in:g}) differs from SignalSource.sampling_frequency ({fs_in:g})"))
        if fs_internal is not None and r_out is not None and fs_internal != r_out:
            errors.append((0, f"Resampler.sample_freq_out ({r_out:g}) differs from GNSS-SDR.internal_fs_sps ({fs_internal:g})"))
    elif resampler == "Pass_Through" and "InputFilter.decimation_factor" not in values:
        if fs_in is not None and fs_internal is not None and fs_in != fs_internal:
            errors.append((0, f"no resampling, but GNSS-SDR.internal_fs_sps ({fs_internal:g}) differs from SignalSource.sampling_frequency ({fs_in:g})"))

    count = as_number(values.get("Channels_1C.count", ""))
    if count is not None and not (1 <= count <= 12 and count == int(count)):
        errors.append((0, f"Channels_1C.count={values['Channels_1C.count']}: expected an integer between 1 and 12 for this board"))

    return sorted(errors)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--reference", required=True, help="output of tests/gen-gnss-sdr-params.sh")
    ap.add_argument("--no-product-rules", action="store_true", help="check names and syntax only (e.g. for upstream examples)")
    ap.add_argument("files", nargs="+")
    args = ap.parse_args(argv)

    impl, keys, suffixes = load_reference(args.reference)
    failed = 0
    for f in args.files:
        errors = check(f, impl, keys, suffixes, product_rules=not args.no_product_rules)
        if errors:
            failed += 1
            print(f"FAIL {f}")
            for lineno, msg in errors:
                print(f"  {f}:{lineno}: {msg}" if lineno else f"  {f}: {msg}")
        else:
            print(f"PASS {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
