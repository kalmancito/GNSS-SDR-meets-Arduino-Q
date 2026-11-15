#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (C) 2025 ARDUINO SA <http://www.arduino.cc>
#
# SPDX-License-Identifier: MPL-2.0

"""
UNO Q GNSS HUD - Test Generator (no GNSS required)

Exposes Bridge function:
  get_gnss_status() -> STRING:
    "P=<0|1|2>;S=<int>;A=<sec>;H=<deg>;V=<mps>;C=<cn0_1,cn0_2,...>"

Where:
  P: PVT status 0=no PVT, 1=degraded/2D, 2=valid 3D
  S: satellites count
  A: age seconds (freshness)
  H: heading degrees
  V: speed m/s
  C: top-N CN0 values (dB-Hz), comma separated

This is designed to validate your matrix encodings:
  - SV binary bits
  - CN0 bars + brightness
  - PVT blink/pulse/solid
  - heading/speed moving dot
  - age-driven pulse rate
"""

import math
import os
import threading
import time
from dataclasses import dataclass
from arduino.app_utils import *

# ------------------------------
# Configuration
# ------------------------------
UPDATE_HZ = float(os.getenv("TEST_HZ", "5"))           # how fast the internal model updates
TOP_N = int(os.getenv("TEST_TOP_N", "6"))             # number of CN0 values in C=
SCENARIO_PERIOD_S = float(os.getenv("TEST_PERIOD", "18"))  # full cycle duration

# ------------------------------
# Shared test state (returned via Bridge)
# ------------------------------
_lock = threading.Lock()

@dataclass
class Status:
    P: int = 0       # 0/1/2
    S: int = 0       # sats
    A: float = 0.0   # age seconds
    H: float = 0.0   # heading deg
    V: float = 0.0   # speed m/s
    C: list = None   # list of CN0 floats

_state = Status(C=[0.0]*TOP_N)

def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x

def _fmt_status(st: Status) -> str:
    # IMPORTANT: return STRING (type-safe with MCU String decoding)
    c = ",".join(f"{float(v):.1f}".rstrip("0").rstrip(".") for v in st.C[:TOP_N])
    return f"P={int(st.P)};S={int(st.S)};A={float(st.A):.2f};H={float(st.H):.0f};V={float(st.V):.2f};C={c}"

def get_gnss_status():
    with _lock:
        return _fmt_status(_state)

Bridge.provide("get_gnss_status", get_gnss_status)

# ------------------------------
# Scenario generator
# ------------------------------
def _make_cn0_set(base: float, spread: float, n: int, t: float) -> list:
    # Generate descending CN0s with mild breathing to animate bars/brightness
    out = []
    for i in range(n):
        wobble = 1.5 * math.sin(2*math.pi*(t/5.0) + i*0.9)
        out.append(base - i*spread + wobble)
    # keep non-negative, realistic range
    out = [float(_clamp(v, 0.0, 55.0)) for v in out]
    return out

def _scenario(t: float) -> Status:
    """
    t in seconds; returns a Status.
    One full cycle covers:
      - 0..6s  : no PVT, low CN0, low sats, age grows (stale)
      - 6..12s : degraded/2D, medium CN0, sats ramp, age moderate
      - 12..18s: valid 3D, high CN0, sats high, age fresh, heading rotates, speed varies
    """
    phase = (t % SCENARIO_PERIOD_S)

    st = Status(C=[0.0]*TOP_N)

    if phase < 6.0:
        # No PVT (blink on MCU), stale
        st.P = 0
        st.S = int(3 + 3*math.sin(2*math.pi*phase/6.0) + 1.5)  # ~2..7
        st.A = 8.0 + 2.0*math.sin(2*math.pi*phase/3.0)         # older -> faster pulse
        st.H = 0.0
        st.V = 0.0
        st.C = _make_cn0_set(base=26.0, spread=1.7, n=TOP_N, t=t)

    elif phase < 12.0:
        # Degraded/2D (slow pulse), moderate
        st.P = 1
        u = (phase - 6.0) / 6.0
        st.S = int(6 + 10*u)                                   # ramp 6..16
        st.A = 2.5 + 1.0*math.sin(2*math.pi*phase/4.0)         # moderate age
        st.H = (phase - 6.0) * 30.0                            # slow heading drift
        st.V = 0.5 + 1.5*math.sin(2*math.pi*phase/6.0)
        st.C = _make_cn0_set(base=34.0, spread=1.4, n=TOP_N, t=t)

    else:
        # Valid 3D (solid), fresh and dynamic
        st.P = 2
        u = (phase - 12.0) / 6.0
        st.S = int(14 + 6*math.sin(2*math.pi*u))               # ~8..20
        st.A = 0.2 + 0.2*math.sin(2*math.pi*phase/2.5)         # fresh
        st.H = (phase - 12.0) * 60.0 + 90.0                    # rotating heading
        st.H = st.H % 360.0
        st.V = 2.0 + 3.0*abs(math.sin(2*math.pi*u))            # 2..5 m/s
        st.C = _make_cn0_set(base=45.0, spread=1.2, n=TOP_N, t=t)

    # clamp and normalize
    st.P = int(_clamp(int(st.P), 0, 2))
    st.S = int(_clamp(int(st.S), 0, 63))
    st.A = float(_clamp(float(st.A), 0.0, 99.0))
    st.H = float(st.H % 360.0)
    st.V = float(_clamp(float(st.V), 0.0, 50.0))
    return st

def _run_generator():
    dt = 1.0 / UPDATE_HZ if UPDATE_HZ > 0 else 0.2
    t0 = time.time()
    while True:
        t = time.time() - t0
        st = _scenario(t)
        with _lock:
            global _state
            _state = st
        time.sleep(dt)

threading.Thread(target=_run_generator, name="gnss_test_gen", daemon=True).start()

# ------------------------------
# App loop (required)
# ------------------------------
App.run()
