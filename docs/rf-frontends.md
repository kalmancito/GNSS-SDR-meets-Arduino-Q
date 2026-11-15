# Antenna and front-end

GNSS signals arrive below the noise floor: about -130 dBm for GPS L1 C/A. The RF chain decides whether the receiver sees anything, long before software matters. This is why the first test of the image uses a recorded file, where the RF chain is someone else's and known to be good.

> The live path of this image (`rtl_tcp` + `RtlTcp_Signal_Source`) has **not been run yet**. What is known to work is the original demo's chain on the factory system ([legacy-debian.md](legacy-debian.md)).

## What you need

| Item | Requirement |
|---|---|
| Antenna | **Active** GNSS antenna (built-in low-noise amplifier, typically 25-30 dB gain), with a view of the sky. A passive antenna on a few metres of cable will not work with an RTL-SDR. |
| Power for the antenna | A **bias tee**: DC on the coax, usually 3-5 V. Check the antenna's voltage range. |
| Front-end | RTL-SDR with an R820T/R820T2/R860 tuner (they reach 1575.42 MHz) and preferably a **TCXO**. |
| Cable | Short, low-loss; every dB lost before the first amplifier is a dB of sensitivity lost. |

The demo used a **Nooelec NESDR SMArTee**: its bias tee is always on and it has a temperature-compensated oscillator.

### Bias tee

- Always-on dongles (NESDR SMArTee): nothing to configure. Never connect them to a DC-shorted antenna or to test equipment that cannot take DC.
- Software-switched dongles (RTL-SDR Blog V3/V4): add `-T` to `RTL_TCP_EXTRA_ARGS` in `/etc/default/gnss-sdr`.
- No bias tee: use an external one, or a powered antenna splitter.

### Oscillator

A plain RTL-SDR crystal can be off by 50 ppm or more: about 80 kHz at L1, far outside the receiver's Doppler search, and drifting as the dongle warms up. With a TCXO (1 ppm or better, 1.5 kHz) the profile's Doppler search of +/-5 kHz covers it. Without one, expect to calibrate: GNSS-SDR's `front-end-cal` tool estimates the offset, which then goes into `InputFilter.IF` and the sample rate of the profile. `front-end-cal` is not built in this image (it needs the osmosdr source).

## The live profile

`/etc/gnss-sdr/gps-l1ca-live.conf`:

| Setting | Value | Notes |
|---|---|---|
| `SignalSource.freq` | 1575420000 | L1 |
| `SignalSource.sampling_frequency` | 2048000 | covers the C/A main lobe (2.046 MHz) |
| `SignalSource.gain` / `rf_gain` / `if_gain` | 40 / 40 / 30 | tuner gain; start high, reduce if the signal is clipped |
| `SignalSource.AGC_enabled` | false | fixed gain is more predictable for GNSS |
| `InputFilter` | `Pass_Through` | no filtering, no frequency shift: needs a dongle with a TCXO |
| `Channels_1C.count` | 7 | what ran in real time in the demo |
| Integration | 4 ms, narrow loops after lock | weak-signal margin |

These are the values of the demo's validated configuration (`all_bands_rtl_realtime.conf`, recovered from the board on 2026-11-15 into [docs/logs/board-inventory-20261115](logs/board-inventory-20261115/gnss-sdr-conf/)). Only the source block differs: `rtl_tcp` instead of gr-osmosdr.

For a dongle **without** a TCXO, replace `InputFilter` with the `Freq_Xlating_Fir_Filter` block of upstream's `gnss-sdr_GPS_L1_rtl_tcp_realtime.conf` and put the calibrated offset in `InputFilter.IF`.

## Checking the chain, step by step

Do not start with the receiver. On the board:

```bash
# 1. Is the dongle there, on a host-mode port, with power?
lsusb | grep -i -E '0bda:(2832|2838)'
dmesg | tail -n 30                          # no disconnects, no "over-current"

# 2. Is it free? (the kernel's DVB driver must not have claimed it)
lsmod | grep dvb_usb_rtl28xxu               # must print nothing

# 3. Does it stream without losing samples? (stop rtl-tcp first: one user at a time)
systemctl stop rtl-tcp gnss-sdr
rtl_test -s 2048000                         # run a minute; "lost at least N bytes" = USB problem
rtl_test -p                                 # reports the oscillator error in ppm after a few minutes
systemctl start rtl-tcp

# 4. Then the receiver
systemctl start gnss-sdr
journalctl -u gnss-sdr -f
```

In the receiver log, in order of appearance when things work: `Tracking of GPS L1 C/A signal started on channel ...`, `New GPS NAV message received in channel ...`, and after 30 s or more of continuous tracking of at least four satellites, `First position fix at ...` and `Position at ...`.

| Symptom | Likely cause |
|---|---|
| No tracking starts at all | No signal: antenna unpowered (bias tee), no sky view, wrong frequency; or oscillator far off (no TCXO) |
| Tracking starts and is lost within seconds, on every satellite | Weak signal (C/N0 below ~35 dB-Hz), or samples being dropped |
| Tracking holds, no navigation messages | Marginal signal; indoor reception |
| Navigation messages but no fix | Fewer than four satellites with ephemeris yet; wait a full minute of continuous tracking |
| Works, then degrades after minutes | Oscillator drift without TCXO; USB power sag; thermal throttling (`gnss-diagnose`) |

The web monitor shows C/N0 per channel. Outdoors with an active antenna, healthy satellites read 40-50 dB-Hz.

## What to record for a live test

For the [validation report](validation-report.md), a live result is only meaningful with: antenna model and placement, dongle model, bias tee state, the profile used (and its checksum), `rtl_test` loss and ppm figures, the receiver log, CPU load and temperature (`gnss-diagnose`), and how long it ran.

## Other front-ends

Not supported by the default build: USRP (UHD), ADALM-Pluto and other IIO devices, LimeSDR, and network sources. The corresponding GNSS-SDR options are off ([ADR-002](decisions/ADR-002-gnss-sdr-recipe.md)); each would need its driver stack as recipes and its own profile. `Osmosdr_Signal_Source` can be enabled with the `osmosdr` PACKAGECONFIG ([ADR-003](decisions/ADR-003-signal-sources.md)).
