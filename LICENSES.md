# Licences

This file summarises the licences involved. It is an engineering overview, not legal advice; the authoritative texts are the licence files of each component. See also [docs/decisions/ADR-007-licences.md](docs/decisions/ADR-007-licences.md).

## This repository

| Path | Licence | Basis |
|---|---|---|
| Everything not listed below | GPL-2.0-only | [LICENSE](LICENSE) |
| `apps/led-matrix/python/`, `apps/led-matrix/sketch/` | MPL-2.0 | SPDX header in each file |
| `apps/web-monitor/protos/*.proto` | BSD-3-Clause | SPDX header; copied verbatim from GNSS-SDR v0.0.22 `docs/protobuf/` |
| `meta-gnss-uno-q/recipes-apps/gnss-config/files/*.conf` | GPL-3.0-or-later | Derived from GNSS-SDR's example configurations |
| `tests/fixtures/gnss-sdr-v0.0.22-params.txt` | - | A list of identifiers extracted from the GNSS-SDR source (facts, no expression copied) |

The recipes for `armadillo` and `matio` are adapted from [meta-gnss-sdr](https://github.com/carlesfernandez/meta-gnss-sdr) (MIT); each says so in its header.

## What ends up in the image

Main components and their licences as declared upstream at the pinned revisions:

| Component | Licence |
|---|---|
| GNSS-SDR 0.0.22 (includes volk_gnsssdr) | GPL-3.0-or-later |
| GNU Radio | GPL-3.0 |
| VOLK | LGPL-3.0-or-later |
| rtl-sdr | GPL-2.0-only |
| Armadillo | Apache-2.0 |
| Matio | BSD-2-Clause |
| arduino-router | GPL-3.0-or-later |
| arduino-router-bridge (Python) | MPL-2.0 |
| Web monitor (this repository) | GPL-2.0-only |
| Its npm dependencies | MIT, BSD-3-Clause (protobufjs), BSD-2-Clause (Leaflet), Apache-2.0 (long), ISC |
| Linux kernel | GPL-2.0-only |
| Qualcomm boot firmware and device firmware | Proprietary (`LICENSE.qcom` and linux-firmware terms); **not** free software |

The complete, exact list for a given build is produced by the build itself:

- `build/tmp/deploy/licenses/` - licence manifest of the image and the licence text of every package;
- SPDX SBOM documents (`INHERIT += "create-spdx"` is set in the distro configuration);
- the licence texts are also installed in the image under `/usr/share/common-licenses/`.

**Not verified yet:** the npm licence list above was written from knowledge of those packages, not read from a build's licence manifest, because no build has run. Check it against `build/tmp/deploy/licenses/` after the first build.

## If you distribute a built image

Keeping the image for your own boards creates no obligations. Giving it to someone else does:

1. **GPL/LGPL components** (GNSS-SDR, GNU Radio, VOLK, rtl-sdr, arduino-router, the kernel, most of the base system): provide the corresponding source, or a written offer for it. This repository plus the pinned revisions in [manifests/revisions.lock](manifests/revisions.lock) identify that source exactly; BitBake can also archive it (`INHERIT += "archiver"`).
2. **GPL-3.0 components** additionally require that the recipient can install modified versions on the device. The image is not locked down (no secure boot enforcement is added by this project), so this is satisfied as long as it stays that way.
3. **Qualcomm firmware**: the boot firmware is fetched from Arduino's servers under `LICENSE.qcom`, and the Wi-Fi/Bluetooth/GPU firmware under the linux-firmware terms. Read those terms before publishing an image that contains them; redistribution rights are narrower than for free software. Publishing the *recipes* (this repository) is not affected.
4. Keep the copyright notices and licence texts; they are already inside the image.

The web monitor (GPL-2.0-only) and GNSS-SDR (GPL-3.0-or-later) are separate programs that talk over UDP: shipping them in one image is aggregation, not a combined work.

The test capture referenced in [tests/fixtures/README.md](tests/fixtures/README.md) has no stated licence and is not redistributed.
