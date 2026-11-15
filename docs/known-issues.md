# Known issues and open questions

Last updated: 2026-11-15. No build has been run yet, so this list holds what is **known to be unfinished** and what is **expected to need attention**; real build and hardware failures get added as they happen, each with cause, fix and the test that now guards against it.

## Unfinished

| # | What | Consequence | To close it |
|---|---|---|---|
| U1 | `arduino-router-go-mods.inc` and `-licenses.inc` do not exist | `arduino-router` does not compile (modules cannot be downloaded during the build), so the image does not build either | `scripts/update-go-mods.sh` on the build host; commit the two files |
| ~~U2~~ | ~~`gps-l1ca-live.conf` holds upstream's example values~~ | Closed 2026-11-15: the demo's configuration was recovered from the board and its signal-processing values carried over (2.048 MS/s, 7 channels, 4 ms integration, narrow loops). The source differs: the demo used `Osmosdr_Signal_Source`, the image uses `rtl_tcp` ([ADR-003](decisions/ADR-003-signal-sources.md)) | - |
| U7 | The two file-replay configurations of the demo (`file_GPS_L1_alta_dinamica.conf`, `cubesat_GPS.conf`) and their captures are not on the board | Those demos cannot be reproduced from what was recovered | Find them on the machine they were recorded on; document each capture in `tests/fixtures/README.md` |
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

## Found while building

| # | Problem | Cause | Fix | Guard |
|---|---|---|---|---|
| B9 | `bitbake -p` failed: 17 errors in `meta-sdr/.../gnuradio4-studio_git.bb` and `gnuradio4-incubator_git.bb`, `LICENSE value "... AND ..." has an invalid format` (2026-11-15, [log](logs/build-20261115/parse-B02.txt)) | `meta-sdr`'s `master`, the only branch declaring `wrynose`, carries the GNU Radio 4 stack, developed against the next OE-Core series; these two recipes write `LICENSE` as an SPDX expression, which wrynose's BitBake rejects at parse time | `BBMASK` of the GNU Radio 4 recipes and images in `meta-gnss-uno-q/conf/layer.conf`; the image uses GNU Radio 3.x only. Pin unchanged | `tests/test-recipe-metadata.sh` fails if a meta-sdr recipe with an SPDX `LICENSE` is not masked (checked against the real checkout: passes, and fails when a mask is removed) |

## Expected to need attention on hardware

| # | Risk | Detail |
|---|---|---|
| H1 | UART to the STM32 missing with the default kernel | `/dev/ttyHS1` needs the `serial1` alias in the device tree; checked on the built DTB by `scripts/validate-image.sh`; fallback `--linux-arduino` |
| H2 | GPIO chip/line numbers differ from the factory kernel | Confirmed on the factory kernel (6.16): `gpiochip1` is the SoC pin controller (`500000.pinctrl`, 127 lines), lines 25/26 (SWD) and 37/38 are outputs, and the factory router unit drives 37 and 70 as this image's does. Still to check under the Yocto kernel (6.18): **compare `gpioinfo` with [the inventory](logs/board-inventory-20261115/gpio.txt) before relying on `arduino-router`** |
| H3 | Device partitions after a full flash | Measured: the MAC addresses (eMMC `boot0`) are kept; `persist`, `modemst1/2`, `fsg`, `fsc` change place and lose their factory content, also after restoring the factory image. Effect on Wi-Fi under Yocto unknown. Mitigation: mandatory backup and restore procedure ([flashing-and-recovery.md](flashing-and-recovery.md#calibration-and-identity-partitions)) |
| H4 | USB host mode and dongle power | Depends on how the board is powered; see [board-access.md](board-access.md) |
| H5 | `rtl_tcp` single-client behaviour | The pre-start check probes the port and waits 1 s before the receiver connects; if `rtl_tcp` needs longer to accept again, the first start fails and systemd retries after 10 s |
| H6 | Real-time margin on the Cortex-A53 | Unknown for this build until P01; the demo's 7 channels are the reference point |

## By design (limitations, not defects)

- **The web UI has no authentication.** Anyone who can reach port 8080 can start and stop the receiver. Cross-site requests are refused (JSON-only POST, no CORS headers), which stops a web page in someone's browser from doing it, but not a person on the same network. Restrict with `HTTP_HOST=127.0.0.1` and an SSH tunnel, or a firewall.
- **Map tiles need Internet.** Everything else in the UI is served by the board.
- **Receiver outputs grow.** The file profile writes RINEX and NMEA to `/var/lib/gnss-sdr/output/`; nothing rotates them. The live profile writes no files (as the demo), only the monitor streams. On a 16 GB eMMC, clear the output directory after file runs.
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
