SUMMARY = "GNSS-SDR receiver image for the Arduino UNO Q"
DESCRIPTION = "Headless image: the BSP's base system plus GNSS-SDR, its \
profiles, the web monitor and the link to the STM32 LED matrix. Bootloader, \
firmware, kernel, device tree, Wi-Fi and the A/B boot marking (qbootctl) come \
from the BSP layers unchanged."
LICENSE = "MIT"

inherit core-image

# Same base as the image the BSP is tested with (core-image-base):
# packagegroup-core-boot + packagegroup-base-extended, which bring the machine's
# firmware, kernel modules and qbootctl.
IMAGE_FEATURES += "ssh-server-openssh"
IMAGE_INSTALL:append = " packagegroup-gnss-uno-q"

# ---- access provisioning ---------------------------------------------------
# The product image has no password-less root. Access is configured at build
# time from files kept OUT of version control (the local/ directory is ignored
# by git):
#
#   local/authorized_keys     SSH public keys allowed to log in as root
#   local/wifi.nmconnection   NetworkManager profile for the Wi-Fi network
#
# For bring-up without them, build with kas/include/debug.yml instead.
GNSS_AUTHORIZED_KEYS ?= "${GNSS_UNO_Q_REPO}/local/authorized_keys"
GNSS_WIFI_CONNECTION ?= "${GNSS_UNO_Q_REPO}/local/wifi.nmconnection"

install_gnss_access() {
    if [ -f "${GNSS_AUTHORIZED_KEYS}" ]; then
        install -d -m 0700 ${IMAGE_ROOTFS}${ROOT_HOME}/.ssh
        install -m 0600 ${GNSS_AUTHORIZED_KEYS} ${IMAGE_ROOTFS}${ROOT_HOME}/.ssh/authorized_keys
    fi
    if [ -f "${GNSS_WIFI_CONNECTION}" ]; then
        install -d -m 0755 ${IMAGE_ROOTFS}${sysconfdir}/NetworkManager/system-connections
        install -m 0600 ${GNSS_WIFI_CONNECTION} ${IMAGE_ROOTFS}${sysconfdir}/NetworkManager/system-connections/wifi.nmconnection
    fi
}
ROOTFS_POSTPROCESS_COMMAND += "install_gnss_access"

python () {
    import os

    features = (d.getVar('IMAGE_FEATURES') or '').split() + (d.getVar('EXTRA_IMAGE_FEATURES') or '').split()
    debug_login = 'empty-root-password' in features

    for var in ('GNSS_AUTHORIZED_KEYS', 'GNSS_WIFI_CONNECTION'):
        path = d.getVar(var)
        if path and os.path.isfile(path):
            # Rebuild the root filesystem when the provisioning file changes.
            d.appendVarFlag('do_rootfs', 'file-checksums', ' %s:True' % path)

    keys = d.getVar('GNSS_AUTHORIZED_KEYS')
    if not debug_login and not (keys and os.path.isfile(keys)):
        bb.warn("gnss-uno-q-image: no %s and no debug login: nobody will be able to log in to "
                "this image. Provide the SSH public key, or build with kas/include/debug.yml." % keys)
}
