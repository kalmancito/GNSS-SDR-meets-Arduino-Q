# Upstream research

What was read in the upstream repositories before writing this project, and the decision each finding led to. Everything here was read on **2026-11-15** with `git ls-remote` and from the raw files at the commits given; nothing is quoted from memory or from older tutorials. Short commit ids are the first characters of the full ids in [manifests/revisions.lock](../manifests/revisions.lock).

Items that could not be verified are in [the last section](#not-verified).

## Board support: Qualcomm layers

| Repository | Ref read | Commit | Licence |
|---|---|---|---|
| [qualcomm-linux/meta-qcom-arduino](https://github.com/qualcomm-linux/meta-qcom-arduino) | `main` | `4697cfa6` | MIT |
| | `wrynose` | `2760e59c` | |
| | tag `qli-2.1.1-arduino-rc1` (2026-11-12) | `583c6e4b` | |
| [qualcomm-linux/meta-qcom](https://github.com/qualcomm-linux/meta-qcom) | `wrynose` | `207b4983` (head), `a6c92fad` (pinned by the tag above) | MIT |
| [qualcomm-linux/meta-qcom-distro](https://github.com/qualcomm-linux/meta-qcom-distro) | `wrynose` | `bcb485ea` | MIT |
| [openembedded-core](https://github.com/openembedded/openembedded-core) | `wrynose` / `master` | `33a6bd6c` / `f32bced7` | MIT / GPL-2.0 |
| [meta-openembedded](https://github.com/openembedded/meta-openembedded) | `wrynose` | `c0fcd7cc` (head), `c734c2cb` (pinned) | MIT |

Findings:

- **`MACHINE = "uno-q"` is defined only in `meta-qcom-arduino`** (`conf/machine/uno-q.conf`), not in `meta-qcom`.
- **Two lines of development.** `main` declares `LAYERSERIES_COMPAT = "blacksail"` (Yocto 6.1) and follows `meta-qcom` `master` with the `linux-qcom-next` kernel. `wrynose` declares `"wrynose"`: Yocto 6.0, the LTS release supported until April 2030, used by Qualcomm Linux 2.x. OE-Core `master` is already the `blacksail` series.
- **Qualcomm publishes a lockfile** for the `wrynose` branch (`ci/base.lock.yml`), and the tag message of `qli-2.1.1-arduino-rc1` repeats the pins. The lock of `meta-qcom` at `a6c92fad` pins OE-Core, BitBake 2.18, meta-lts-mixins and meta-openembedded.
- **`meta-qcom` on `wrynose` depends on `lts-linux-firmware-mixin`**: `meta-lts-mixins` (branch `wrynose/linux-firmware`) is required, with one patch that `meta-qcom` carries and applies through kas. (At the pinned commit it is one patch; the branch head has three.)
- **Machine facts** (`uno-q.conf` and the includes it pulls from `meta-qcom`): tune `cortexa53` (`TUNE_FEATURES = "aarch64 crc cortexa53"`), kernel `linux-qcom` 6.18.x by default, device tree `qcom/qrb2210-arduino-imola.dtb`, serial console `115200;ttyMSM0`, `IMAGE_FSTYPES` including `ext4` and `qcomflash`, U-Boot (`u-boot-arduino`) packed as `boot.img`, systemd-boot with a unified kernel image on the ESP, `root=PARTLABEL=rootfs`.
- **A/B boot.** `qbootctl` is in `MACHINE_ESSENTIAL_EXTRA_RRECOMMENDS`, with the comment that the boot firmware switches to slot B and fails to boot unless the boot is marked successful. Its recipe installs `qbootctl-bless-boot.service`.
- **The BSP's CI builds `core-image-base` with `distro: nodistro`**, kas file format `version: 14`, kas 5.5. OE-Core `wrynose` sets `INIT_MANAGER ??= "systemd"`, so that image is systemd-based. The CI's local.conf fragment enables password-less root.
- **`qcom-distro`** (the optional `ci/qcom-distro.yml`) adds meta-qcom-distro, meta-virtualization, meta-selinux, meta-updater, meta-security, meta-ai, meta-audioreach and GNOME/XFCE layers of meta-openembedded.
- **An alternative kernel exists**: `linux-arduino` 7.2.x (`ci/linux-arduino.yml`).

Decisions: [ADR-001](decisions/ADR-001-yocto-release.md) (wrynose, pinned to the tag), [ADR-004](decisions/ADR-004-user-space.md) (own minimal distro instead of `qcom-distro`).

## GNSS-SDR

| Repository | Ref read | Commit | Licence |
|---|---|---|---|
| [gnss-sdr/gnss-sdr](https://github.com/gnss-sdr/gnss-sdr) | tag `v0.0.22` (2026-10-04) = `main` | `3fcb502a` | GPL-3.0-or-later |
| | `next` | `a3ad179b` | |
| [carlesfernandez/meta-gnss-sdr](https://github.com/carlesfernandez/meta-gnss-sdr) | `whinlatter` (newest release branch) | `f8528308` | MIT |
| | `master` | `8cff1071` | |
| [balister/meta-sdr](https://github.com/balister/meta-sdr) | `master` (2026-11-14) | `69285532` | no licence file at the top level (not verified) |

Findings about `meta-gnss-sdr`:

- **There is no `wrynose` branch.** The newest is `whinlatter` (Yocto 5.3, end of life), with `LAYERSERIES_COMPAT = "whinlatter"`; `master` says `"master whinlatter"` and its README warns against using it.
- Its `gnss-sdr` recipe pins a commit of `next` that is 484 commits behind `v0.0.22`, sets `do_configure[network] = "1"`, and has `RDEPENDS` on `gnss-simulator` and `gnuplot-x11`.
- Its layer template expects meta-qt5, meta-arm, meta-raspberrypi, meta-intel and meta-riscv among others.
- It provides recipes that exist nowhere else for this release: `armadillo`, `matio`.

Findings about GNSS-SDR `v0.0.22` (`CMakeLists.txt` and `src/` at the tag):

- Options that are **ON by default**: `ENABLE_UHD`, `ENABLE_ZMQ`, `ENABLE_UNIT_TESTING`, `ENABLE_LOG`. `ENABLE_OSMOSDR` is OFF. `ENABLE_RAW_UDP` turns itself on when libpcap is found.
- **`File_Signal_Source` and `RtlTcp_Signal_Source` are always compiled.** `Osmosdr_Signal_Source` needs `ENABLE_OSMOSDR` and gr-osmosdr.
- CMake **downloads and builds** Armadillo, Matio, PugiXML, Protobuf, gflags/glog and GoogleTest when it does not find them, and test data at configure time when the tests are enabled. `ENABLE_PACKAGING=ON` disables the test-data download and the stripping.
- Required packages: GNU Radio (runtime, pmt, blocks, fft, filter, analog), VOLK, Boost, Armadillo with BLAS/LAPACK, Matio (HDF5, zlib), PugiXML, Protobuf (a host `protoc` when cross-compiling), Abseil >= 20240116, Python 3 with Mako on the build host.
- `volk_gnsssdr` is built in-tree and installs `volk_gnsssdr_profile`.
- There is **no `-march=native`** in the top-level CMake file.
- The receiver installs handlers for `SIGINT`, `SIGTERM` and `SIGHUP` that stop the flowgraph (`src/core/receiver/control_thread.cc`). Command-line flags include `--config_file`, `--signal_source`, `--log_dir`.
- **The example configurations contain parameters the code no longer reads.** In `gnss-sdr_GPS_L1_ishort.conf`: `ControlThread.wait_for_flowgraph`. In `gnss-sdr_GPS_L1_rtl_tcp_realtime.conf`: `SignalSource.swap_iq` (the code reads `flip_iq`) and `Acquisition_1C.doppler_min`. Found by `tests/test-configs.sh`, which compares names with the source.
- The protobuf definitions (`docs/protobuf/`) gained fields since the copies this repository had (cycle-slip flags; a per-satellite list with azimuth and elevation in `MonitorPvt`). The copies in `apps/web-monitor/protos/` are now those of the tag.

Findings about the dependencies in the pinned layers:

- GNU Radio, VOLK, `rtl-sdr` 2.0.3 and gr-osmosdr come only from `meta-sdr`. It has no `wrynose` branch, but its `master` declares `LAYERSERIES_COMPAT = "blacksail wrynose whinlatter"` and depends on `core meta-python openembedded-layer networking-layer filesystems-layer`.
- `meta-sdr`'s GNU Radio is a snapshot of GNU Radio's `main` branch (`PV = "3.11.0.0+git"`), with `PACKAGECONFIG ??= "grc zeromq"`. GNU Radio released `v3.10.12.0` (`ec7a3239`) on 2025-02-20.
- **The demo's versions (board inventory):** GNSS-SDR 0.0.20 ran in real time with GNU Radio 3.10.12.0 and VOLK 3.2.0 (Debian 13 packages). These are now the pinned versions ([ADR-002](decisions/ADR-002-gnss-sdr-recipe.md)). GNU Radio 3.10.12.0 is tag `ec7a3239` on branch `maint-3.10`. GNU Radio 4 (`gnuradio4`) uses a different API; GNSS-SDR has no support for it.
- **Found by parsing (2026-11-15):** despite declaring `wrynose`, `meta-sdr` `master` is developed against the next OE-Core series. Two of its GNU Radio 4 recipes write `LICENSE` as SPDX expressions (`AND`), which wrynose's BitBake rejects, so the whole parse fails. They are masked ([known-issues.md](known-issues.md), B9).
- The BSP's kernel at the pinned `meta-qcom` is fixed: `linux-qcom_6.18.bb` has `SRCREV 4b7f69a1` (tag `qcom-6.18.y-20261102`, 6.18.52) with `nobranch=1`. Only its `devupstream` and `-next` variants follow a branch, and BitBake warns about them while parsing.
- In meta-openembedded `wrynose`: abseil-cpp 20260107.1, protobuf 6.33.6, pugixml, hdf5 2.0.0, lapack 3.12.1, fftw, nodejs 22.23.4, openocd 0.12+git, libgpiod 2.2.4, polkit 127, networkmanager 1.56.0, python3-msgpack 1.1.2. In OE-Core: boost 1.90.0, Go 1.26.9, `go-mod` and `go-mod-update-modules` classes, `npm` class.
- **No recipe for `armadillo`** in OE-Core or meta-openembedded; `matio` only in meta-ros2.

Decisions: [ADR-002](decisions/ADR-002-gnss-sdr-recipe.md) (own recipe), [ADR-003](decisions/ADR-003-signal-sources.md) (file first, live through `rtl_tcp`), [ADR-005](decisions/ADR-005-cpu-and-memory.md).

## Link to the microcontroller

| Repository | Ref read | Commit | Licence |
|---|---|---|---|
| [arduino/arduino-router](https://github.com/arduino/arduino-router) | tag `v0.11.0` | `cb7b2cec` | GPL-3.0-or-later |
| [arduino/arduino-router-bridge-py](https://github.com/arduino/arduino-router-bridge-py) | tag `v0.5.2` | `433e3032` | MPL-2.0 |
| [arduino/ArduinoCore-zephyr](https://github.com/arduino/ArduinoCore-zephyr) | tag `1.1.0` | `f07865dd` | Apache-2.0 |
| [arduino-libraries/Arduino_RouterBridge](https://github.com/arduino-libraries/Arduino_RouterBridge) | 0.4.4 | `dc170bd5` | MPL-2.0 |
| [arduino/meta-arduino](https://github.com/arduino/meta-arduino) | `wrynose` | `6cc3e503` | MIT |

Findings:

- `arduino-router` is a Go program (needs Go >= 1.25.2): MessagePack-RPC between a Unix socket (`/var/run/arduino-router.sock`) and the microcontroller's serial link. On the UNO Q its service runs with `--serial-port /dev/ttyHS1 --serial-baudrate 115200`.
- **The service also drives GPIO lines**: `gpioset -c /dev/gpiochip1 -t0 37=0` before starting and `70=1` once the router is ready. The microcontroller's loader waits for Linux by default (it keeps playing the boot animation); line 70 is what lets the sketch start.
- A client registers a method with the request `$/register`. Arduino's Python client, `arduino-router-bridge` (PyPI, pure Python, depends only on `msgpack`), does this without Arduino App Lab.
- The microcontroller limits each RPC message to 256 bytes.
- **The STM32's flash is independent of the eMMC**: replacing the Linux image does not touch the sketch.
- The Linux processor is the STM32's debug probe: SWD bit-banged with OpenOCD's `linuxgpiod` driver (`swclk 26`, `swdio 25`, `srst 38`, chip 1). The sketch is written at `0x08100000` (core 1.1.0) next to a "loader" firmware of the same core version.
- `meta-arduino` already has recipes for all of this, but: its `arduino-router` recipe is named 0.11.0 and builds the v0.9.0 commit; it sets `do_compile[network] = "1"`; its machine `imola` rebuilds and reflashes a default firmware with core 0.55.0, also with network access; its flash helper writes the sketch at `0x080F0000`, which does not match core 1.1.0.
- The upstream device tree `qrb2210-arduino-imola.dts` (alias `serial1 = &uart2`, which becomes `/dev/ttyHS1`) entered mainline Linux in v7.0.

Decision: [ADR-008](decisions/ADR-008-mcu-bridge.md).

## Flashing and recovery

Sources: `meta-qcom` `classes-recipe/image_types_qcom.bbclass` and `docs/flashing.md`; [qcom-ptool](https://github.com/qualcomm-linux/qcom-ptool) `platforms/qrb2210-unoq-abl`; [linux-msm/qdl](https://github.com/linux-msm/qdl) v2.9.1; [arduino/arduino-flasher-cli](https://github.com/arduino/arduino-flasher-cli) v0.5.4; Arduino's documentation sources ([arduino/docs-content](https://github.com/arduino/docs-content)).

- The build writes `<image>-uno-q.qcomflash/` with `rawprogram*.xml`, `patch*.xml`, `contents.xml`, `prog_firehose_ddr.elf`, the boot firmware, `boot.img`, `efi.bin`, `rootfs.img`.
- **`qdl` assumes UFS storage by default; the UNO Q has an eMMC.** The command is `qdl --storage emmc --debug prog_firehose_ddr.elf rawprogram0.xml patch0.xml`. `meta-qcom`'s `docs/flashing.md` only covers the RB3 Gen 2 and does not pass `--storage`.
- The Yocto partition layout (`qrb2210-unoq-abl/emmc`) has A/B pairs for the boot chain, a 512 MB `efi` partition and `rootfs` as the last, growing partition. **It has no `userdata` partition**: the factory `/home/arduino` does not survive.
- EDL mode: with the board unplugged, short `GND` and `USB_BOOT` on the JCTL header, then connect USB-C; the board enumerates as `05c6:9008` (normally `2341:0078`).
- Forcing USB host mode is a different jumper: `GND` and `VOL_DOWN`.
- The serial console is on JCTL (pins 4 TX, 6 RX), **1.8 V logic**, 115200 baud.
- Factory restore: `arduino-flasher-cli flash unoq`.

Decision: [ADR-006](decisions/ADR-006-installation.md). Procedure: [flashing-and-recovery.md](flashing-and-recovery.md).

## Other sources consulted

- [kas documentation](https://kas.readthedocs.io/): lockfiles apply to included files; a repository entry without `url` is the repository containing the kas file.
- [GNSS-SDR cross-compiling tutorial](https://gnss-sdr.org/docs/tutorials/cross-compiling/): last updated in 2023, describes ARM32 SDKs up to Yocto "gatesgarth" and a `repo`-based manifest. Not followed.
- [GNSS-SDR "My first position fix"](https://gnss-sdr.org/my-first-fix/): source of the test capture's description ([tests/fixtures/README.md](../tests/fixtures/README.md)).
- [Yocto releases](https://wiki.yoctoproject.org/wiki/Releases): Wrynose 6.0, April 2026, LTS until April 2030.

## Not verified

Recorded so that nobody mistakes an assumption for a fact:

- Whether the boot firmware archive that `meta-qcom-arduino` downloads actually contains `prog_firehose_ddr.elf` (inferred from `contents.xml.in` and from Arduino's flasher; the archive was not downloaded).
- The boot hand-off ABL -> U-Boot -> systemd-boot is inferred from the recipes.
- Whether `linux-qcom` 6.18 at the pinned commit carries the UNO Q device tree with `uart2` enabled. The file name is referenced by the machine configuration, so it must exist; its content was not read. `scripts/validate-image.sh` checks the built DTB.
- Which `/dev/gpiochipN` the SoC's pin controller is under the **Yocto** kernel. On the factory kernel (6.16) it was checked on 2026-11-15: `gpiochip1` = `500000.pinctrl` (127 lines), lines 25/26/37/38 configured as outputs, and the factory router unit drives 37 and 70 ([inventory](logs/board-inventory-20261115/gpio.txt)).
- Whether upstream OpenOCD (0.12+git in meta-openembedded) drives the STM32U585 through `linuxgpiod` with libgpiod 2.x. Arduino's image uses its own OpenOCD fork.
- Whether GNSS-SDR v0.0.22 builds against the GNU Radio `main` snapshot of `meta-sdr`.
- The licence of the test capture on SourceForge.
- The list of licences of the web monitor's npm dependency tree (see [LICENSES.md](../LICENSES.md)).
