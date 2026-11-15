# SPDX-License-Identifier: MPL-2.0
"""Background poller of the GNSS-SDR web monitor REST API.

Keeps the latest status string ready so the MCU's request is answered
immediately, whatever the state of the receiver or of the network.
"""

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

from gnss_status import GnssStatus, build_status, format_status


def http_get_json(url: str, timeout: float = 1.0) -> Optional[Any]:
    """GET a JSON document. Returns None on any error (logged by the caller)."""
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read()
    if not raw or not raw.strip():
        return None
    return json.loads(raw.decode("utf-8", errors="replace"))


class GnssPoller:
    """Polls /api/latest/pvt and /api/latest/observables at a fixed rate."""

    def __init__(
        self,
        base_url: str,
        poll_hz: float = 2.0,
        max_bars: int = 6,
        fetch: Callable[[str], Optional[Any]] = http_get_json,
        log: Callable[[str], None] = print,
    ):
        self._pvt_url = f"{base_url.rstrip('/')}/api/latest/pvt"
        self._obs_url = f"{base_url.rstrip('/')}/api/latest/observables?limit=64"
        self._period = 1.0 / poll_hz if poll_hz > 0 else 0.5
        self._max_bars = max_bars
        self._fetch = fetch
        self._log = log
        self._lock = threading.Lock()
        self._status = GnssStatus()
        self._text = format_status(self._status)
        self._last_error_log = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -- data access ---------------------------------------------------------
    def get_status_text(self) -> str:
        """The string handed to the MCU (see gnss_status for the format)."""
        with self._lock:
            return self._text

    def get_status(self) -> GnssStatus:
        with self._lock:
            return self._status

    # -- polling -------------------------------------------------------------
    def _get(self, url: str) -> Optional[Any]:
        try:
            return self._fetch(url)
        except (urllib.error.URLError, OSError, ValueError) as e:
            now = time.monotonic()
            if now - self._last_error_log > 10.0:  # rate limited
                self._last_error_log = now
                self._log(f"[gnss-led] cannot read {url}: {type(e).__name__}: {e}")
            return None

    def poll_once(self) -> GnssStatus:
        pvt_data = self._get(self._pvt_url)
        obs_data = self._get(self._obs_url)

        pvt = pvt_data.get("pvt") if isinstance(pvt_data, dict) else None
        age_ms = pvt_data.get("age_ms") if isinstance(pvt_data, dict) else None
        observables = obs_data.get("observables") if isinstance(obs_data, dict) else None

        status = build_status(
            pvt if isinstance(pvt, dict) else None,
            age_ms if isinstance(age_ms, (int, float)) else None,
            observables if isinstance(observables, list) else None,
            self._max_bars,
        )
        with self._lock:
            self._status = status
            self._text = format_status(status)
        return status

    def _run(self) -> None:
        while not self._stop.is_set():
            self.poll_once()
            self._stop.wait(self._period)

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="gnss-poller", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
