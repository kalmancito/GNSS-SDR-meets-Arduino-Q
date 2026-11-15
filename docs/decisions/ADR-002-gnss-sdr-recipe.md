# ADR-002: How GNSS-SDR is built

Status: accepted, **not yet confirmed by a build**. Date: 2026-11-15.

## Context

Two ways to get GNSS-SDR into the image:

- **A. Use `meta-gnss-sdr`**, the layer maintained by a GNSS-SDR developer.
- **B. Write a recipe in this project's layer.**

What was found ([research](../research.md#gnss-sdr)): `meta-gnss-sdr` has no branch for `wrynose`; its recipe builds a development commit 484 commits older than the current release, allows network access during configuration, and depends at run time on a simulator and an X11 plotting tool; the layer expects Qt, Raspberry Pi, Intel and RISC-V layers to be present.

## Decision

**B.** `meta-gnss-uno-q/recipes-apps/gnss-sdr/gnss-sdr_0.0.22.bb`, written for this project, building the release tag `v0.0.22`.

- Every dependency GNSS-SDR's CMake would otherwise download is provided as a recipe, so nothing is fetched outside `do_fetch`. Two of them have no recipe in this Yocto release and are added to the layer: `armadillo` and `matio` (adapted from `meta-gnss-sdr`, with attribution).
- Options are set explicitly: packaging mode on, tests off, UHD / ZeroMQ / raw UDP / PlutoSDR / FMCOMMS2 off.
- No compiler tuning in the recipe; the machine configuration provides it.
- GNU Radio, VOLK and `rtl-sdr` come from `meta-sdr`, pinned. `meta-sdr` builds unreleased snapshots of GNU Radio's and VOLK's development branches (GNU Radio `3.11.0.0+git` of 2026-11-08, 1235 commits ahead of and 936 behind the last release). Two `bbappend`s in this layer pin them instead to the **releases GNU Radio 3.10.12.0 and VOLK 3.2.0**, the exact versions the receiver ran with in real time on this board (Debian 13 packages, [inventory](../logs/board-inventory-20261115/)). `meta-sdr`'s patches were checked with `git apply --check` against both tags: all apply except one for `gr-qtgui`, which is removed (not built). GNU Radio is built without GNU Radio Companion, ZeroMQ or Qt.
- GNU Radio 4 is a rewrite with a different API, and GNSS-SDR v0.0.22 has no support for it. Porting GNSS-SDR would be a separate project.

`meta-gnss-sdr` is not added as a layer. Declaring it compatible with a series its author has not tested would only hide the question.

## Consequences

- This project maintains the recipe: a new GNSS-SDR release means re-reading its CMake options and regenerating `tests/fixtures/gnss-sdr-<tag>-params.txt`.
- `tests/test-recipe-metadata.sh` fails if the recipe gains `AUTOREV`, a task with network access or `-march=native`.

## Open risks (only a build can settle them)

| Risk | Fallback |
|---|---|
| GNSS-SDR v0.0.22 against `meta-sdr`'s GNU Radio, a snapshot of the development branch | Done before the first build: GNU Radio pinned to `v3.10.12.0` and VOLK to `v3.2.0`, the combination validated on the board. What remains open is whether `meta-sdr`'s recipe, written for the development branch, packages 3.10.12.0 cleanly |
| meta-openembedded's `lapack` needs a Fortran compiler (enabled in the distro configuration) | OpenBLAS |
| The in-tree `volk_gnsssdr` and `cpu_features` with the OE cross toolchain | patch, upstreamed if general |
| `matio` built from git without its test-data submodule | fetch with `gitsm://` as `meta-gnss-sdr` does |

Each one that materialises gets an entry in [known-issues.md](../known-issues.md) with the cause and the fix.

## Verification

Test B03: `scripts/build-gnss-image.sh --recipe gnss-sdr`, then `scripts/validate-image.sh` (AArch64 ELF, no UHD/osmosdr/ZeroMQ linked). **NOT RUN.**
