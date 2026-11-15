#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""GNSS status bridge for the UNO Q LED matrix: Arduino App Lab entry point.

Runs inside the App Lab container on the factory Debian image. The same logic
is used without App Lab by gnss_led_bridge.py (Yocto image).

Environment:
    NODE_BASE_URL   web monitor base URL (default: the Docker host gateway)
    NODE_PORT       web monitor port     (default 8080)
    POLL_HZ         polling rate         (default 2)
    MAX_BARS        C/N0 values sent     (default 6)
    ENABLE_CONSOLE  "1" prints a text dashboard every PRINT_EVERY_S seconds
"""

import os
import threading
import time

# Arduino Bridge environment
from arduino.app_utils import *  # noqa: F401,F403  (provides App and Bridge)

from gnss_poller import GnssPoller

NODE_PORT = int(os.getenv("NODE_PORT", "8080"))
# 172.17.0.1 is the Docker host gateway: the web monitor runs on the host.
NODE_BASE_URL = os.getenv("NODE_BASE_URL", f"http://172.17.0.1:{NODE_PORT}")
POLL_HZ = float(os.getenv("POLL_HZ", "2"))
MAX_BARS = int(os.getenv("MAX_BARS", "6"))
PRINT_EVERY_S = float(os.getenv("PRINT_EVERY_S", "1.0"))
ENABLE_CONSOLE = os.getenv("ENABLE_CONSOLE", "1") == "1"

poller = GnssPoller(NODE_BASE_URL, poll_hz=POLL_HZ, max_bars=MAX_BARS)
poller.start()
print(f"[PY] GNSS poller started. Polling {NODE_BASE_URL} at {POLL_HZ} Hz")


def _console_loop() -> None:
    while True:
        st = poller.get_status()
        cn0 = ", ".join(f"{v:.1f}" for v in st.cn0) if st.cn0 else "(searching...)"
        print(f"=== GNSS MONITOR [{time.strftime('%H:%M:%S')}] ===")
        print(f" DASH: P={st.pvt} S={st.sats} Age={st.age_s:.1f}s Hdg={st.heading_deg:.1f} deg Spd={st.speed_mps:.2f} m/s")
        print(f" CN0: {cn0}")
        time.sleep(PRINT_EVERY_S)


if ENABLE_CONSOLE:
    threading.Thread(target=_console_loop, name="gnss-console", daemon=True).start()

Bridge.provide("get_gnss_status", poller.get_status_text)

if __name__ == "__main__":
    App.run()
