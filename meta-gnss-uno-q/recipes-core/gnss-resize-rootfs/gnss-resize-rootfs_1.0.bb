SUMMARY = "Grow the root filesystem to fill its eMMC partition"
DESCRIPTION = "The image's ext4 filesystem is only as large as its contents \
plus a margin, while the rootfs partition takes the rest of the eMMC. This \
service grows the filesystem at boot so there is room for I/Q captures and \
receiver outputs. Growing an already full-size filesystem is a no-op."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://gnss-resize-rootfs.service"

S = "${UNPACKDIR}"

inherit allarch systemd

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${UNPACKDIR}/gnss-resize-rootfs.service ${D}${systemd_system_unitdir}/
}

SYSTEMD_SERVICE:${PN} = "gnss-resize-rootfs.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

RDEPENDS:${PN} = "e2fsprogs-resize2fs"
