# ADR-003: Signal sources

Status: accepted. File profile and live profile both **not yet run on this image**. Date: 2026-11-15.

## Context

The receiver needs samples from somewhere. A recorded file removes every RF and USB unknown; a live front-end is the goal. For an RTL-SDR, GNSS-SDR offers two sources:

| | `Osmosdr_Signal_Source` | `RtlTcp_Signal_Source` |
|---|---|---|
| Needs | gr-osmosdr (GNU Radio module) + librtlsdr, and `ENABLE_OSMOSDR` | only the `rtl_tcp` program (part of rtl-sdr); always compiled into GNSS-SDR |
| Path of the samples | USB -> librtlsdr -> GNSS-SDR | USB -> `rtl_tcp` -> TCP on loopback -> GNSS-SDR |
| Build risk | gr-osmosdr against Boost 1.90 and a GNU Radio development snapshot | none beyond rtl-sdr itself (a small C library) |

## Decision

1. **File first.** The `gps-l1ca-file` profile and a public capture with a documented format are the first thing to run; nothing live is attempted before it produces a fix.
2. **Live through `rtl_tcp`.** `rtl-tcp.service` serves the dongle on `127.0.0.1:1234`; the `gps-l1ca-live` profile uses `RtlTcp_Signal_Source`.
3. `Osmosdr_Signal_Source` stays available as `PACKAGECONFIG[osmosdr]` of the `gnss-sdr` recipe, off by default.

So the default build has no dependency on any SDR driver stack, and the file-only receiver builds whether or not gr-osmosdr does.

## Cost of the `rtl_tcp` path

At 2.048 MS/s the stream is 4.1 MB/s of 8-bit samples over loopback, plus one extra process. Whether that matters on the Cortex-A53 is a measurement, not an assumption: test P01. If it does, enable `osmosdr` and compare.

## Consequences

- The original demo's live configuration, recovered from the board, **does use `Osmosdr_Signal_Source`** (gr_complex at 2.048 MS/s). Its tuning carries over to `gps-l1ca-live.conf`: same rate, 7 channels, 4 ms integration, narrow loops. The source block does not. So the first live test also compares the two paths. If `rtl_tcp` costs too much CPU at 2.048 MS/s, build with `osmosdr` and use the demo's source.
- `rtl_tcp` serves one client; `gnss-sdr-preflight` probes the port once and waits before the receiver connects.
- Bias tee and device selection are `rtl_tcp` arguments (`RTL_TCP_EXTRA_ARGS` in `/etc/default/gnss-sdr`); frequency, rate and gain are set by GNSS-SDR from the profile.

Other front-ends (ADALM-Pluto, USRP, a custom digitiser) are out of scope until the RTL-SDR path is measured.
