# Evidence

Trimmed logs and captures that back the results in [../validation-report.md](../validation-report.md). Nothing is here yet: no build or hardware test has been run.

What goes here, one directory per event:

| Directory | Produced by |
|---|---|
| `board-inventory-<date>/` | `scripts/capture-board-info.sh` (factory system, before flashing) |
| `build-<date>/` | the relevant part of `artifacts/logs/*.log`, `manifests/build-manifest.txt`, `manifests/artifacts.sha256` |
| `boot-<date>/` | serial console log of a boot; `gnss-diagnose` output |
| `receiver-<date>/` | receiver output, `tests/test-pvt-output.py` report and CSV, the profile used |
| `benchmark-<date>/` | `benchmark.csv` and the run directories of `gnss-benchmark` |

Rules:

- Keep the exact command and the date (UTC) with every log.
- Trim, do not edit: cut long logs to the relevant part and say so.
- No secrets: Wi-Fi passphrases, SSH keys, serial numbers and MAC addresses do not belong in a public repository. `capture-board-info.sh` masks the last two by default.
- No signal recordings (see [../../tests/fixtures/README.md](../../tests/fixtures/README.md)).
