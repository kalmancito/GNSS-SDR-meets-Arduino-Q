# Board inventory: factory system, 2026-11-15

Captured with `scripts/capture-board-info.sh` from the PC, over SSH, read-only, before any change to the board.

| | |
|---|---|
| Board | Arduino UNO Q ("Imola"), QRB2210, **2 GB RAM / 16 GB eMMC** variant |
| System | Debian 13.2 (trixie), kernel 6.16.7 (Arduino build), Arduino App Lab |
| Receiver | GNSS-SDR 0.0.20 built in `~/gnss-sdr`, installed in `/usr/local`; web monitor as `gnss-monitor-web.service` |
| MCU link | `/dev/ttyHS1` present; arduino-router 0.5.4; `/opt/openocd` (Arduino's fork, `e6a2c12f`) |
| GPIO | `gpiochip1` = `500000.pinctrl` (127 lines); 25/26/37/38 outputs |

Each `.txt` file starts with the command that produced it. MAC addresses, serial numbers, the systemd machine id and filesystem UUIDs are masked.

Files added after the scripted capture, same day, read-only:

- `partition-offsets.txt`: first sector and size of every eMMC partition, including the hardware boot areas. Used to work out which partitions move with the Yocto layout ([flashing-and-recovery.md](../../flashing-and-recovery.md#calibration-and-identity-partitions)).

## `gnss-sdr-conf/`

Only the configurations that are **not** part of GNSS-SDR's checkout (`git status` in `~/gnss-sdr`: everything else is unmodified upstream v0.0.20):

- `RealTime_input/all_bands_rtl_realtime.conf` (2025-12-20): the live configuration validated in real time, used by the demo's web monitor. Its GPS L1 C/A values were carried into `meta-gnss-uno-q/.../gps-l1ca-live.conf`.
- `all_bands_rtl_realtime.conf` (2025-12-17): an earlier copy; differs only in `Acquisition_1C.doppler_step=250` and the telecommand port enabled.

Checked against GNSS-SDR v0.0.22, the file uses seven parameter names that version no longer reads, none of them for GPS L1 C/A tracking: `use_CFAR_algorithm`, `doppler_min` (in five acquisition blocks) and a misspelt `early_late_space_chips_narrow`.

The demo's two file-replay configurations (`file_GPS_L1_alta_dinamica.conf`, `cubesat_GPS.conf`) and their captures are **not** on the board.

## Comparison with this repository

- The web monitor in `~/gnss-sdr-webmonitor` is an older version of `apps/web-monitor` (matches commits of 2025-12-20/21 except for line endings). Nothing to recover.
- The LED app in `~/ArduinoApps/gnss-sdr-led` matches `apps/led-matrix` of commit `e7211da`, plus an unused `sketch/clock_frames.h` and `python/main.py.backup`.
