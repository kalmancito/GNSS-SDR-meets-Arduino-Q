SUMMARY = "Flash and reset the UNO Q's STM32 from the Linux side"
DESCRIPTION = "OpenOCD adapter configuration (SWD bit-banged on GPIO) and a \
guarded helper to reset the microcontroller or write a sketch built elsewhere \
with arduino-cli. The sketch binary is not part of the image."
SECTION = "console/utils"

LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://openocd_gpiod.cfg \
    file://gnss-mcu-flash \
"

S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/gnss-mcu-flash
    install -m 0644 ${UNPACKDIR}/openocd_gpiod.cfg ${D}${datadir}/gnss-mcu-flash/
    install -d ${D}${sbindir}
    install -m 0755 ${UNPACKDIR}/gnss-mcu-flash ${D}${sbindir}/
}

FILES:${PN} = "${datadir}/gnss-mcu-flash ${sbindir}/gnss-mcu-flash"

RDEPENDS:${PN} = "bash openocd"
