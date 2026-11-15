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

2. **Back up the board's own partitions** (calibration, the modem/Wi-Fi file system, the MAC addresses):

   ```bash
   scripts/backup-board-partitions.sh arduino@<board>
   ```

   It asks for the board's sudo password once, reads the partitions into the board's RAM (`/tmp` is a tmpfs; nothing is written to the eMMC), copies them to `local/board-backup-<date>/` on the PC with checksums, and deletes the temporary copy. The result contains the board's MAC addresses: keep it private. `flash-guarded.sh --execute` refuses to run without it. Why it matters: [Calibration and identity partitions](#calibration-and-identity-partitions).

3. **Copy off anything else you want to keep** from `/home/arduino` (captures are large; copy them over the network or to a USB drive).

4. **Download the factory image now**, not when you need it. With Arduino's [`arduino-flasher-cli`](https://github.com/arduino/arduino-flasher-cli):

   ```bash
   arduino-flasher-cli list unoq
   arduino-flasher-cli download unoq
   ```

   Note where the file ends up; `flash-guarded.sh --execute` asks for it.

5. **Rehearse the recovery tool** once if you can: at least confirm it starts and sees the board in EDL mode (next section). A recovery path that has never been tried is a hope, not a path.

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

This is a **dry run**. It checks that the directory is an eMMC image for `uno-q`, lists every partition that would be written with its file and size, and prints the command. Read the list. With `--inventory DIR` (or `--backup DIR`) it also shows which of the board's own partitions change place.

When everything above is done and the board is in EDL mode:

```bash
scripts/flash-guarded.sh --execute \
    --recovery-image /path/to/factory-image \
    --inventory docs/logs/board-inventory-<date> \
    --backup local/board-backup-<date>
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

Then check Wi-Fi and Bluetooth, and restore the device partitions if needed (next section).

## Calibration and identity partitions

Facts from the board's inventory (2026-11-15, [partition-offsets.txt](logs/board-inventory-20261115/partition-offsets.txt)) and the pinned layout (qcom-ptool `5da6896f`, `platforms/_common/qrb2210-abl-emmc.yaml`):

- **The MAC addresses are safe.** Arduino keeps `bdaddr` and `wlanaddr` (and a `persist` copy) in the eMMC's hardware boot area `boot0`, and the `CDT` in `boot1`. The Yocto layout only describes the main area and does not write either boot area.
- **Five partitions change place.** The Yocto layout has a larger `hyp` (8 MB instead of 512 KB) and two extra 64 MB `dtb` partitions, so everything after them moves, and nothing is written to them:

  | Partition | Factory start | Yocto start (estimated) | Used by |
  |---|---|---|---|
  | `persist` | 393752 | 686616 | not mounted by the factory Debian |
  | `modemst1`, `modemst2`, `fsg`, `fsc` | 972864 - 985152 | 1266298 - 1278586 | `rmtfs`: the file system of the DSP that runs the Wi-Fi firmware |

  Sectors of 512 bytes. The Yocto column assumes the partitions are packed from the first factory sector, as the factory layout is; `flash-guarded.sh` prints the exact values from the built `rawprogram0.xml`.

- After the flash, the new `modemst*`/`fsg`/`fsc` hold leftovers of the old `efi` partition, and the new `persist` leftovers of `rawdump`/`splash`. The factory contents of those partitions now lie inside the new `rawdump` and `dtb_b`; `dtb_b` is written by the flash, so part of the factory `persist` is overwritten.
- **Restoring the factory image does not put them back**: they are per-board data and the flasher has no copy of yours. Only the backup has it.

What this does to Wi-Fi under Yocto is **not known yet**: the DSP may reinitialise a file system it does not recognise, or Wi-Fi may fail. Decide on the board, after the first boot:

1. If Wi-Fi works, leave the partitions as they are.
2. If it does not, restore the four modem partitions from the backup. Same sizes in both layouts. As root on the Yocto system, **writing to the eMMC, with the owner's go-ahead**:

   ```bash
   systemctl stop rmtfs 2> /dev/null || true
   for p in modemst1 modemst2 fsg fsc; do
       dd if=/root/backup/$p.img of=/dev/disk/by-partlabel/$p bs=64k conv=fsync
   done
   reboot
   ```

   (Copy the images to `/root/backup/` first and check them against `SHA256SUMS`.) Do not use `by-partlabel/persist`: the name exists twice, in the main area and in `boot0`.

After going back to the factory image, the same four files (and `persist.img`, to `/dev/mmcblk0p33` on the factory layout) restore the factory state.

## Checklist

- [ ] Inventory captured and configuration files copied off the board
- [ ] Partition backup taken (`scripts/backup-board-partitions.sh`) and kept private
- [ ] Other data in `/home/arduino` copied
- [ ] Factory image downloaded; recovery tool tried
- [ ] Serial console adapter is **1.8 V** and works on the factory system
- [ ] `scripts/validate-image.sh` passes on the image to flash
- [ ] Dry run read: partitions and sizes look right
- [ ] Stable power, good cable, `ModemManager` stopped
- [ ] Owner's go-ahead
