# GNU Radio for the receiver: the stable release, headless.
#
# Version. meta-sdr builds a snapshot of GNU Radio's development branch
# (3.11.0.0+git, unreleased). This image uses a stable release
# instead, v3.10.12.0: the version the receiver was validated with in real
# time on this board (Debian 13 packages, docs/logs/board-inventory-20261115),
# and what distributions ship GNSS-SDR against. ADR-002.
PV = "3.10.12.0"
GIT_BRANCH = "maint-3.10"
# Tag v3.10.12.0.
SRCREV = "ec7a3239645162ffea1925e6f1e6e62bf1349d03"

# meta-sdr's patches were checked against v3.10.12.0 with `git apply --check`
# (2026-11-15): all apply except this one, written for the development
# branch. It only concerns gr-qtgui, which is not built here.
SRC_URI:remove = "file://0001-gr-qtgui-Don-t-build-the-fosphor-display-against-Ope.patch"

# Headless. meta-sdr's default ("grc zeromq") pulls in GNU Radio Companion and
# with it GTK and a desktop stack. GNSS-SDR uses GNU Radio as a library: it
# needs the runtime, pmt, blocks, fft, filter and analog components, which are
# always built.
PACKAGECONFIG = ""
