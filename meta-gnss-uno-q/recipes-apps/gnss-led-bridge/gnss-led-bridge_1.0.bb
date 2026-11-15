SUMMARY = "GNSS status bridge for the Arduino UNO Q LED matrix"
DESCRIPTION = "Polls the web monitor's REST API and answers the STM32 \
sketch's get_gnss_status calls through the arduino-router daemon. It replaces \
the Arduino App Lab container used on the factory image."
HOMEPAGE = "https://github.com/kalmancito/GNSS-SDR-meets-Arduino-Q"
SECTION = "apps"

LICENSE = "MPL-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MPL-2.0;md5=815ca599c9df247a0c7f619bab123dad"

# The sources live in this repository (apps/led-matrix/python).
FILESEXTRAPATHS:prepend := "${GNSS_UNO_Q_REPO}/apps/led-matrix:"

SRC_URI = " \
    file://python/gnss_status.py \
    file://python/gnss_poller.py \
    file://python/gnss_led_bridge.py \
    file://gnss-led-bridge.service \
"

S = "${UNPACKDIR}"

inherit allarch systemd

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/gnss-led-bridge
    install -m 0644 ${UNPACKDIR}/python/gnss_status.py ${D}${datadir}/gnss-led-bridge/
    install -m 0644 ${UNPACKDIR}/python/gnss_poller.py ${D}${datadir}/gnss-led-bridge/
    install -m 0755 ${UNPACKDIR}/python/gnss_led_bridge.py ${D}${datadir}/gnss-led-bridge/

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${UNPACKDIR}/gnss-led-bridge.service ${D}${systemd_system_unitdir}/
}

SYSTEMD_SERVICE:${PN} = "gnss-led-bridge.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

FILES:${PN} += "${datadir}/gnss-led-bridge"

RDEPENDS:${PN} = " \
    arduino-router \
    python3-arduino-router-bridge \
    python3-core \
    python3-json \
    python3-netclient \
    python3-threading \
"
