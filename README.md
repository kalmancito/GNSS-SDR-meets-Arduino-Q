# GNSS-SDR receiver on Arduino UNO Q

A software-defined GPS receiver on the **Arduino UNO Q** (Qualcomm QRB2210, 4 x Cortex-A53), built as a reproducible **Yocto** image: [GNSS-SDR](https://gnss-sdr.org) cross-compiled for AArch64, a web monitor to watch and control it, and the board's LED matrix showing the receiver status.

![Arduino UNO Q setup](images/arduino_uno_q_setup.jpg)

> **Status (2026-11-15): the image has not been built or run yet.**
> Everything in this repository is written and statically checked (pinned manifests, recipes, receiver profiles validated against the GNSS-SDR source, unit tests), but no BitBake build and no hardware test has been executed for the Yocto image. [docs/validation-report.md](docs/validation-report.md) lists every test with its real state (`PASS`, `FAIL` or `NOT RUN`) and the command that runs it.
>
> The receiver itself is proven on this board: the [original demo](docs/legacy-debian.md), built by hand on the factory Debian system, tracks 7 GPS L1 C/A channels and computes position in real time with an RTL-SDR ([video](https://youtu.be/a7ZrCYMQSxc)).

## What is in the image

```text
   active GNSS antenna
          |
      RTL-SDR (USB) ------------ or ------------ recorded I/Q file
          |                                            |
   rtl_tcp (loopback)                                  |
          +---------------------+----------------------+
                                |
                      GNSS-SDR  (gnss-sdr.service)
                 GPS L1 C/A: acquisition, tracking, PVT
                      |                         |
        RINEX / NMEA files          protobuf monitor (UDP, loopback)
                                                |
                                   web monitor (Node.js, :8080)
                              position, channels, map, statistics,
                                 start/stop and profile selection
                                                |
                                     LED bridge (Python)
                                                |
                                  arduino-router -- UART --> STM32U585
                                                              LED matrix
```

| Component | Recipe | Notes |
|---|---|---|
| GNSS-SDR v0.0.22 | `gnss-sdr` | File and `rtl_tcp` sources by default; no UHD, ZeroMQ or GUI. |
| Receiver profiles | `gnss-config` | `/etc/gnss-sdr/gps-l1ca-file.conf`, `gps-l1ca-live.conf` |
| Web monitor | `gnss-web-monitor` | Sources in [apps/web-monitor](apps/web-monitor). Works without Internet (except map tiles). |
| LED matrix bridge | `gnss-led-bridge`, `arduino-router` | Sources in [apps/led-matrix](apps/led-matrix). No Arduino App Lab or Docker needed. |
| Base system | BSP layers | Kernel, firmware, bootloader, Wi-Fi and A/B boot marking from Qualcomm's `meta-qcom-arduino`, unchanged. |

Baseline: Yocto 6.0 "wrynose" (LTS), `MACHINE = "uno-q"`, every layer and source pinned to a commit ([manifests/revisions.lock](manifests/revisions.lock)).

## Build

On a Linux x86_64 host with Docker or Podman, about 120 GB of free disk and 16 GB of RAM:

```bash
git clone https://github.com/kalmancito/GNSS-SDR-meets-Arduino-Q.git
cd GNSS-SDR-meets-Arduino-Q

scripts/bootstrap-host.sh --install   # checks the host, downloads kas-container
scripts/build-base.sh                 # the pinned Qualcomm BSP alone (reference build)
scripts/update-go-mods.sh             # once: pin the Go modules of arduino-router
scripts/build-gnss-image.sh --debug   # the receiver image, password-less root for bring-up
scripts/validate-image.sh             # checks on the build output
```

Details, caches and troubleshooting: [docs/setup-host.md](docs/setup-host.md), [docs/build.md](docs/build.md).

## Flash and run

Flashing **erases the board**, including the factory system and `/home/arduino`. Read [docs/flashing-and-recovery.md](docs/flashing-and-recovery.md) first; it also covers how to go back to the factory image.

```bash
scripts/capture-board-info.sh arduino@<board>   # BEFORE flashing: inventory + your .conf files
scripts/flash-guarded.sh                        # dry run: shows what would be written
```

After the first boot: [docs/board-access.md](docs/board-access.md) (console, Wi-Fi, SSH, USB host mode), [docs/rf-frontends.md](docs/rf-frontends.md) (antenna and RTL-SDR), then open `http://<board>:8080`.

## Tests

```bash
tests/test-recipe-metadata.sh    # pins, no network in build tasks, no host tuning, kas files
tests/test-configs.sh            # receiver profiles vs. the pinned GNSS-SDR source
python3 tests/test-pvt-output.py --self-test
(cd apps/led-matrix/python && python3 -m unittest -v)
(cd apps/web-monitor && npm ci && npm test)
```

These run anywhere and need no board. Build and hardware tests are listed in [docs/validation-report.md](docs/validation-report.md).

## Repository layout

| Path | Contents |
|---|---|
| [kas/](kas) | Build manifests: `uno-q-upstream.yml` (pinned BSP), `uno-q-gnss-sdr.yml` (product) |
| [meta-gnss-uno-q/](meta-gnss-uno-q) | The product layer: distro, image, recipes, systemd units, receiver profiles |
| [apps/web-monitor/](apps/web-monitor) | Node.js web monitor (server, UI, tests) |
| [apps/led-matrix/](apps/led-matrix) | LED matrix: Python bridge, STM32 sketch, Arduino App Lab app |
| [scripts/](scripts) | Host check, builds, image validation, board inventory and diagnosis, benchmark, guarded flashing |
| [tests/](tests) | Static checks and the PVT output checker |
| [docs/](docs) | Research, decisions (ADRs), guides, validation report, known issues |
| [manifests/](manifests) | Pinned revisions and the build manifest |
| `local/` | Your SSH key and Wi-Fi profile for the image; never committed ([local/README.md](local/README.md)) |

## Scope

In: GPS L1 C/A, one band, one antenna; recorded I/Q files and RTL-SDR.

Not yet: Galileo and multi-constellation, dual frequency, OSNMA. They are limited by what the Cortex-A53 can process in real time and come after the benchmarks of [docs/validation-report.md](docs/validation-report.md) exist.

## License

The contents of this repository are released under the **GNU General Public License v2.0** ([LICENSE](LICENSE)), except where a file states otherwise. The image built from it combines components under several licences, GNSS-SDR and GNU Radio under GPL-3.0 among them; [LICENSES.md](LICENSES.md) lists them and what distributing a built image requires.
