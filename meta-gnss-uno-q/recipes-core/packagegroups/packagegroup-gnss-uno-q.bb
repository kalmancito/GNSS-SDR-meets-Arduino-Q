SUMMARY = "GNSS-SDR receiver for the Arduino UNO Q: applications and tools"
LICENSE = "MIT"

PACKAGE_ARCH = "${MACHINE_ARCH}"

inherit packagegroup

PACKAGES = " \
    ${PN} \
    ${PN}-receiver \
    ${PN}-monitor \
    ${PN}-mcu \
    ${PN}-system \
"

RDEPENDS:${PN} = " \
    ${PN}-receiver \
    ${PN}-monitor \
    ${PN}-mcu \
    ${PN}-system \
"

SUMMARY:${PN}-receiver = "GNSS-SDR, its profiles and the RTL-SDR tools"
RDEPENDS:${PN}-receiver = " \
    gnss-sdr \
    gnss-config \
    rtl-sdr-bin \
"

SUMMARY:${PN}-monitor = "Web monitor and control panel"
RDEPENDS:${PN}-monitor = " \
    gnss-web-monitor \
"

SUMMARY:${PN}-mcu = "Link to the STM32 (LED matrix)"
RDEPENDS:${PN}-mcu = " \
    arduino-router \
    gnss-led-bridge \
    gnss-mcu-flash \
"

SUMMARY:${PN}-system = "Networking, time, storage and diagnostic tools"
RDEPENDS:${PN}-system = " \
    ca-certificates \
    curl \
    e2fsprogs-resize2fs \
    gnss-resize-rootfs \
    gnss-tools \
    htop \
    iproute2 \
    less \
    libgpiod-tools \
    nano \
    networkmanager \
    networkmanager-nmcli \
    networkmanager-wifi \
    procps \
    tzdata \
    usbutils \
    util-linux \
    wpa-supplicant \
"
