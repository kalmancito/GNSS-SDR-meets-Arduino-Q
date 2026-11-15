# ADR-008: Link to the STM32 and the LED matrix

Status: accepted; **entirely pending hardware test**. Date: 2026-11-15.

## Context

On the factory image the LED matrix works through Arduino App Lab: a Python app in a container exposes a function, the `arduino-router` daemon carries the microcontroller's calls over a UART, and the sketch draws the answer. The Yocto image has no App Lab and no container runtime.

`arduino/meta-arduino` packages the whole Arduino stack for Yocto, but ([research](../research.md#link-to-the-microcontroller)) its router recipe builds an older version than it claims, its recipes download during compilation, and its machine configuration rebuilds and reflashes a default firmware.

The link is an extra: the receiver must work without it.

## Decision

Package the minimum, in this layer:

| Piece | Recipe | Notes |
|---|---|---|
| Router daemon | `arduino-router` 0.11.0 | Go modules pinned in `SRC_URI` (`gomod://`), generated once with `scripts/update-go-mods.sh`. One systemd unit merging upstream's unit and its UNO Q drop-in (serial port, GPIO lines). |
| Python client | `python3-arduino-router-bridge` 0.5.2 | Arduino's own library, from PyPI. |
| Bridge | `gnss-led-bridge` | `apps/led-matrix/python/gnss_led_bridge.py`: polls the web monitor, registers `get_gnss_status`. Same logic module as the App Lab app. |
| Flashing aid | `gnss-mcu-flash`, `openocd` with `linuxgpiod` | To update the sketch from the board. The sketch binary is built on a PC (`scripts/build-sketch.sh`), not by BitBake. |

`meta-arduino` is not added as a layer.

## Why the sketch is not built by BitBake

`arduino-cli` downloads the Zephyr core, a toolchain and libraries on its own. Allowing that inside a build task would break the rule every other recipe follows. And it is not needed to get the matrix working: **the STM32's flash is separate from the eMMC**, so a board that ran the demo on the factory image keeps its sketch when the Linux image is replaced.

## Isolation from the receiver

- `gnss-sdr.service` and `gnss-web-monitor.service` neither require nor order themselves after the router or the bridge.
- The bridge only reads the web monitor's REST API; if the router or the MCU is absent it retries on its own.
- It runs as a throw-away user (`DynamicUser`) whose only privilege is the router's socket group.

## What has to be confirmed on hardware

1. **The UART exists.** `/dev/ttyHS1` appears only if the kernel's device tree has the `serial1` alias on an enabled port. The BSP's default kernel is 6.18 with backports; the board's device tree entered mainline in 7.0. `scripts/validate-image.sh` inspects the built DTB; if the alias is missing, build with `--linux-arduino`.
2. **The GPIO numbers.** The unit uses `gpiochip1` lines 37, 70 and 38, as upstream does on the factory kernel. Chip numbering can differ between kernels. `capture-board-info.sh` records `gpiodetect`/`gpioinfo` on the factory system for comparison. Line 70 matters most: without it the sketch never leaves the boot animation.
3. **OpenOCD.** Arduino's image uses its own OpenOCD fork; this image uses upstream OpenOCD with the `linuxgpiod` driver and libgpiod 2. Whether that combination builds and reaches the STM32U585 is unknown. Only updating the sketch depends on it.
4. **The sketch's boot mode.** Built with the default "wait for Linux", it needs line 70. `wait_linux_boot=no` removes that dependency if needed.

## Verification

Test M01 in the [validation report](../validation-report.md): the matrix shows satellites, C/N0 bars and fix state while the receiver runs; stopping `gnss-led-bridge` does not disturb the receiver. **NOT RUN.**
