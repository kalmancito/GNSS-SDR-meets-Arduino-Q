# SPDX-License-Identifier: MPL-2.0
"""Turn the web monitor's JSON into the status string sent to the MCU.

Pure logic, no I/O: this module is shared by the Arduino App Lab entry point
(main.py) and by the standalone bridge used in the Yocto image
(gnss_led_bridge.py), and it is what the unit tests exercise.

Wire contract with the sketch (apps/led-matrix/sketch/sketch.ino):

    P=<0|2>;S=<int>;A=<sec>;H=<deg>;V=<mps>;C=<cn0_1,cn0_2,...>;

    P  0 = no position fix (LED blinks), 2 = fix (LED solid)
    S  satellites: used in the fix, or being tracked while there is no fix
    A  age of the last PVT message, in seconds
    H  course over ground, in degrees [0, 360)
    V  horizontal speed, in m/s
    C  strongest C/N0 values in dB-Hz, best first
"""

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

MAX_BARS = 6          # C/N0 bars on the matrix (N_BARS in the sketch)
MAX_SATS = 12         # the sketch shows the count on 4 bits and clamps to 12
NO_DATA_AGE_S = 99.0  # age reported when no PVT was ever received

# The MCU announces a 256-byte limit for a MessagePack-encoded response; the
# router replaces anything longer with an error. Stay well below it.
MAX_STATUS_BYTES = 200


@dataclass
class GnssStatus:
    pvt: int = 0
    sats: int = 0
    age_s: float = NO_DATA_AGE_S
    heading_deg: float = 0.0
    speed_mps: float = 0.0
    cn0: List[float] = field(default_factory=list)


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def has_fix(pvt: Optional[Dict[str, Any]]) -> bool:
    """Single definition of "the receiver has a position fix".

    solution_status is RTKLIB's code: 0 means no solution, any other value is
    a solution (5 = single point, which is what GNSS-SDR normally reports).
    At least four satellites are required, as in the web UI.
    """
    if not isinstance(pvt, dict):
        return False
    return _int(pvt.get("solution_status")) != 0 and _int(pvt.get("valid_sats")) >= 4


def build_status(
    pvt: Optional[Dict[str, Any]],
    pvt_age_ms: Optional[float],
    observables: Optional[List[Dict[str, Any]]],
    max_bars: int = MAX_BARS,
) -> GnssStatus:
    """Build the status from the monitor's REST API answers.

    pvt          -- "pvt" of /api/latest/pvt (None when stale or never received)
    pvt_age_ms   -- "age_ms" of /api/latest/pvt (None when never received)
    observables  -- "observables" of /api/latest/observables
    """
    st = GnssStatus()

    if pvt_age_ms is not None:
        st.age_s = min(NO_DATA_AGE_S, max(0.0, _finite(pvt_age_ms, NO_DATA_AGE_S * 1000.0) / 1000.0))

    fix = has_fix(pvt)
    if fix:
        st.pvt = 2
        st.sats = _int(pvt.get("valid_sats"))
        vel_e = _finite(pvt.get("vel_e"))
        vel_n = _finite(pvt.get("vel_n"))
        if pvt.get("speed_mps") is not None:
            st.speed_mps = max(0.0, _finite(pvt.get("speed_mps")))
        else:
            st.speed_mps = math.hypot(vel_e, vel_n)
        if pvt.get("cog") is not None:
            st.heading_deg = _finite(pvt.get("cog")) % 360.0
        elif st.speed_mps > 0.0:
            # Course from the velocity vector: 0 deg = north, clockwise.
            st.heading_deg = math.degrees(math.atan2(vel_e, vel_n)) % 360.0

    cn0: List[float] = []
    tracked = set()
    for item in observables or []:
        if not isinstance(item, dict):
            continue
        value = item.get("cn0_db_hz")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
            cn0.append(float(value))
            channel = item.get("channel_id")
            if isinstance(channel, int):
                tracked.add(channel)
    cn0.sort(reverse=True)
    st.cn0 = cn0[: max(0, max_bars)]

    # Without a fix, show how many satellites are being tracked instead.
    st.sats = max(st.sats, len(tracked)) if fix else len(tracked)
    st.sats = min(MAX_SATS, max(0, st.sats))
    return st


def format_status(st: GnssStatus) -> str:
    """Serialize for the MCU. The result is always shorter than MAX_STATUS_BYTES."""
    cn0 = ",".join(f"{v:.1f}" for v in st.cn0)
    text = (
        f"P={st.pvt};"
        f"S={st.sats};"
        f"A={st.age_s:.1f};"
        f"H={st.heading_deg:.1f};"
        f"V={st.speed_mps:.2f};"
        f"C={cn0};"
    )
    if len(text.encode("utf-8")) > MAX_STATUS_BYTES:
        # Cannot happen with MAX_BARS values, but never send something the MCU would reject.
        text = f"P={st.pvt};S={st.sats};A={st.age_s:.1f};H={st.heading_deg:.1f};V={st.speed_mps:.2f};C=;"
    return text
