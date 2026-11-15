# SPDX-License-Identifier: MPL-2.0
"""Unit tests for the LED matrix status logic.  Run:  python -m unittest -v"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gnss_poller import GnssPoller  # noqa: E402
from gnss_status import (  # noqa: E402
    MAX_STATUS_BYTES,
    NO_DATA_AGE_S,
    GnssStatus,
    build_status,
    format_status,
    has_fix,
)

# What the web monitor sends for a single-point fix (see server/udp_handlers.js).
PVT_FIX = {
    "type": "pvt",
    "lat": 41.275,
    "lon": 1.9876,
    "height": 80.0,
    "vel_e": 3.0,
    "vel_n": 4.0,
    "vel_u": 0.1,
    "cog": 36.87,
    "speed_mps": 5.0,
    "valid_sats": 7,
    "solution_status": 5,
}

OBS = [
    {"channel_id": 0, "prn": 1, "cn0_db_hz": 44.0},
    {"channel_id": 1, "prn": 7, "cn0_db_hz": 47.5},
    {"channel_id": 2, "prn": 9, "cn0_db_hz": 38.2},
]


class HasFixTest(unittest.TestCase):
    def test_single_point_solution_with_enough_satellites(self):
        self.assertTrue(has_fix(PVT_FIX))

    def test_any_nonzero_rtklib_status_is_a_fix(self):
        for status in (1, 2, 3, 4, 5, 6):
            self.assertTrue(has_fix({"solution_status": status, "valid_sats": 4}), status)

    def test_no_solution(self):
        self.assertFalse(has_fix({"solution_status": 0, "valid_sats": 9}))
        self.assertFalse(has_fix({"solution_status": 5, "valid_sats": 3}))
        self.assertFalse(has_fix({}))
        self.assertFalse(has_fix(None))
        self.assertFalse(has_fix({"solution_status": "x", "valid_sats": None}))


class BuildStatusTest(unittest.TestCase):
    # Regression: heading and speed never reached the matrix (they were read
    # from keys the server did not send), so the moving dot stayed still.
    def test_heading_and_speed_are_taken_from_the_pvt(self):
        st = build_status(PVT_FIX, 300, OBS)
        self.assertEqual(st.pvt, 2)
        self.assertEqual(st.sats, 7)
        self.assertAlmostEqual(st.heading_deg, 36.87)
        self.assertAlmostEqual(st.speed_mps, 5.0)

    def test_heading_and_speed_fall_back_to_the_velocity_vector(self):
        pvt = {k: v for k, v in PVT_FIX.items() if k not in ("cog", "speed_mps")}
        st = build_status(pvt, 0, OBS)
        self.assertAlmostEqual(st.speed_mps, 5.0)
        self.assertAlmostEqual(st.heading_deg, math.degrees(math.atan2(3.0, 4.0)))

        west = dict(pvt, vel_e=-2.0, vel_n=0.0)
        self.assertAlmostEqual(build_status(west, 0, OBS).heading_deg, 270.0)

    def test_heading_is_normalised(self):
        self.assertAlmostEqual(build_status(dict(PVT_FIX, cog=-90.0), 0, []).heading_deg, 270.0)
        self.assertAlmostEqual(build_status(dict(PVT_FIX, cog=725.0), 0, []).heading_deg, 5.0)

    # Regression: the age was always reported as 0.
    def test_age_comes_from_the_api(self):
        self.assertAlmostEqual(build_status(PVT_FIX, 1500, OBS).age_s, 1.5)
        self.assertAlmostEqual(build_status(None, 7200, OBS).age_s, 7.2)
        self.assertEqual(build_status(None, None, OBS).age_s, NO_DATA_AGE_S)
        self.assertEqual(build_status(None, 10_000_000, OBS).age_s, NO_DATA_AGE_S)

    def test_without_fix_the_tracked_channels_are_counted(self):
        st = build_status(None, None, OBS)
        self.assertEqual(st.pvt, 0)
        self.assertEqual(st.sats, 3)
        self.assertEqual(st.heading_deg, 0.0)
        self.assertEqual(st.speed_mps, 0.0)

    def test_stale_or_invalid_pvt_is_not_a_fix(self):
        st = build_status(dict(PVT_FIX, solution_status=0), 100, OBS)
        self.assertEqual(st.pvt, 0)
        self.assertEqual(st.sats, 3)
        self.assertEqual(st.speed_mps, 0.0)

    def test_cn0_sorted_filtered_and_limited(self):
        obs = OBS + [
            {"channel_id": 3, "cn0_db_hz": 0.0},
            {"channel_id": 4, "cn0_db_hz": -5},
            {"channel_id": 5, "cn0_db_hz": float("nan")},
            {"channel_id": 6, "cn0_db_hz": "strong"},
            {"channel_id": 7, "cn0_db_hz": True},
            "garbage",
            None,
        ]
        st = build_status(None, None, obs)
        self.assertEqual(st.cn0, [47.5, 44.0, 38.2])
        self.assertEqual(st.sats, 3)
        self.assertEqual(build_status(None, None, obs, max_bars=2).cn0, [47.5, 44.0])

    def test_satellite_count_is_clamped(self):
        many = [{"channel_id": i, "cn0_db_hz": 40.0 + i * 0.1} for i in range(30)]
        self.assertEqual(build_status(None, None, many).sats, 12)
        self.assertEqual(build_status(dict(PVT_FIX, valid_sats=40), 0, []).sats, 12)

    def test_nan_and_garbage_values_do_not_propagate(self):
        st = build_status(dict(PVT_FIX, cog=float("nan"), speed_mps=float("inf")), float("nan"), None)
        self.assertEqual(st.heading_deg, 0.0)
        self.assertEqual(st.speed_mps, 0.0)
        self.assertEqual(st.age_s, NO_DATA_AGE_S)


class FormatStatusTest(unittest.TestCase):
    def test_wire_format_matches_the_sketch_parser(self):
        text = format_status(build_status(PVT_FIX, 300, OBS))
        self.assertEqual(text, "P=2;S=7;A=0.3;H=36.9;V=5.00;C=47.5,44.0,38.2;")

    def test_no_data(self):
        self.assertEqual(format_status(GnssStatus()), "P=0;S=0;A=99.0;H=0.0;V=0.00;C=;")

    def test_always_fits_in_the_mcu_message_limit(self):
        worst = GnssStatus(pvt=2, sats=12, age_s=99.0, heading_deg=359.9, speed_mps=12345.67, cn0=[99.9] * 64)
        self.assertLessEqual(len(format_status(worst).encode()), MAX_STATUS_BYTES)
        typical = build_status(PVT_FIX, 300, [{"channel_id": i, "cn0_db_hz": 45.0} for i in range(12)])
        self.assertLessEqual(len(format_status(typical).encode()), 64)


class PollerTest(unittest.TestCase):
    def make(self, answers):
        calls = []

        def fetch(url):
            calls.append(url)
            for key, value in answers.items():
                if key in url:
                    if isinstance(value, Exception):
                        raise value
                    return value
            return None

        return GnssPoller("http://monitor:8080/", fetch=fetch, log=lambda *_: None), calls

    def test_poll_builds_the_status_from_both_endpoints(self):
        poller, calls = self.make(
            {
                "/api/latest/pvt": {"ok": True, "pvt": PVT_FIX, "age_ms": 300},
                "/api/latest/observables": {"ok": True, "meta": {}, "observables": OBS},
            }
        )
        self.assertEqual(poller.get_status_text(), "P=0;S=0;A=99.0;H=0.0;V=0.00;C=;")
        poller.poll_once()
        self.assertEqual(poller.get_status_text(), "P=2;S=7;A=0.3;H=36.9;V=5.00;C=47.5,44.0,38.2;")
        self.assertEqual(
            calls,
            ["http://monitor:8080/api/latest/pvt", "http://monitor:8080/api/latest/observables?limit=64"],
        )

    def test_monitor_down_means_no_fix_not_an_exception(self):
        poller, _ = self.make(
            {"/api/latest/pvt": OSError("connection refused"), "/api/latest/observables": OSError("connection refused")}
        )
        poller.poll_once()
        self.assertEqual(poller.get_status_text(), "P=0;S=0;A=99.0;H=0.0;V=0.00;C=;")

    def test_unexpected_json_shapes_are_tolerated(self):
        poller, _ = self.make({"/api/latest/pvt": ["not", "a", "dict"], "/api/latest/observables": {"observables": "x"}})
        poller.poll_once()
        self.assertEqual(poller.get_status_text(), "P=0;S=0;A=99.0;H=0.0;V=0.00;C=;")


if __name__ == "__main__":
    unittest.main()
