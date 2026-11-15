SUMMARY = "MessagePack-RPC router between Linux and the Arduino UNO Q microcontroller"
DESCRIPTION = "Daemon that routes RPC calls between programs on the Linux side \
(Unix socket) and the STM32 microcontroller (serial link). The sketch's \
Bridge.call()/Bridge.provide() go through it."
HOMEPAGE = "https://github.com/arduino/arduino-router"
SECTION = "console/utils"

# Written for this layer. arduino/meta-arduino has a recipe for this program,
# but it builds v0.9.0 under the 0.11.0 name and downloads the Go modules while
# compiling; here they are pinned in SRC_URI and fetched in do_fetch.
LICENSE = "GPL-3.0-or-later"
LIC_FILES_CHKSUM = "file://src/${GO_IMPORT}/LICENSE.txt;md5=1ebbd3e34237af26da5dc08a4e440464"

GO_IMPORT = "github.com/arduino/arduino-router"

# Tag v0.11.0. Needs Go >= 1.25.2 (this release ships 1.26).
SRCREV = "cb7b2cecee1c04e0ba0a7fb48da63a8a7a1dba71"
SRC_URI = " \
    git://${GO_IMPORT}.git;protocol=https;branch=main;destsuffix=${GO_SRCURI_DESTSUFFIX} \
    file://arduino-router.service \
"

inherit go-mod go-mod-update-modules systemd useradd

# Machine-generated lists of the Go module dependencies and their licences:
#
#   bitbake -c update_modules arduino-router      (needs network, run once)
#
# writes arduino-router-go-mods.inc and arduino-router-licenses.inc next to
# this recipe; they are then committed. Until they exist the recipe parses but
# do_compile fails, because modules cannot be downloaded while building.
# scripts/update-go-mods.sh wraps the command.
include ${BPN}-go-mods.inc
include ${BPN}-licenses.inc

# The router and its command-line client; not the whole module tree.
GO_INSTALL = "${GO_IMPORT} ${GO_IMPORT}/cmd/arduino-router-cli"
GO_EXTRA_LDFLAGS = "-X main.Version=${PV}"
# Pure Go: no C toolchain or libc dependency in the binaries.
CGO_ENABLED = "0"

USERADD_PACKAGES = "${PN}"
# The daemon gives its socket to this group when it exists.
GROUPADD_PARAM:${PN} = "--system arduino-router"

SYSTEMD_SERVICE:${PN} = "arduino-router.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install:append() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${UNPACKDIR}/arduino-router.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} += "${systemd_system_unitdir}"

# gpioset (libgpiod v2 command-line syntax) is used by the service unit.
RDEPENDS:${PN} += "libgpiod-tools"
RDEPENDS:${PN}-dev += "bash"
