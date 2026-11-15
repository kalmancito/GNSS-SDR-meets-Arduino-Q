# Preparing the build host

The image is built on a **Linux x86-64** machine, inside the container that `kas-container` starts. Nothing but a container runtime, git and Python needs to be installed on the host.

## Requirements

| | Minimum | Why |
|---|---|---|
| CPU architecture | x86-64 | the BSP is built and tested on it |
| Free disk | 120 GB for the build tree, plus the caches | BSP, kernel, GNU Radio, Node.js; `rm_work` is on but peaks are large |
| RAM | 16 GB (32 GB comfortable) | linking GNU Radio, GNSS-SDR and Node.js in parallel |
| Software | Docker or Podman, git, Python 3, curl | |
| Network | GitHub, git.yoctoproject.org, gitlab.com, PyPI, npm registry, SourceForge | sources are fetched once, then cached |

A first build takes hours (it compiles a toolchain, the kernel, GNU Radio and Node.js). Later builds reuse the shared-state cache and take minutes.

With less than 16 GB of RAM, limit parallelism before building:

```bash
export BB_NUMBER_THREADS=4 PARALLEL_MAKE="-j 4"
```

(kas passes these two variables through to BitBake.)

## Check and prepare

```bash
git clone https://github.com/kalmancito/GNSS-SDR-meets-Arduino-Q.git
cd GNSS-SDR-meets-Arduino-Q
scripts/bootstrap-host.sh             # report only
scripts/bootstrap-host.sh --install   # also downloads kas-container 5.5 to ~/.local/bin
```

The script changes nothing on the system except, with `--install`, that one download. For anything else missing it prints what to do. Typical on Debian/Ubuntu:

```bash
sudo apt install docker.io git python3 curl
sudo usermod -aG docker "$USER"    # then log out and in again
```

## Where things go

| Variable | Default | Contents |
|---|---|---|
| `DL_DIR` | `~/yocto-cache/downloads` | every source archive and git mirror; keep it |
| `SSTATE_DIR` | `~/yocto-cache/sstate-cache` | reusable build results; keep it |
| `KAS_WORK_DIR` | the repository | layer checkouts (`meta-qcom/`, `oe-core/`, ...) |
| `KAS_BUILD_DIR` | `build/` in the repository | the build tree; safe to delete |
| `LOG_DIR` | `artifacts/logs/` | one log per script run |

Export any of them before running the scripts to move them, for example to a larger disk. The two caches live outside the repository on purpose: deleting `build/` then costs minutes, not hours.

## Windows

BitBake does not run on Windows. From a Windows machine, either drive a Linux build host over SSH (how this project is developed) or use WSL 2 with an Ubuntu distribution and Docker inside it, on a disk with the space above. Flashing over USB from WSL needs USB pass-through (`usbipd`) and is less reliable than a native Linux host: prefer a real Linux machine for that step.

Keep the working copy's line endings as they are in the repository (`.gitattributes` enforces LF): a recipe or script with CRLF endings fails in confusing ways.

## Tools for the later steps (not needed to build)

| Step | Tools on the host |
|---|---|
| `scripts/validate-image.sh` | `e2fsprogs` (debugfs), `binutils` (readelf), `device-tree-compiler` (dtc); checks that lack a tool are reported as SKIP |
| Flashing | [`qdl`](https://github.com/linux-msm/qdl) 2.x, `usbutils`; Arduino's [`arduino-flasher-cli`](https://github.com/arduino/arduino-flasher-cli) for recovery |
| Sketch | [`arduino-cli`](https://arduino.github.io/arduino-cli/) |
| Web monitor tests | Node.js >= 20, or `docker run --rm -v "$PWD/apps/web-monitor":/app -w /app node:22 sh -c "npm ci && npm test"` |
