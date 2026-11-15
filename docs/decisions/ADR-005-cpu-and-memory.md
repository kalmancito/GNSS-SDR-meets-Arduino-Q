# ADR-005: CPU and memory budget

Status: starting point, **to be replaced by measurements** (test P01). Date: 2026-11-15.

## Context

The QRB2210 has four Cortex-A53 cores and the board 2 GB (or 4 GB) of RAM and 16 (or 32) GB of eMMC. The design assumes the small variant. The only measured fact so far is from the original demo on the factory system: GPS L1 C/A, **7 channels, real time, with an RTL-SDR**. Nothing has been measured on the Yocto image.

## Starting values

| Parameter | File profile | Live profile | Why |
|---|---|---|---|
| Sample rate into the receiver | 4 MS/s, resampled to 2 MS/s | 1.2 MS/s | upstream's examples for these two inputs |
| Sample type | 16-bit I/Q | 8-bit I/Q from `rtl_tcp` | the format of each source |
| Channels | 8 | 7 | upstream example / what ran in real time on this board |
| Channels acquiring at once | 1 | 1 | acquisition is the most expensive block |
| Tracking | 1 ms integration, PLL 40 Hz, DLL 4 / 2 Hz | same | upstream examples. The demo used 4 ms; its values are to be taken from the recovered configuration, not guessed. |
| PVT rate | 10 Hz output, 2 Hz on screen | same | upstream example |
| Monitor to the web UI | every 10th observable epoch (5 Hz) | same | the UI needs no more; saves decoding work |

## Compiler and vector code

- Tuning comes from the machine: `cortexa53` (`aarch64 crc`). No `-march=native`, no flags added in the recipe.
- NEON is part of AArch64, so GNU Radio's VOLK and GNSS-SDR's `volk_gnsssdr` build their NEON kernels and choose between kernels at run time. `gnss-benchmark --profile` runs `volk_gnsssdr_profile` once to record the fastest ones; until then generic choices are used.
- The Adreno GPU and the Hexagon DSP are not used. Nothing in GNSS-SDR targets them, and no claim is made that they could help.

## Memory and storage

- `gnss-sdr.service` has `MemoryMax=1200M`: if the receiver leaks or a configuration is too heavy, it is stopped instead of the whole 2 GB system thrashing.
- Debug dumps are off in every profile, and `tests/test-configs.sh` rejects a profile that enables one: a tracking dump fills the eMMC in minutes.
- Only RINEX and NMEA are written by default. Their growth on a long run is not yet measured ([known-issues.md](../known-issues.md)).
- A 100 s test capture is 1.6 GB: it lives on the root filesystem's free space (the filesystem is grown to the partition at boot), not in the image.

## What "real time" will mean here

Linux on this board is not a hard real-time system. The claim to establish is a throughput one: the receiver processes samples faster than they arrive, with margin, without the front-end dropping any. Each profile ends up in one of three states in the validation report: **works in real time**, **works offline only**, or **not tested**.

## How it gets measured

`gnss-benchmark` (from `scripts/benchmark-gnss.sh`) on the board: signal duration / wall-clock time, CPU time, peak memory, temperature before and after, counts of tracking starts, navigation messages and fixes, into a CSV row tagged with image build, GNSS-SDR version, profile and capture checksum. Vary one thing at a time: channels, sample rate, VOLK profile on/off. Then the same capture on an x86-64 PC for comparison (test T06).
