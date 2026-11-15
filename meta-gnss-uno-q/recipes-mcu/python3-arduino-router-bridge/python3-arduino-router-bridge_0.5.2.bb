SUMMARY = "MessagePack-RPC bridge between Python and an Arduino microcontroller"
DESCRIPTION = "Client library for the arduino-router daemon: lets a Python \
program call methods on the microcontroller and expose functions it can call."
HOMEPAGE = "https://github.com/arduino/arduino-router-bridge-py"
SECTION = "devel/python"

LICENSE = "MPL-2.0"
LIC_FILES_CHKSUM = "file://LICENSE.txt;md5=f75d2927d3c1ed2414ef72048f5ad640"

PYPI_PACKAGE = "arduino_router_bridge"
UPSTREAM_CHECK_PYPI_PACKAGE = "arduino-router-bridge"

SRC_URI[sha256sum] = "7c8c0a3ea480597c9e77656465308a3770debfd7e9a8c5f7b2044f2e689250e4"

inherit pypi python_setuptools_build_meta

RDEPENDS:${PN} = " \
    python3-core \
    python3-logging \
    python3-msgpack \
    python3-threading \
"
