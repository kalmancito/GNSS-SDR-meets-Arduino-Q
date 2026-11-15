# Getting into the board

> Written from the BSP configuration and Arduino's documentation; **not yet tried on hardware with this image.** Correct this page with what actually happens on the first boots.

## Serial console

The one access path that does not depend on the network or on the image being healthy. Set it up **before** flashing, and try it on the factory system first.

| | |
|---|---|
| Connector | JCTL header: pin 4 = board TX, pin 6 = board RX, pin 1 or 7 = GND |
| Level | **1.8 V**. A 3.3 V or 5 V USB-serial adapter will damage the SoC. Use a 1.8 V adapter or a level shifter. |
| Settings | 115200 baud, 8N1, no flow control |
| Device in Linux | `ttyMSM0` |

```bash
picocom -b 115200 /dev/ttyUSB0      # or: screen /dev/ttyUSB0 115200
```

Adapter RX goes to board TX (pin 4), adapter TX to board RX (pin 6).

## Login

| Build | Console | SSH |
|---|---|---|
| `--debug` (bring-up) | `root`, no password | `root`, no password |
| product | no password login | `root` with the key from `local/authorized_keys` |

There is no ADB in this image.

## Network

The board has Wi-Fi. NetworkManager manages it.

**Baked in at build time:** put a profile in `local/wifi.nmconnection` ([local/README.md](../local/README.md)); the board joins that network on first boot.

**By hand, from the serial console:**

```bash
nmcli device wifi list
nmcli device wifi connect "<ssid>" password "<passphrase>"
nmcli -f IP4.ADDRESS device show wlan0
```

Then, from your PC: `ssh root@<address>` and the web monitor at `http://<address>:8080`.

Time is set from the network (systemd-timesyncd). The live receiver sets the GPS week era from the system clock, so a board that has never had network access may report dates in the wrong era until it does.

## USB-C: host mode for the RTL-SDR

The single USB-C port can be a device (towards a PC) or a host (for the dongle). For the receiver it must be a **host**, and the port must supply 5 V to the dongle.

- The simplest arrangement is a **USB-C hub or dock with power delivery**: the hub powers the board and the board is the host for the dongle plugged into the hub.
- If the board is powered through the **5V/VIN pins** instead, the port's 5 V output is not enabled by default. Arduino's documentation describes forcing host mode by connecting `GND` and `VOL_DOWN` on the JCTL header **with the board powered off**. This is not the EDL jumper (`GND`-`USB_BOOT`). Check Arduino's current host-mode guide and the pinout before fitting anything; JCTL signals are 1.8 V.

Check on the board:

```bash
lsusb                          # the dongle: 0bda:2838 or 0bda:2832
systemctl status rtl-tcp       # started by udev when the dongle appears
gnss-diagnose                  # reports dongle, DVB driver, services
```

An RTL-SDR draws up to about 300 mA, an active antenna through the bias tee some tens of mA more. Brown-outs under load look like random USB disconnects in `dmesg`.

## Day-to-day

```bash
systemctl status gnss-sdr gnss-web-monitor rtl-tcp arduino-router gnss-led-bridge
journalctl -u gnss-sdr -f              # receiver log, live
systemctl restart gnss-sdr             # after editing a profile or /etc/default/gnss-sdr
gnss-diagnose                          # health report
```

| What | Where |
|---|---|
| Receiver profiles | `/etc/gnss-sdr/*.conf` |
| Which profile, capture file, `rtl_tcp` options | `/etc/default/gnss-sdr` |
| Web monitor address and ports | `/etc/default/gnss-web-monitor` |
| Receiver outputs (RINEX, NMEA) | `/var/lib/gnss-sdr/output/` |
| Captures to replay | `/var/lib/gnss-sdr/captures/` |
| Receiver's own log files | `/var/log/gnss-sdr/` |

To stop the receiver from starting at boot: `systemctl disable gnss-sdr`. To change what starts: edit `GNSS_SDR_CONFIG` in `/etc/default/gnss-sdr`. No rebuild needed for either.

When the default profile is the live one and no dongle is plugged in, `gnss-sdr.service` ends up *failed* with an explanation in the journal, and is not restarted. That is intended: plug the dongle in and start it from the web monitor or with `systemctl start gnss-sdr`.

## GPIO check for the microcontroller link

To compare with the factory inventory ([ADR-008](decisions/ADR-008-mcu-bridge.md)):

```bash
gpiodetect
gpioinfo | head -n 120
ls -l /dev/ttyHS1
systemctl status arduino-router
```
