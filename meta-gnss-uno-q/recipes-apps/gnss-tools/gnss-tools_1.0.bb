SUMMARY = "Diagnostic and benchmark tools for the GNSS-SDR receiver image"
DESCRIPTION = "gnss-diagnose: read-only health report of the board. \
gnss-benchmark: processing-speed measurement on a recorded capture."
SECTION = "console/utils"

LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-2.0-only;md5=801f80980d171dd6425610833a22dbe6"

# The same scripts that live in scripts/ of this repository, so the copy on the
# board and the one used from a PC cannot drift apart.
FILESEXTRAPATHS:prepend := "${GNSS_UNO_Q_REPO}/scripts:"

SRC_URI = " \
    file://diagnose-board.sh \
    file://benchmark-gnss.sh \
"

S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${UNPACKDIR}/diagnose-board.sh ${D}${bindir}/gnss-diagnose
    install -m 0755 ${UNPACKDIR}/benchmark-gnss.sh ${D}${bindir}/gnss-benchmark
}

RDEPENDS:${PN} = "bash coreutils curl procps time util-linux"
