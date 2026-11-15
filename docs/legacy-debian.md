# The original demo: GNSS-SDR on the factory Debian image

This is how the project started and what has been **validated on hardware**: GNSS-SDR built by hand on the Arduino UNO Q's factory Debian system, running in real time with an RTL-SDR, a Node.js web monitor and the LED matrix. The Yocto image in this repository packages the same pieces reproducibly; this page documents the original setup, which still works with the code in `apps/`.

A working video: <https://youtu.be/a7ZrCYMQSxc>

## Hardware

- **Arduino UNO Q**: Qualcomm QRB2210 running Linux (Debian), and an STM32U585 microcontroller driving the 8 x 13 LED matrix.
- **RTL-SDR front-end**: Nooelec NESDR SMArTee.
- **Active GNSS antenna**, powered by the dongle's bias tee.

![Arduino UNO Q setup](../images/arduino_uno_q_setup.jpg)

## Architecture

![System architecture](../images/system_architecture.svg)

- **GNSS-SDR** on Linux, processing live RF samples.
- **Node.js web server** ([apps/web-monitor](../apps/web-monitor)): decodes GNSS-SDR's monitor streams, serves the UI, starts and stops the receiver.
- **Python bridge** ([apps/led-matrix/python/main.py](../apps/led-matrix/python/main.py)), an Arduino App Lab app: polls the web server and answers the microcontroller.
- **STM32U585 sketch** ([apps/led-matrix/sketch](../apps/led-matrix/sketch)): draws the status on the LED matrix.

## Receiver configuration (as validated)

| | |
|---|---|
| Constellation / signal | GPS L1 C/A |
| Tracking channels | 7 |
| Coherent integration time | 4 ms |
| Front-end | RTL-SDR, live |
| Outputs | Observables, C/N0, PVT |

Galileo was not enabled: the platform's CPU and memory did not allow it in real time.

The configuration files used (`all_bands_rtl_realtime.conf`, `file_GPS_L1_alta_dinamica.conf`, `cubesat_GPS.conf`) were never part of this repository; they live in `~/gnss-sdr/conf` on the board. `scripts/capture-board-info.sh` copies them out. **Do that before flashing the Yocto image: flashing erases them.**

## Running it on Debian

GNSS-SDR and GNU Radio are installed on the board following the GNSS-SDR project's own [build instructions](https://gnss-sdr.org/build-and-install/).

Web monitor:

```bash
cd apps/web-monitor
npm ci
GNSS_SDR_HOME=/home/arduino/gnss-sdr UDP_HOST=127.0.0.1 npm start
```

The server lists every `*.conf` under `$GNSS_SDR_HOME/conf` (default `~/gnss-sdr/conf`, or `GNSS_CONF_DIR`) and offers one start button per file. Open `http://<board>:8080`.

![Web interface](../images/web_interface.png)

LED matrix: open [apps/led-matrix](../apps/led-matrix) as an app in Arduino App Lab and run it. It uploads the sketch to the microcontroller and starts `python/main.py` in a container, which reaches the web monitor through the Docker host gateway (`NODE_BASE_URL`, default `http://172.17.0.1:8080`). `python/main_testing.py` drives the matrix with synthetic data, without a receiver.

## What the LED matrix shows

![LED matrix C/N0](../images/led_matrix_cn0.jpg)

<img src="../images/led_matrix_pvt.jpg" alt="LED matrix PVT" width="300">

- **Left column:** number of satellites, in binary (4 bits, least significant at the bottom).
- **Top-left indicator:** blinks while there is no position fix, solid when there is one. The blink rate rises as the last fix gets older.
- **Bars:** C/N0 of the six strongest satellites; height and brightness grow with signal strength.
- **Box on the right:** a dot that moves in the direction of travel, faster at higher speed, and rests in the centre when stationary.

## Differences from the Yocto image

| | Debian demo | Yocto image |
|---|---|---|
| GNSS-SDR | built by hand on the board | cross-compiled by BitBake, pinned to v0.0.22 |
| Receiver process | child of the web server | `gnss-sdr.service`; the web server asks systemd |
| RTL-SDR | as configured in the `.conf` | `rtl_tcp` on loopback + `RtlTcp_Signal_Source` |
| LED bridge | Arduino App Lab container | `gnss-led-bridge.service`, talks to `arduino-router` directly |
| Browser libraries | CDN | served by the board |
