SUMMARY = "GNSS-SDR: an open source software-defined GNSS receiver"
DESCRIPTION = "Software-defined GNSS receiver built on GNU Radio. This recipe \
builds the file and rtl_tcp signal sources by default; hardware front-ends are \
opt-in through PACKAGECONFIG."
HOMEPAGE = "https://gnss-sdr.org"
BUGTRACKER = "https://github.com/gnss-sdr/gnss-sdr/issues"
SECTION = "apps"

# Written for this layer. The dependency list and the idea of ENABLE_PACKAGING
# follow the recipe in https://github.com/carlesfernandez/meta-gnss-sdr (MIT),
# which has no branch for this Yocto release.
LICENSE = "GPL-3.0-or-later"
LIC_FILES_CHKSUM = "file://COPYING;md5=31f43bdb1ab7b19dae6e891241ca0568"

# Release v0.0.22 (2026-10-04).
SRCREV = "3fcb502aeb618968cd24492010fb8186f122efda"
SRC_URI = " \
    git://github.com/gnss-sdr/gnss-sdr.git;protocol=https;branch=main \
    file://gnss-sdr.service \
    file://rtl-tcp.service \
    file://gnss-sdr.default \
    file://gnss-sdr-preflight \
    file://gnss-sdr.tmpfiles \
    file://50-gnss-sdr.rules \
    file://99-gnss-rtl-sdr.rules \
    file://blacklist-dvb-rtl.conf \
"

# Every dependency is listed so that CMake finds it in the sysroot: anything
# missing would make GNSS-SDR's CMake try to download and build it, which
# BitBake (rightly) does not allow outside do_fetch.
#   volk_gnsssdr is built in-tree and needs Mako on the build host.
DEPENDS = " \
    abseil-cpp \
    armadillo \
    boost \
    gnuradio \
    hdf5 \
    lapack \
    matio \
    openssl \
    protobuf \
    protobuf-native \
    pugixml \
    python3-mako-native \
    python3-six-native \
    volk \
    zlib \
"

inherit cmake pkgconfig python3native systemd useradd

# Signal sources. File_Signal_Source and RtlTcp_Signal_Source are always built
# by GNSS-SDR, so the default (empty) configuration already covers recorded
# I/Q files and a live RTL-SDR through rtl_tcp. "osmosdr" adds the direct
# Osmosdr_Signal_Source and needs gr-osmosdr.
PACKAGECONFIG ??= ""
PACKAGECONFIG[osmosdr] = "-DENABLE_OSMOSDR=ON,-DENABLE_OSMOSDR=OFF,gr-osmosdr rtl-sdr"

# Options are set explicitly: several upstream defaults are ON (UHD, ZeroMQ,
# unit tests) or switch themselves on when a library happens to be present
# (RAW_UDP with libpcap).
#   ENABLE_PACKAGING: no test-data downloads at configure time, no stripping
#   (BitBake splits the debug symbols itself).
# No -march/-mtune here: the CPU tuning comes from the machine configuration.
EXTRA_OECMAKE = " \
    -DENABLE_PACKAGING=ON \
    -DENABLE_UNIT_TESTING=OFF \
    -DENABLE_SYSTEM_TESTING=OFF \
    -DENABLE_INSTALL_TESTS=OFF \
    -DENABLE_BENCHMARKS=OFF \
    -DENABLE_GNSS_SIM_INSTALL=OFF \
    -DENABLE_PROFILING=OFF \
    -DENABLE_UHD=OFF \
    -DENABLE_ZMQ=OFF \
    -DENABLE_RAW_UDP=OFF \
    -DENABLE_PLUTOSDR=OFF \
    -DENABLE_FMCOMMS2=OFF \
    -DENABLE_OWN_GLOG=OFF \
    -DENABLE_OWN_ABSEIL=OFF \
    -DENABLE_OWN_ARMADILLO=OFF \
    -DENABLE_LOG=ON \
    -DPYTHON_EXECUTABLE=${PYTHON} \
"

# ---- runtime integration ---------------------------------------------------
USERADD_PACKAGES = "${PN}"
GROUPADD_PARAM:${PN} = "--system gnss; --system plugdev"
USERADD_PARAM:${PN} = "--system --home-dir ${localstatedir}/lib/gnss-sdr --no-create-home \
                       --shell /sbin/nologin --gid gnss --groups plugdev gnss"

SYSTEMD_PACKAGES = "${PN}"
# gnss-sdr.service starts at boot. rtl-tcp.service is not listed: it has no
# [Install] section, udev starts it when an RTL-SDR is plugged in.
SYSTEMD_SERVICE:${PN} = "gnss-sdr.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install:append() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${UNPACKDIR}/gnss-sdr.service ${D}${systemd_system_unitdir}/
    install -m 0644 ${UNPACKDIR}/rtl-tcp.service ${D}${systemd_system_unitdir}/

    install -d ${D}${sysconfdir}/default
    install -m 0644 ${UNPACKDIR}/gnss-sdr.default ${D}${sysconfdir}/default/gnss-sdr

    install -d ${D}${libexecdir}
    install -m 0755 ${UNPACKDIR}/gnss-sdr-preflight ${D}${libexecdir}/gnss-sdr-preflight

    install -d ${D}${nonarch_libdir}/tmpfiles.d
    install -m 0644 ${UNPACKDIR}/gnss-sdr.tmpfiles ${D}${nonarch_libdir}/tmpfiles.d/gnss-sdr.conf

    install -d ${D}${datadir}/polkit-1/rules.d
    install -m 0644 ${UNPACKDIR}/50-gnss-sdr.rules ${D}${datadir}/polkit-1/rules.d/

    install -d ${D}${nonarch_base_libdir}/udev/rules.d
    install -m 0644 ${UNPACKDIR}/99-gnss-rtl-sdr.rules ${D}${nonarch_base_libdir}/udev/rules.d/

    install -d ${D}${sysconfdir}/modprobe.d
    install -m 0644 ${UNPACKDIR}/blacklist-dvb-rtl.conf ${D}${sysconfdir}/modprobe.d/
}

PACKAGES =+ "${PN}-examples"

FILES:${PN} += " \
    ${systemd_system_unitdir} \
    ${nonarch_libdir}/tmpfiles.d \
    ${datadir}/polkit-1/rules.d \
    ${nonarch_base_libdir}/udev/rules.d \
"
# Upstream's example configurations (and its default.conf): handy as a
# reference, not needed to run - the service always passes --config_file.
FILES:${PN}-examples = "${datadir}/gnss-sdr/conf"

# The debug information of the generated VOLK kernels records build paths.
INSANE_SKIP:${PN}-dbg += "buildpaths"

CONFFILES:${PN} = "${sysconfdir}/default/gnss-sdr"

# rtl_tcp (live profile) and rtl_test are in rtl-sdr's -bin package
# (meta-sdr's recipe uses lib_package); bash runs the preflight.
RDEPENDS:${PN} += "bash rtl-sdr-bin"
RRECOMMENDS:${PN} += "gnss-config"
