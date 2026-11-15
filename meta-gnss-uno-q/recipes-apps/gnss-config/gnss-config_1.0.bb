SUMMARY = "GNSS-SDR receiver profiles for the Arduino UNO Q image"
DESCRIPTION = "Configuration files for gnss-sdr.service: GPS L1 C/A from a \
recorded I/Q file and live from an RTL-SDR through rtl_tcp. Each .conf in \
/etc/gnss-sdr is a profile that the service and the web monitor can select."
SECTION = "apps"

# The profiles are derived from the example configurations of GNSS-SDR v0.0.22.
LICENSE = "GPL-3.0-or-later"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-3.0-or-later;md5=1c76c4cc354acaac30ed4d5eefea7245"

SRC_URI = " \
    file://gps-l1ca-file.conf \
    file://gps-l1ca-live.conf \
"

S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${sysconfdir}/gnss-sdr
    install -m 0644 ${UNPACKDIR}/gps-l1ca-file.conf ${D}${sysconfdir}/gnss-sdr/
    install -m 0644 ${UNPACKDIR}/gps-l1ca-live.conf ${D}${sysconfdir}/gnss-sdr/
}

FILES:${PN} = "${sysconfdir}/gnss-sdr"
# Site-specific tuning (gain, IF, channels) survives package upgrades.
CONFFILES:${PN} = " \
    ${sysconfdir}/gnss-sdr/gps-l1ca-file.conf \
    ${sysconfdir}/gnss-sdr/gps-l1ca-live.conf \
"
