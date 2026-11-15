SUMMARY = "Web monitor and control panel for the GNSS-SDR receiver"
DESCRIPTION = "Node.js server that decodes the GNSS-SDR protobuf monitor \
streams (UDP), serves a web UI with position, channels, map and statistics, \
and starts/stops the receiver through systemd."
HOMEPAGE = "https://github.com/kalmancito/GNSS-SDR-meets-Arduino-Q"
SECTION = "apps"

# The application is GPL-2.0-only; the rest are the licences of its npm
# dependency tree (express and friends: MIT; protobufjs: BSD-3-Clause; long:
# Apache-2.0; leaflet: BSD-2-Clause; once, wrappy, inherits, setprototypeof: ISC).
LICENSE = "GPL-2.0-only & MIT & BSD-3-Clause & BSD-2-Clause & Apache-2.0 & ISC"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-2.0-only;md5=801f80980d171dd6425610833a22dbe6"

# The sources live in this repository (apps/web-monitor). The npm dependencies
# are fetched in do_fetch, each with the integrity hash recorded in the lock
# file: nothing is downloaded while building.
FILESEXTRAPATHS:prepend := "${GNSS_UNO_Q_REPO}/apps:"

SRC_URI = " \
    file://web-monitor \
    npmsw://${GNSS_UNO_Q_REPO}/apps/web-monitor/package-lock.json \
    file://gnss-web-monitor.service \
    file://gnss-web-monitor.default \
"

S = "${UNPACKDIR}/web-monitor"

inherit npm systemd useradd

# npm.bbclass expects the lock file under its other name, and a node_modules/
# left in the source tree by a developer must never end up in the package.
gnss_web_monitor_prepare() {
    rm -rf ${S}/node_modules
    cp ${S}/package-lock.json ${S}/npm-shrinkwrap.json
}
do_configure[prefuncs] += "gnss_web_monitor_prepare"

USERADD_PACKAGES = "${PN}"
# "gnss" is the group allowed (by polkit) to start and stop gnss-sdr.service
# and to write the selected profile in /run/gnss-sdr.
GROUPADD_PARAM:${PN} = "--system gnss"
USERADD_PARAM:${PN} = "--system --no-create-home --home-dir /nonexistent --shell /sbin/nologin --gid gnss gnss-web"

SYSTEMD_SERVICE:${PN} = "gnss-web-monitor.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install:append() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${UNPACKDIR}/gnss-web-monitor.service ${D}${systemd_system_unitdir}/

    install -d ${D}${sysconfdir}/default
    install -m 0644 ${UNPACKDIR}/gnss-web-monitor.default ${D}${sysconfdir}/default/gnss-web-monitor
}

FILES:${PN} += "${systemd_system_unitdir} ${sysconfdir}/default"
CONFFILES:${PN} = "${sysconfdir}/default/gnss-web-monitor"
