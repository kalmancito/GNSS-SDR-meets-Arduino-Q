# GNSS status on the UNO Q LED matrix

The Arduino UNO Q's STM32U585 drives an 8 x 13 LED matrix. This app shows the receiver's status on it: satellites, signal strength, fix state and motion.

![LED matrix](../../images/led_matrix_pvt.jpg)

## How it works

```text
web monitor REST API  -->  Python bridge  -->  arduino-router  --UART-->  STM32 sketch  -->  LED matrix
   /api/latest/*            get_gnss_status()     (RPC router)            Bridge.call()
```

Every 200 ms the sketch calls `get_gnss_status` on the Linux side and gets one short string:

```text
P=2;S=7;A=0.3;H=36.9;V=5.00;C=47.5,44.0,38.2;
```

| Field | Meaning | On the matrix |
|---|---|---|
| `P` | 0 = no position fix, 2 = fix | top-left indicator: blinking / solid |
| `S` | satellites in the fix, or being tracked while there is no fix (0-12) | left column, in binary |
| `A` | age of the last PVT, seconds | blink rate: faster as it gets older |
| `H`, `V` | course over ground (degrees) and horizontal speed (m/s) | the dot in the box moves that way, faster at higher speed |
| `C` | up to 6 C/N0 values, dB-Hz, strongest first | bars: height and brightness |

The string must stay under the 256-byte limit the microcontroller announces to the router; it is about 50 bytes.

"Has a fix" means the same everywhere: RTKLIB solution status other than 0 and at least 4 satellites (`has_fix()` in `gnss_status.py`).

## Files

| Path | |
|---|---|
| `python/gnss_status.py` | pure logic: API answers -> status string. No I/O. |
| `python/gnss_poller.py` | background polling of the web monitor |
| `python/main.py` | entry point for **Arduino App Lab** (factory Debian image) |
| `python/gnss_led_bridge.py` | entry point **without App Lab** (Yocto image): uses Arduino's `arduino-router-bridge` client |
| `python/main_testing.py` | App Lab test generator: animates the matrix without a receiver |
| `python/test_gnss_status.py` | unit tests |
| `sketch/` | the STM32 sketch (`arduino:zephyr:unoq`) |
| `app.yaml` | App Lab app manifest |

## Run the tests

```bash
cd python && python3 -m unittest -v
```

## On the factory image (Arduino App Lab)

Open this directory as an app in App Lab and run it: it uploads the sketch and starts `python/main.py` in a container. The web monitor must be running on the board; the container reaches it at `NODE_BASE_URL` (default `http://172.17.0.1:8080`, the Docker host).

## On the Yocto image

`gnss-led-bridge.service` runs `gnss_led_bridge.py`; `arduino-router.service` provides the link. The sketch is the one already on the microcontroller: its flash is separate from the eMMC and is not touched when the Linux image changes. To change the sketch, build it on a PC with `scripts/build-sketch.sh` and write it from the board with `gnss-mcu-flash` (see [ADR-008](../../docs/decisions/ADR-008-mcu-bridge.md); not yet tested on hardware).

| Variable | Default | |
|---|---|---|
| `NODE_BASE_URL` | `http://127.0.0.1:8080` | web monitor |
| `POLL_HZ` | `2` | polling rate |
| `MAX_BARS` | `6` | C/N0 values sent |
| `ROUTER_ADDRESS` | `unix:///var/run/arduino-router.sock` | router socket |

Licence: MPL-2.0 (see the SPDX header of each file).
