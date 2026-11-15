# Headless receiver: GNU Radio is used as a library by GNSS-SDR.
# meta-sdr's default ("grc zeromq") pulls in GNU Radio Companion and with it
# GTK and a desktop stack; none of that belongs in this image. GNSS-SDR needs
# the runtime, pmt, blocks, fft, filter and analog components, which are always
# built.
PACKAGECONFIG = ""
