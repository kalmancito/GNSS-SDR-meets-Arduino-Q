SUMMARY = "C++ library for linear algebra and scientific computing"
HOMEPAGE = "https://arma.sourceforge.net/"
SECTION = "libs"

# No armadillo recipe exists in OE-Core or meta-openembedded for this release.
# Adapted from https://github.com/carlesfernandez/meta-gnss-sdr (MIT), fetching
# from the upstream git repository instead of SourceForge, where tarballs of
# superseded versions are moved to another directory.
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://LICENSE.txt;md5=d273d63619c9aeaf15cdaf76422c4f87"

# Tag 15.6.2.
SRCREV = "734fc0957153df38ae337e79ba20e28b8c105461"
SRC_URI = "git://gitlab.com/conradsnicta/armadillo-code.git;protocol=https;branch=15.6.x"

DEPENDS = "lapack"

inherit cmake

EXTRA_OECMAKE = "-DBUILD_SHARED_LIBS=ON -DBUILD_SMOKE_TEST=OFF"

FILES:${PN}-dev += "${datadir}/Armadillo/CMake"

# The generated CMake package files record the sysroot path of LAPACK.
INSANE_SKIP:${PN}-dev += "buildpaths"
