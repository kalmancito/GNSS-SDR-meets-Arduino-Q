#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""GNSS status bridge for the UNO Q LED matrix, without Arduino App Lab.

Used in the Yocto image: it registers `get_gnss_status` on the arduino-router
daemon (MessagePack-RPC over a Unix socket), which forwards the MCU's calls
arriving on the serial link. The sketch is the same one used with App Lab.

The receiver does not depend on this service: if the MCU or the router is not
there, this process keeps retrying and nothing else is affected.

Environment:
    NODE_BASE_URL   web monitor base URL      (default http://127.0.0.1:8080)
    POLL_HZ         polling rate              (default 2)
    MAX_BARS        C/N0 values sent          (default 6)
    ROUTER_ADDRESS  router address            (default unix:///var/run/arduino-router.sock)
"""

import os
import signal
import sys
import threading

from arduino.router_bridge import Bridge

from gnss_poller import GnssPoller

METHOD = "get_gnss_status"


def main() -> int:
    base_url = os.getenv("NODE_BASE_URL", "http://127.0.0.1:8080")
    poll_hz = float(os.getenv("POLL_HZ", "2"))
    max_bars = int(os.getenv("MAX_BARS", "6"))
    address = os.getenv("ROUTER_ADDRESS", "unix:///var/run/arduino-router.sock")

    poller = GnssPoller(base_url, poll_hz=poll_hz, max_bars=max_bars)
    poller.start()

    bridge = Bridge(address)
    # Registration is declarative: it is (re)applied whenever the router connection comes up.
    bridge.provide(METHOD, poller.get_status_text)

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    print(f"[gnss-led] polling {base_url} at {poll_hz} Hz; router at {address}", flush=True)
    if not bridge.connect(timeout=10):
        print("[gnss-led] router not reachable yet, retrying in the background", flush=True)

    stop.wait()
    poller.stop()
    bridge.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(main())
