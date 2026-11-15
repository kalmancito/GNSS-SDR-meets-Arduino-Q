# GNSS-SDR web monitor

A small Node.js server and a browser UI for a GNSS-SDR receiver: live position, velocity and time, tracking channels with C/N0 and Doppler, a map, time series, position/velocity statistics, and buttons to start and stop the receiver with a chosen configuration.

![Web interface](../../images/web_interface.png)

It receives GNSS-SDR's two protobuf monitor streams over UDP (PVT and observables), keeps the latest state, pushes updates to the browser over a WebSocket and exposes a small REST API.

## Run

```bash
npm ci
npm start            # http://localhost:8080
npm test
```

Node.js 20 or later. The browser libraries (Chart.js, Leaflet) are npm dependencies served by the server itself; only the map tiles come from the Internet.

GNSS-SDR must be configured to send its monitor streams here:

```ini
PVT.enable_monitor=true
PVT.monitor_client_addresses=127.0.0.1
PVT.monitor_udp_port=1111
Monitor.enable_monitor=true
Monitor.client_addresses=127.0.0.1
Monitor.udp_port=1112
```

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `HTTP_HOST`, `HTTP_PORT` | `0.0.0.0`, `8080` | where the UI and API listen |
| `UDP_HOST` | `127.0.0.1` | where the monitor datagrams are received. Loopback by default: anything else lets any host on the network inject receiver data |
| `UDP_PORT_PVT`, `UDP_PORT_OBS` | `1111`, `1112` | must match the GNSS-SDR configuration |
| `GNSS_CONTROL` | `spawn` | how the receiver is started: `spawn` (child process) or `systemd` |
| `GNSS_CONF_DIR` | `$GNSS_SDR_HOME/conf`, else `~/gnss-sdr/conf` | directory of `*.conf` files offered as start buttons |
| `GNSS_CMD` | `gnss-sdr` | executable, in `spawn` mode |
| `GNSS_UNIT` | `gnss-sdr.service` | unit, in `systemd` mode |
| `GNSS_SELECT_FILE` | `/run/gnss-sdr/selected.env` | where the chosen profile is written, in `systemd` mode |
| `GNSS_STOP_TIMEOUT_MS` | `10000` | `spawn` mode: time allowed after SIGTERM before SIGKILL |
| `GNSS_TTL_MS` | `5000` | data older than this is reported as stale |

A configuration file can carry a display name for its button: a comment line `; @title My receiver`.

### Control backends

- **`spawn`**: the server runs `gnss-sdr --config_file=<file>` as its child. For development and for the Debian demo. Files up to one directory deep under `GNSS_CONF_DIR` are offered.
- **`systemd`**: the server writes `GNSS_SDR_CONFIG=<name>` to `GNSS_SELECT_FILE` and calls `systemctl start|stop gnss-sdr.service`. systemd owns the process; the server needs permission to manage that unit (a polkit rule in the Yocto image). Only files directly in `GNSS_CONF_DIR` are offered.

## API

| Method and path | Answer |
|---|---|
| `GET /api/latest/pvt` | `{ok, pvt, age_ms}`; `pvt` is `null` when stale, `age_ms` is `null` if none was ever received |
| `GET /api/latest/observables?limit=64` | `{ok, meta, observables}`; channels seen within the TTL, strongest first |
| `GET /api/gnss/configs` | `{ok, backend, configs: [{id, label}]}` |
| `GET /api/gnss/status` | `{ok, backend, running, stopping, config, message}` |
| `POST /api/gnss/start` with `{"config": "<id>"}` | starts the receiver; `409` if already running or the id is unknown |
| `POST /api/gnss/stop` with `{}` | stops it; answers once it has exited |
| WebSocket `/ws` | PVT objects (`type: "pvt"`) and arrays of channel samples (`type: "observables"`) |

`POST` requests must have `Content-Type: application/json`, and no CORS headers are sent: a page from another site cannot start or stop the receiver through a visitor's browser. There is **no authentication**: anyone who can reach the port can. Keep it on a trusted network, or bind it to loopback and use an SSH tunnel.

## Layout

| Path | |
|---|---|
| `server/server.js` | entry point: wiring, sockets, shutdown |
| `server/app.js` | HTTP routes and static files |
| `server/udp_handlers.js` | protobuf decoding of the two monitor streams |
| `server/state.js` | latest values with expiry |
| `server/gnss_control.js`, `server/configs.js` | receiver control backends, profile discovery |
| `server/websocket.js` | push to browsers |
| `public/` | the UI |
| `protos/` | `gnss_synchro.proto`, `monitor_pvt.proto`, verbatim from GNSS-SDR v0.0.22 (BSD-3-Clause) |
| `test/` | `node --test` suites |

Licence: GPL-2.0-only.
