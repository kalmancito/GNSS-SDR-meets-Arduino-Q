# ADR-004: Distribution and user space

Status: accepted, **not yet confirmed by a build**. Date: 2026-11-15.

## Context

The BSP can be built with `nodistro` (what its CI does for `core-image-base`) or with Qualcomm's `qcom-distro`, which adds about ten layers: virtualization, SELinux, OTA updates, security, AI, audio, GNOME and XFCE. The receiver is a headless appliance.

## Decision

A small distribution of our own, `meta-gnss-uno-q/conf/distro/gnss-uno-q.conf`, on top of OE-Core's defaults:

| Aspect | Choice |
|---|---|
| Init | systemd |
| Distro features | OE-Core defaults + `efi pam pni-names` (as the BSP's CI) + `polkit`; minus `x11 wayland opengl vulkan 3g nfc pcmcia` |
| Image base | `core-image` with `packagegroup-core-boot` and `packagegroup-base-extended`, the same as the BSP-tested `core-image-base` |
| Network | NetworkManager (`nmcli`); systemd-networkd is not built, so there is one network manager |
| Remote access | OpenSSH, root by public key only |
| Local access | serial console (1.8 V); ADB is **not** provided |
| Logs | journald |
| Root filesystem | ext4, grown to the partition at boot (`gnss-resize-rootfs`) |
| Licence material | SPDX SBOM per build; licence texts shipped in the image |

Bootloader, kernel, device tree, firmware, Wi-Fi and `qbootctl` come from the BSP untouched.

## Access and security

- **Product build:** no password-less accounts. The SSH public key and, optionally, a Wi-Fi profile are taken at build time from `local/`, which is never committed. Without a key the build warns that the image cannot be logged in to.
- **Bring-up build** (`kas/include/debug.yml`): root without a password on console and SSH, exactly as the BSP's CI images. For a bench, not for a network.
- Services run as dedicated unprivileged users with systemd sandboxing. The web monitor controls only `gnss-sdr.service`, through one polkit rule.
- The receiver's data streams (monitor UDP, `rtl_tcp`) are bound to loopback.
- **The web UI has no authentication** and listens on all interfaces by default: whoever reaches port 8080 can start and stop the receiver. Acceptable on a lab network; on anything else set `HTTP_HOST=127.0.0.1` in `/etc/default/gnss-web-monitor` and use an SSH tunnel. Listed in [known-issues.md](../known-issues.md).

## Consequences

- Features that `qcom-distro` would give (containers, OTA, SELinux) are absent. Add them deliberately if a need appears.
- Without ADB, losing both network and SSH key means using the serial console. [board-access.md](../board-access.md) covers it.

## Verification

B04 (image builds), H01 (boots), H02 (stays bootable across reboots), O01 (services). **NOT RUN.**
