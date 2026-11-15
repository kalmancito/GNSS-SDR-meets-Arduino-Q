# Known issues and open questions

Last updated: 2026-11-15. No build has been run yet, so this list holds what is **known to be unfinished** and what is **expected to need attention**; real build and hardware failures get added as they happen, each with cause, fix and the test that now guards against it.

## Unfinished

| # | What | Consequence | To close it |
|---|---|---|---|
| U1 | `arduino-router-go-mods.inc` and `-licenses.inc` do not exist | `arduino-router` does not compile (modules cannot be downloaded during the build), so the image does not build either | `scripts/update-go-mods.sh` on the build host; commit the two files |
| U2 | `gps-l1ca-live.conf` holds upstream's example values, not the demo's validated tuning | Live reception may be worse than the demo's (1 ms integration instead of 4 ms; gains not adapted) | Recover `all_bands_rtl_realtime.conf` with `scripts/capture-board-info.sh` and carry its values over; re-run `tests/test-configs.sh` |
| U3 | No reference position for the test capture | Accuracy (G04) cannot be judged; only "fixes obtained" | Record surveyed coordinates or a trusted receiver's solution in `tests/fixtures/README.md` |
| U4 | SHA-256 of the test capture not recorded | The capture is verified by size and by the archive's MD5 only | Run `tests/fixtures/fetch-test-capture.sh` and write the printed hash into the README |
| U5 | Web monitor tests and shellcheck not run | Node.js code was reviewed and has tests, but they have not executed anywhere yet | `npm ci && npm test` on the build host; `shellcheck scripts/*.sh tests/*.sh` |
| U6 | `apps/web-monitor/package-lock.json` was edited by hand to add `chart.js` and `leaflet` (no npm available on the development PC) | `npm ci` may reject it if an entry is not exactly what npm would write | Run `npm install --package-lock-only` once where npm is available and commit the result |

## Expected to need attention at build time

Each has a fallback in [ADR-002](decisions/ADR-002-gnss-sdr-recipe.md) or [ADR-008](decisions/ADR-008-mcu-bridge.md).

| # | Risk | Why it is uncertain |
|---|---|---|
| B1 | GNSS-SDR v0.0.22 against GNU Radio from `meta-sdr` | `meta-sdr` builds a snapshot of GNU Radio's development branch, not a release |
| B2 | `lapack` needs a Fortran compiler | Enabled with `FORTRAN:forcevariable` in the distro; not yet seen to work with this BSP's toolchain settings |
| B3 | `volk_gnsssdr` / `cpu_features` cross-compilation | Built in-tree by GNSS-SDR's CMake as a sub-project with its own toolchain handling |
| B4 | `matio` from git without its submodule, with autotools | The reference recipe fetched the submodule |
| B5 | npm class with a lock file of version 3 and a local source tree | The class supports it at the pinned OE-Core; this exact arrangement (sources from `apps/`, lock copied to `npm-shrinkwrap.json`) is untried |
| B6 | OpenOCD's `linuxgpiod` driver with libgpiod 2.x | The pinned OpenOCD revision's support for the v2 API was not checked |
| B7 | `networkmanager-wifi`, `networkmanager-nmcli` package names; removing `networkd` from systemd | Read from the recipes; not built |
| B8 | Licence checksum (`LIC_FILES_CHKSUM`) of `arduino-router`, `armadillo`, `matio`, the Python bridge | Computed from the files at the pinned commits; BitBake will confirm |

## Expected to need attention on hardware

| # | Risk | Detail |
|---|---|---|
| H1 | UART to the STM32 missing with the default kernel | `/dev/ttyHS1` needs the `serial1` alias in the device tree; checked on the built DTB by `scripts/validate-image.sh`; fallback `--linux-arduino` |
| H2 | GPIO chip/line numbers differ from the factory kernel | The router unit and the OpenOCD configuration use `gpiochip1` lines 25, 26, 37, 38, 70 as on the factory system. Wrong numbers mean no LED matrix, and in the worst case a line driven that should not be. **Compare `gpioinfo` with the factory inventory before enabling `arduino-router`** on a new kernel |
| H3 | Wi-Fi identity after a full flash | Not verified whether the MAC address and calibration survive rewriting the whole eMMC and a later factory restore |
| H4 | USB host mode and dongle power | Depends on how the board is powered; see [board-access.md](board-access.md) |
| H5 | `rtl_tcp` single-client behaviour | The pre-start check probes the port and waits 1 s before the receiver connects; if `rtl_tcp` needs longer to accept again, the first start fails and systemd retries after 10 s |
| H6 | Real-time margin on the Cortex-A53 | Unknown for this build until P01; the demo's 7 channels are the reference point |

## By design (limitations, not defects)

- **The web UI has no authentication.** Anyone who can reach port 8080 can start and stop the receiver. Cross-site requests are refused (JSON-only POST, no CORS headers), which stops a web page in someone's browser from doing it, but not a person on the same network. Restrict with `HTTP_HOST=127.0.0.1` and an SSH tunnel, or a firewall.
- **Map tiles need Internet.** Everything else in the UI is served by the board.
- **Receiver outputs grow.** RINEX and NMEA files accumulate in `/var/lib/gnss-sdr/output/`; nothing rotates them yet. On a 16 GB eMMC, clear them periodically or turn them off in the profile for long runs.
- **`volk_gnsssdr_profile` is not run automatically.** It takes minutes and would delay the first boot. Run `gnss-benchmark --profile` once.
- **The position chart plots latitude, longitude (degrees) and height (metres) on one axis**, as the original UI did; the statistics page is the readable view of position spread.
- **Leap seconds are hard-coded (18 s) in the web UI's GPS-to-UTC conversion.**
- **GPS L1 C/A only.**

## Fixed in the application code during the move to Yocto

Found by reading the code; each has a regression test. The tests have run for the Python side only ([validation-report.md](validation-report.md), S04/S05).

| Defect | Where | Test |
|---|---|---|
| A missing `gnss-sdr` binary crashed the whole web server (unhandled `error` event) | `server/gnss_control.js` | `gnss_control.test.js` |
| *Stop* answered "stopped" before the process had exited; an immediate *start* failed | `server/gnss_control.js` | `gnss_control.test.js` |
| Idle channels were never filtered: `fs !== 0` on a 64-bit protobuf field compares an object | `server/udp_handlers.js` | `udp_decode.test.js` |
| Any web page could start/stop the receiver (`Access-Control-Allow-Origin: *`, plain POST) | `server/app.js` | `app.test.js` |
| Monitor UDP ports listened on all interfaces: anyone on the network could inject positions | `server/udp_handlers.js`, `config.js` | default is loopback |
| Chart history silently truncated to 600 points (said 3000); statistics computed on the truncated data | `public/app.js` | manual (O03) |
| Chart redraw requests dropped instead of deferred | `public/app.js` | manual (O03) |
| Time axis labelled UTC but drawn in local time | `public/app.js` | manual (O03) |
| UI depended on three CDNs: blank without Internet | `public/index.html`, `server/app.js` | `app.test.js` |
| Heading and speed never reached the LED matrix; age always 0 | `server/udp_handlers.js`, `apps/led-matrix/python` | `udp_decode.test.js`, `test_gnss_status.py` |
| Three different definitions of "has a position fix" | web UI, bridge, sketch | `test_gnss_status.py` (`has_fix`) |
