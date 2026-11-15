# On the UNO Q the Linux processor is the debug probe of the STM32: SWD is
# bit-banged on three GPIO lines. That needs OpenOCD's linuxgpiod adapter
# driver, which meta-oe's recipe does not enable.
#
# PENDING HARDWARE TEST: Arduino's factory image uses its own OpenOCD fork;
# whether this upstream revision drives the STM32U585 the same way has not
# been verified on a board. See docs/known-issues.md.
DEPENDS:append:uno-q = " libgpiod"
EXTRA_OECONF:append:uno-q = " --enable-linuxgpiod"
