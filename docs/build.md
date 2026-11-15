# Building the image

All builds run in the kas container on the [prepared build host](setup-host.md). Every script writes a log to `artifacts/logs/` and stops with a clear message on failure.

> No build has been run from this repository yet. The steps below are the intended procedure; where a step is expected to need iteration, it says so.

## 1. The reference build: the BSP alone

```bash
scripts/build-base.sh
```

Builds `core-image-base` for `MACHINE = "uno-q"` from `kas/uno-q-upstream.yml`: Qualcomm's layers at the commits Qualcomm tested, without anything from this project. If this fails, the cause is in the pins or the host, not in the product layer. Test **B01**.

Output: `build/tmp/deploy/images/uno-q/`.

## 2. Parse the product layer

```bash
scripts/build-gnss-image.sh --parse
```

Runs `bitbake -p` and `bitbake-layers show-layers` with the product manifest: every recipe and `bbappend` of `meta-gnss-uno-q` is parsed against the real layers. Catches syntax errors, missing layers and compatibility mismatches in a few minutes. Test **B02**.

## 3. Pin the Go modules (once)

```bash
scripts/update-go-mods.sh
git add meta-gnss-uno-q/recipes-mcu/arduino-router/*.inc
```

`arduino-router` is written in Go. This generates the list of its module dependencies with checksums, so they are fetched in `do_fetch` like any other source. Needed again only when the router's version changes. Until it is done, `tests/test-recipe-metadata.sh` reports it as PENDING and the `arduino-router` recipe fails to compile.

## 4. GNSS-SDR on its own

```bash
scripts/build-gnss-image.sh --recipe gnss-sdr
scripts/inspect-bitbake.sh gnss-sdr
```

Builds GNU Radio, VOLK, the libraries and GNSS-SDR. This is the step most likely to need work the first time; the known candidates and their fallbacks are in [ADR-002](decisions/ADR-002-gnss-sdr-recipe.md). Record each real problem in [known-issues.md](known-issues.md). Test **B03**.

BitBake runs every task except `do_fetch` without network access, so a successful build is also the proof that GNSS-SDR's CMake downloaded nothing.

`inspect-bitbake.sh` writes `manifests/build-manifest.txt`: the revisions, `DEPENDS`, `PACKAGECONFIG`, `EXTRA_OECMAKE` and `TUNE_FEATURES` BitBake actually used.

## 5. The image

```bash
scripts/build-gnss-image.sh --debug     # bring-up: root without a password
scripts/build-gnss-image.sh             # product: needs local/authorized_keys
scripts/validate-image.sh
```

Test **B04**. Start with `--debug` for the first boots. For the product build, put your SSH public key (and optionally a Wi-Fi profile) in `local/` first: see [local/README.md](../local/README.md).

`validate-image.sh` checks the build output without a board: packages in the image, the `qcomflash` artifacts, that `gnss-sdr` is an AArch64 executable not linked against disabled front-ends, the service and profile files, and the device tree's UART to the microcontroller. A check it cannot perform is reported as `SKIP`, never as passed.

## Variants

| Command | Effect |
|---|---|
| `scripts/build-gnss-image.sh --linux-arduino` | Arduino's 7.2 kernel instead of the BSP's 6.18 ([ADR-008](decisions/ADR-008-mcu-bridge.md)) |
| `scripts/build-gnss-image.sh --recipe <name>` | build one recipe |
| `... -- -c cleansstate` after `--recipe <name>` | pass arguments through to BitBake |
| `PACKAGECONFIG:append:pn-gnss-sdr = " osmosdr"` in a kas `local_conf_header` | add the direct osmosdr source ([ADR-003](decisions/ADR-003-signal-sources.md)) |

## Working inside the build environment

`bitbake` commands only work inside the kas container:

```bash
kas-container shell kas/uno-q-gnss-sdr.yml
# inside:
bitbake-layers show-layers
bitbake-layers show-recipes gnss-sdr
bitbake -e gnss-sdr | grep -E '^(SRCREV|DEPENDS|PACKAGECONFIG|TUNE_FEATURES)='
bitbake -c devshell gnss-sdr
```

## Changing a pinned revision

1. Change the commit in `kas/*.yml` or the recipe, **and** in `manifests/revisions.lock`.
2. `tests/test-recipe-metadata.sh` (it fails if the two disagree).
3. Rebuild, re-run `scripts/validate-image.sh`.
4. Note the reason in [research.md](research.md).

For a new GNSS-SDR release also regenerate the parameter reference and re-check the profiles:

```bash
tests/gen-gnss-sdr-params.sh /path/to/gnss-sdr > tests/fixtures/gnss-sdr-<tag>-params.txt
tests/test-configs.sh
```

## Cleaning

| To redo | Delete |
|---|---|
| one recipe | `scripts/build-gnss-image.sh --recipe <name> -- -c cleansstate`, then build again |
| the whole build, keeping caches | `build/` |
| everything | `build/`, the layer checkouts, `~/yocto-cache/` |
