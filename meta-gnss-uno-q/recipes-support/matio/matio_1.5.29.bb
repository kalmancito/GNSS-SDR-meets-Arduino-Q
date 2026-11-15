SUMMARY = "MATLAB MAT file I/O library"
HOMEPAGE = "https://github.com/tbeu/matio"
SECTION = "libs"

# No matio recipe exists in OE-Core or meta-openembedded for this release.
# Adapted from https://github.com/carlesfernandez/meta-gnss-sdr (MIT). The git
# submodule (test datasets) is not fetched: it is not needed to build.
LICENSE = "BSD-2-Clause"
LIC_FILES_CHKSUM = "file://COPYING;md5=9d9dce8b2ae887cf64af04913523847c"

# Tag v1.5.29.
SRCREV = "9a032693865af286a1ebb1bb0a0fac726553dea3"
SRC_URI = "git://github.com/tbeu/matio.git;protocol=https;branch=master"

DEPENDS = "zlib hdf5"

inherit autotools pkgconfig

# MAT v7.3 files are HDF5 files; GNSS-SDR writes them when dumps are enabled.
EXTRA_OECONF = " \
    --enable-mat73=yes \
    --with-default-file-ver=7.3 \
    --with-hdf5=${STAGING_EXECPREFIXDIR} \
    --with-zlib=${STAGING_EXECPREFIXDIR} \
"
