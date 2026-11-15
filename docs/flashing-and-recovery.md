# Flashing the image, and going back

> **Flashing erases the board.** The Yocto image replaces the partition table. The factory Debian system and everything in `/home/arduino` (receiver configurations, captures, App Lab apps) are gone afterwards. The sketch on the STM32 is not affected.
>
> **This procedure has not been exercised yet** with this image. It is assembled from the BSP's flashing artifacts, `qdl`'s options and Arduino's documentation ([research](research.md#flashing-and-recovery)). Treat the first run as a test, with the recovery image at hand.
>
> Only the board's owner decides to flash, at the moment of flashing.

## Before anything else: the way back

Do these on the factory system, while it still works.

1. **Inventory and configuration files.**

   ```bash
   scripts/capture-board-info.sh arduino@<board>
   ```

   Saves the partition table, kernel, GPIO layout, services and versions to `docs/logs/board-inventory-<date>/`, and copies `~/gnss-sdr/conf/*.conf` off the board.

2. **Copy off anything else you want to keep** from `/home/arduino` (captures are large; copy them over the network or to a USB drive).

3. **Download the factory image now**, not when you need it. With Arduino's [`arduino-flasher-cli`](https://github.com/arduino/arduino-flasher-cli):

   ```bash
   arduino-flasher-cli list unoq
   arduino-flasher-cli download unoq
   ```

   Note where the file ends up; `flash-guarded.sh --execute` asks for it.

4. **Rehearse the recovery tool** once if you can: at least confirm it starts and sees the board in EDL mode (next section). A recovery path that has never been tried is a hope, not a path.

## Entering EDL mode

EDL (Emergency Download) is implemented in the SoC's ROM and does not depend on anything on the eMMC: it stays reachable even if the flashed image does not boot.

1. Unplug the board completely.
2. On the **JCTL** header, connect **`GND`** (pin 1) and **`USB_BOOT`** (pin 2) with a jumper.
3. Connect the board's USB-C port to the PC.
4. Check: `lsusb -d 05c6:9008` must list one device (*Qualcomm ... QDL mode*). In normal mode the board is `2341:0078`.

If the jumper is fitted after power is applied, the board boots normally and the tools wait forever.

JCTL pins, for reference: 1 GND, 2 USB_BOOT, 3 VOL_DOWN, 4 UART TX, 5 VOL_UP, 6 UART RX, 7 GND, 8 PMIC_RESET, 9 +1.8 V out, 10 VBUS_DISABLE. **All signals are 1.8 V.** Do not apply 3.3 V or 5 V to any of them. The jumper for USB host mode (`GND`-`VOL_DOWN`) is a different one; do not confuse the two.

On the PC: `ModemManager` grabs the EDL serial port on many distributions. Stop it for the session (`sudo systemctl stop ModemManager`). `qdl` needs permission for the USB device: run it as root, or add a udev rule for `05c6:9008`.

## Flashing

On a Linux PC with [`qdl`](https://github.com/linux-msm/qdl) 2.x and the build output (or a copy of the `*.qcomflash` directory):

```bash
scripts/flash-guarded.sh
```

This is a **dry run**. It checks that the directory is an eMMC image for `uno-q`, lists every partition that would be written with its file and size, and prints the command. Read the list.

When everything above is done and the board is in EDL mode:

```bash
scripts/flash-guarded.sh --execute \
    --recovery-image /path/to/factory-image \
    --inventory docs/logs/board-inventory-<date>
```

It asks you to type a confirmation phrase, then runs, inside the flash directory:

```bash
qdl --storage emmc --debug prog_firehose_ddr.elf rawprogram0.xml patch0.xml
```

`--storage emmc` is essential: `qdl` assumes UFS storage, and the UNO Q has an eMMC. Do not unplug or power off while it runs. Use a good cable and a port directly on the PC.

## First boot

1. Unplug, **remove the EDL jumper**, connect the [serial console](board-access.md#serial-console).
2. Power the board and watch the console to the login prompt. Save the boot log to `docs/logs/`.
3. Log in (bring-up image: `root`, no password) and run:

   ```bash
   gnss-diagnose
   ```

4. **Reboot at least five times** and check each time that the system comes up and `gnss-diagnose` reports the boot as marked successful. The boot chain has A/B slots: an image that boots once but is never marked good falls back to the other slot later.

## If it does not boot

Do not reflash at random. In order:

1. **Read the serial console.** Where does it stop: no output at all, the bootloader, the kernel, the root filesystem? Save the log.
2. No output at all: check the jumper is removed, the power supply, the console wiring and voltage.
3. Stops in the bootloader or cannot find the kernel: the flash may be incomplete. Re-enter EDL and run the same `flash-guarded.sh --execute` again, once, watching `qdl`'s log for errors.
4. Kernel panics or cannot mount root: a problem in the image. Keep the log, go back to the factory image, fix the image, try again.

## Restoring the factory image

With the board in EDL mode:

```bash
arduino-flasher-cli flash unoq
```

It writes Arduino's Debian image with the factory partition layout. Afterwards remove the jumper and power-cycle. The first boot of the factory image takes a while.

Then compare the Wi-Fi MAC address with the one in your inventory; whether identity and calibration data survive a full Yocto flash and a restore is not verified ([known-issues.md](known-issues.md)).

## Checklist

- [ ] Inventory captured and configuration files copied off the board
- [ ] Other data in `/home/arduino` copied
- [ ] Factory image downloaded; recovery tool tried
- [ ] Serial console adapter is **1.8 V** and works on the factory system
- [ ] `scripts/validate-image.sh` passes on the image to flash
- [ ] Dry run read: partitions and sizes look right
- [ ] Stable power, good cable, `ModemManager` stopped
- [ ] Owner's go-ahead
