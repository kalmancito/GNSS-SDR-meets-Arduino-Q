# Test data

No signal recordings are stored in this repository: they are large, and the
one used here carries no explicit licence. This file documents the data the
tests expect and how to obtain it. Downloaded files go in `data/` (ignored by
git).

## GPS L1 C/A capture: `2013_04_04_GNSS_SIGNAL_at_CTTC_SPAIN.dat`

The capture used by the GNSS-SDR project's own "My first position fix"
tutorial. It is what the `gps-l1ca-file` profile is written for.

| Property | Value | Source |
|---|---|---|
| Download | <https://sourceforge.net/projects/gnss-sdr/files/data/2013_04_04_GNSS_SIGNAL_at_CTTC_SPAIN.tar.gz> | GNSS-SDR project |
| Archive | 1 150 716 878 bytes, MD5 `bc21964ad115e4b60c00893411f35c87`, published 2013-04-17 | SourceForge |
| Capture | 1 600 000 000 bytes = 400 000 000 complex samples | size reported by GNSS-SDR |
| Duration | 100 s | tutorial |
| Signal | GPS L1 C/A, real signal recorded with a roof antenna | tutorial |
| Centre frequency | 1575.42 MHz, baseband (IF = 0) | tutorial |
| Sample rate | 4 MS/s | tutorial |
| Sample format | interleaved I/Q, 16-bit signed integers, little endian (`item_type=ishort`) | tutorial, upstream example config |
| Date | 2013-04-04 (`GNSS-SDR.observation_date=2013-04-04`) | file name, tutorial |
| SHA-256 of the `.dat` | **not recorded yet** - printed by `fetch-test-capture.sh`; write it here after the first download | - |
| Reference position | **not recorded yet** - see below | - |
| Licence | **not stated** by the publisher. Use it for testing; do not redistribute it. | SourceForge page |

Get it with:

```bash
tests/fixtures/fetch-test-capture.sh                           # on a PC -> tests/fixtures/data/
tests/fixtures/fetch-test-capture.sh /var/lib/gnss-sdr/captures  # on the board
```

### Reference position

`tests/test-pvt-output.py --reference LAT,LON,HEIGHT` compares the computed
fixes with a known position. No reference is recorded here yet: it has to come
from a source independent of this receiver (surveyed coordinates of the
antenna, or the solution of a trusted receiver on the same recording), not
from a GNSS-SDR run of ours. Until then the *accuracy* stage is reported as
`NOT RUN` - the *pvt* stage still tells whether fixes were obtained.

## Other captures

The original demo replayed two more recordings (`file_GPS_L1_alta_dinamica`,
`cubesat_GPS`). They live on the board, not here. If they are added as
profiles, document each one in this file with the same table: rights, size,
SHA-256, sample rate, centre frequency / IF, sample format and quantisation,
date, duration and reference.

A capture whose format is not known exactly is useless as a test: a wrong
`item_type` or sample rate looks the same as "no signal".

## What is committed

| File | What it is |
|---|---|
| `gnss-sdr-v0.0.22-params.txt` | Every configuration name the pinned GNSS-SDR release reads, extracted from its source by `../gen-gnss-sdr-params.sh`. Reference for `../test-configs.sh`. |
| `fetch-test-capture.sh` | Downloads and verifies the capture above. |
