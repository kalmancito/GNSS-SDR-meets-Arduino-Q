# Validation report

State of every test of the project. A result is `PASS` or `FAIL` only if the test was actually run and its evidence is kept; everything else is `NOT RUN`. "It builds" is not "it runs", and "it runs" is not "it computes a position".

**Last updated: 2026-11-15. No build and no hardware test has been run for the Yocto image.**

Summary: 4 static tests `PASS`, 3 static tests `NOT RUN`; every build, hardware, receiver, performance and operation test `NOT RUN`.

## Static tests (run without a build host or a board)

Run on 2026-11-15 on the development PC (Windows 11, Git Bash, Python 3.10).

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| S01 | Sources pinned, no network in build tasks, no host tuning, layer compat, kas files | `tests/test-recipe-metadata.sh` | **PASS** (1 item pending, see S01a) | 15 checks passed; fails as expected on a recipe with `AUTOREV`, `[network]`, `-march=native`, CRLF |
| S01a | Go modules of `arduino-router` pinned | part of S01 | **NOT RUN** | needs `scripts/update-go-mods.sh` on the build host |
| S02 | Receiver profiles: syntax, every parameter and implementation name exists in GNSS-SDR v0.0.22, monitor contract, rates consistent | `tests/test-configs.sh` | **PASS** | both profiles; the checker also flags 3 stale parameters in upstream's own examples |
| S03 | PVT output checker judges stages correctly | `python3 tests/test-pvt-output.py --self-test` | **PASS** | 11 checks. Uses hand-written format samples: this validates the checker, not a receiver |
| S04 | LED bridge logic: status string, heading/speed/age, limits, poller | `python3 -m unittest` in `apps/led-matrix/python` | **PASS** | 18 tests |
| S05 | Web monitor: protobuf decoding, state TTL, profile discovery, control backends, HTTP API | `npm ci && npm test` in `apps/web-monitor` | **NOT RUN** | no Node.js on the development PC; run on the build host |
| S06 | Shell scripts free of common errors | `shellcheck scripts/*.sh tests/*.sh` | **NOT RUN** | shellcheck not installed on the development PC |

## Build tests

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| B01 | The pinned BSP resolves and builds | `scripts/build-base.sh` | NOT RUN | log + artifact hashes |
| B02 | All metadata parses | `scripts/build-gnss-image.sh --parse` | NOT RUN | log |
| B03 | GNSS-SDR cross-builds and packages, AArch64, nothing downloaded outside `do_fetch` | `scripts/build-gnss-image.sh --recipe gnss-sdr`; `scripts/inspect-bitbake.sh` | NOT RUN | log, `manifests/build-manifest.txt` |
| B04 | The image builds | `scripts/build-gnss-image.sh --debug` | NOT RUN | image manifest + hashes |
| B05 | Build output is what it should be | `scripts/validate-image.sh` | NOT RUN | its output, `manifests/artifacts.sha256` |
| B06 | Licences of the image match the declarations | compare `build/tmp/deploy/licenses/` with [LICENSES.md](../LICENSES.md) | NOT RUN | licence manifest |

## Hardware tests

All **PENDING HARDWARE TEST**. They need the board, a 1.8 V serial adapter, and the owner's decision to flash.

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| R00 | Factory system inventoried, configurations saved | `scripts/capture-board-info.sh arduino@<board>` | NOT RUN | `docs/logs/board-inventory-<date>/` |
| R01 | Recovery works | [flashing-and-recovery.md](flashing-and-recovery.md): restore the factory image from EDL | NOT RUN | tool output, boot of the restored system |
| H01 | The image boots on a real UNO Q | serial console to login prompt | NOT RUN | boot log |
| H02 | It keeps booting (A/B slot marked good) | 5+ reboots, `gnss-diagnose` each time | NOT RUN | logs |
| H03 | USB host: the dongle enumerates and streams without loss | `lsusb`, `rtl_test -s 1200000` for 60 s | NOT RUN | output |
| H04 | Network and SSH | `nmcli`, `ssh` | NOT RUN | - |

## Receiver tests

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| G01 | `gnss-sdr` runs on the image | `gnss-sdr --version` | NOT RUN | output |
| G02 | A recorded file is read to the end, clean exit | `gps-l1ca-file` on the CTTC 2013 capture; stage *samples* of `tests/test-pvt-output.py` | NOT RUN | receiver output |
| G03 | Satellites acquired and tracked, navigation data decoded | same run; stages *acquisition*, *tracking*, *telemetry* | NOT RUN | receiver output, C/N0 |
| G04 | Position fixes; accuracy against a reference | same run; stages *pvt*, *accuracy* (`--reference`) | NOT RUN | CSV of fixes. **No reference position is recorded yet** ([tests/fixtures/README.md](../tests/fixtures/README.md)) |
| G05 | Live reception with the RTL-SDR, continuous | `gps-l1ca-live`, 30 min outdoors | NOT RUN | log, conditions as listed in [rf-frontends.md](rf-frontends.md) |
| G06 | Same capture on an x86-64 PC | GNSS-SDR v0.0.22 with the same profile | NOT RUN | comparison of fixes and timing |

The test matrix of the project brief maps as: T01 = G01, T02 = G02, T03-T04 = G03, T05 = G04, T06 = G06, T07 = P01.

## Performance

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| P01 | Real-time factor, CPU, peak memory, temperature; by channel count and with/without VOLK profile | `gnss-benchmark` | NOT RUN | `benchmark.csv` |
| P02 | Live: CPU per core, sample loss, gaps in PVT, over 30 min | `gnss-diagnose` during G05 | NOT RUN | logs |

Declared capability so far, per profile: **not tested** (file), **not tested** (live). (The original demo on the factory system ran 7 channels live in real time; that is a different build and is not a result for this image.)

## Operation

| ID | Criterion | Method | Result | Evidence |
|---|---|---|---|---|
| O01 | Services start at boot, stop cleanly | reboot; `systemctl status`; `systemctl stop gnss-sdr` closes RINEX | NOT RUN | journal |
| O02 | No SDR plugged in: one clear failure, no restart loop | boot without dongle; `journalctl -u gnss-sdr` | NOT RUN | journal |
| O03 | Web monitor: data shown, start/stop, profile selection, works without Internet | browser | NOT RUN | screenshots |
| O04 | Web monitor cannot be driven by another site | covered by S05 (`app.test.js`) + a manual cross-origin attempt | NOT RUN | - |
| M01 | LED matrix shows satellites, C/N0, fix state; stopping the bridge does not affect the receiver | observation | NOT RUN | photo/video |
| M02 | Sketch can be rebuilt and written from the board | `scripts/build-sketch.sh`, `gnss-mcu-flash` | NOT RUN | - |

## How to record a result

For every test that is run, add under `docs/logs/` (trimmed; no secrets):

- the exact command, date (UTC) and who ran it;
- `manifests/build-manifest.txt` and `manifests/artifacts.sha256` of the image under test;
- hardware: board variant (RAM/eMMC from the inventory), front-end, antenna;
- for receiver tests: the capture's SHA-256 or the live conditions, the profile's checksum, the receiver output, and the output of `tests/test-pvt-output.py`.

Then change the row here. A `FAIL` stays in the table with a link to its entry in [known-issues.md](known-issues.md) until it is fixed and re-run.
