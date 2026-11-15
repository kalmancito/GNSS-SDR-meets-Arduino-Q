# ADR-001: Yocto release and BSP revision

Status: accepted, **not yet confirmed by a build**. Date: 2026-11-15.

## Context

The UNO Q is supported by Qualcomm's `meta-qcom-arduino`, on two branches ([research](../research.md#board-support-qualcomm-layers)):

| | `wrynose` | `main` |
|---|---|---|
| Yocto series | 6.0 "wrynose", LTS until April 2030 | 6.1 "blacksail", supported until April 2027 |
| Follows | `meta-qcom` `wrynose` (Qualcomm Linux 2.x) | `meta-qcom` `master` |
| Kernel | `linux-qcom` 6.18.x | `linux-qcom-next` |
| Lockfile published by Qualcomm | yes, plus a release-candidate tag | no |
| meta-openembedded branch | `wrynose` | `master` |

## Decision

Build on **`wrynose`**, with `meta-qcom-arduino` pinned to the tag `qli-2.1.1-arduino-rc1` and every other layer pinned to the commit in Qualcomm's own lockfiles for that tag. The pins are written directly in `kas/uno-q-upstream.yml`; Qualcomm's `ci/*.yml` files are not included, because they name branches, not commits.

## Reasons

- It is the long-term-support line, and the one Qualcomm ships as a product.
- Qualcomm tested this exact combination of commits; any other combination would be ours to debug.
- Every extra layer needed (meta-openembedded, meta-sdr) has a `wrynose`-compatible revision.
- `main` moves with a `-next` kernel and a short-lived Yocto series: wrong base for something that should still build in a year.

## Consequences

- The pinned tag is a release candidate. When a final `qli-2.1.x-arduino` tag exists, move the pins to it (one change in the kas file and in `manifests/revisions.lock`, then rebuild).
- The default kernel is 6.18, while the device tree for this board entered mainline in 7.0; Qualcomm's tree carries it as a backport. If the UART to the microcontroller turns out to be missing, `kas/include/linux-arduino.yml` switches to Arduino's 7.2 kernel ([ADR-008](ADR-008-mcu-bridge.md)).
- `LAYERSERIES_COMPAT` of the product layer is `wrynose` only. Moving to another series means building and testing on it first.

## Verification

Test B01 in the [validation report](../validation-report.md): `scripts/build-base.sh` builds `core-image-base` for `uno-q` from these pins. **NOT RUN.**
