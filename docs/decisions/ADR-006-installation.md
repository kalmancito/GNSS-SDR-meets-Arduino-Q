# ADR-006: Installing the image and getting back

Status: accepted, **procedure not yet exercised on a board**. Date: 2026-11-15.

## Context

Installing the Yocto image means rewriting the eMMC through Qualcomm's Emergency Download mode with `qdl`. It replaces the partition table: the factory Debian system and the user's data are destroyed. A mistake can leave a board that does not boot.

Facts ([research](../research.md#flashing-and-recovery)): the BSP produces a complete `qcomflash` directory; `qdl` must be told the storage is eMMC; the new layout has no `userdata` partition; Arduino publishes a tool that restores the factory image through the same EDL mode.

## Decision

1. **Use the BSP's own flashing artifacts and `qdl`**, with `--storage emmc`. No hand-made partition images, and never files built for another Qualcomm board.
2. **Full flash, as the BSP defines it.** The option of rewriting only `efi` and `rootfs` and keeping the factory boot firmware (described in some third-party guides) is not used: the two partition layouts differ, and mixing them is exactly the untested combination to avoid.
3. **No flash without a proven way back.** Recovery is Arduino's `arduino-flasher-cli` with the factory image **downloaded beforehand**. EDL mode is entered with a hardware jumper and does not depend on anything stored on the eMMC, so it stays available even if the new image does not boot.
4. **`scripts/flash-guarded.sh` is the only entry point.** It is a dry run unless `--execute` is given, lists every partition it would write, refuses images that are not for `uno-q`/eMMC, and for a real write demands: the device in EDL mode, the recovery image on disk, the board inventory, and a typed confirmation.
5. **Inventory first.** `scripts/capture-board-info.sh` records the factory system (partitions and their offsets, kernel, GPIO, services, versions) and copies the GNSS-SDR configuration files off the board.
6. **Back up the device-specific partitions.** See below.

## What is not preserved

The whole main eMMC area. Specifically `/home/arduino`: receiver configurations, captures, Arduino App Lab apps.

Measured on the board on 2026-11-15 ([details](../flashing-and-recovery.md#calibration-and-identity-partitions)):

- **Kept:** the eMMC hardware boot areas, where Arduino stores the Bluetooth and Wi-Fi MAC addresses (`bdaddr`, `wlanaddr`), a `persist` copy and the `CDT`. The Yocto layout does not write them. Also kept: the STM32's own flash (the sketch).
- **Moved, therefore lost in place:** `persist`, `modemst1`, `modemst2`, `fsg`, `fsc` (the DSP file system served by `rmtfs`). The Yocto layout puts them at other offsets and writes nothing into them; restoring the factory image does not recreate their content.

Hence decision 6: **a partition backup is mandatory before flashing** (`scripts/backup-board-partitions.sh`; `flash-guarded.sh --execute` checks it). It reads the partitions as root into RAM and copies them off the board; nothing is written to the eMMC. Restoring them is a separate, deliberate write, documented step by step.

## Boot slots

The layout has A/B copies of the boot chain. The BSP installs `qbootctl` and a service that marks the boot as successful; without it the firmware would switch slots after a few boots. The image keeps both, `scripts/validate-image.sh` checks the package is there, and test H02 (five or more reboots) checks it works.

## Authorisation

Flashing is done only by, or with the explicit go-ahead of, the board's owner, at the moment of flashing. Nothing in this repository flashes anything by default.

## Verification

R01 (restore the factory image following [flashing-and-recovery.md](../flashing-and-recovery.md)), H01, H02. **NOT RUN.**
