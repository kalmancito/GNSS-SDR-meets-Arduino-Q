// server/udp_handlers.js
// Receives the GNSS-SDR protobuf monitor streams over UDP and turns them into
// the plain JSON objects used by the web UI and the REST API.
const dgram = require("dgram");
const path = require("path");
const protobuf = require("protobufjs");

const PROTO_DIR = path.join(__dirname, "..", "protos");

// int64/uint64 fields are converted to Number: left as Long objects they are
// always truthy and never equal to 0.
const TO_OBJECT = { longs: Number, defaults: true };

async function loadProtobufTypes() {
  const root = await protobuf.load([
    path.join(PROTO_DIR, "gnss_synchro.proto"),
    path.join(PROTO_DIR, "monitor_pvt.proto")
  ]);
  return {
    Observables: root.lookupType("gnss_sdr.Observables"),
    MonitorPvt: root.lookupType("gnss_sdr.MonitorPvt")
  };
}

/** Decode a Monitor datagram into the list of channels that are tracking. */
function decodeObservables(types, buf, now = new Date()) {
  const obs = types.Observables.toObject(types.Observables.decode(buf), TO_OBJECT);
  const timestamp = now.toISOString();
  return (obs.observable || [])
    .filter((s) => s.fs !== 0) // idle channels are sent zero-filled
    .map((s) => ({
      type: "observables",
      timestamp,
      system: s.system,
      signal: s.signal,
      channel_id: s.channelId,
      prn: s.prn,
      cn0_db_hz: s.cn0DbHz,
      doppler_hz: s.carrierDopplerHz
    }));
}

/** Decode a PVT monitor datagram. */
function decodePvt(types, buf, now = new Date()) {
  const pvt = types.MonitorPvt.toObject(types.MonitorPvt.decode(buf), TO_OBJECT);
  const speed = Math.hypot(pvt.velE, pvt.velN);
  return {
    type: "pvt",
    timestamp: now.toISOString(),
    week: pvt.week,
    tow_ms: pvt.towAtCurrentSymbolMs,
    rx_time: pvt.rxTime,
    utc_time: pvt.utcTime,
    lat: pvt.latitude,
    lon: pvt.longitude,
    height: pvt.height,
    pos_x: pvt.posX,
    pos_y: pvt.posY,
    pos_z: pvt.posZ,
    vel_x: pvt.velX,
    vel_y: pvt.velY,
    vel_z: pvt.velZ,
    vel_e: pvt.velE,
    vel_n: pvt.velN,
    vel_u: pvt.velU,
    cog: pvt.cog, // course over ground, deg
    speed_mps: Number.isFinite(speed) ? speed : 0, // horizontal speed
    valid_sats: pvt.validSats,
    solution_status: pvt.solutionStatus,
    solution_type: pvt.solutionType,
    gdop: pvt.gdop,
    pdop: pvt.pdop,
    hdop: pvt.hdop,
    vdop: pvt.vdop
  };
}

function bindUdp(port, host, label, onMessage) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", reject); // bind failures (EADDRINUSE, EACCES) are asynchronous
    sock.on("message", onMessage);
    sock.bind(port, host, () => {
      sock.removeListener("error", reject);
      sock.on("error", (e) => console.error(`${label} UDP error:`, e.message));
      const a = sock.address();
      console.log(`${label} UDP listening on ${a.address}:${a.port}`);
      resolve(sock);
    });
  });
}

/**
 * Start both receivers.
 * @param {object} cfg       server configuration
 * @param {object} sinks     { onPvt(msg), onObservables(samples) }
 */
async function initUdpReceivers(cfg, sinks) {
  const types = await loadProtobufTypes();

  const obsSock = await bindUdp(cfg.UDP_PORT_OBS, cfg.UDP_HOST, "Observables", (buf) => {
    let samples;
    try {
      samples = decodeObservables(types, buf);
    } catch (e) {
      console.error("Observables decode error:", e.message);
      return;
    }
    if (samples.length) sinks.onObservables(samples);
  });

  const pvtSock = await bindUdp(cfg.UDP_PORT_PVT, cfg.UDP_HOST, "PVT", (buf) => {
    let msg;
    try {
      msg = decodePvt(types, buf);
    } catch (e) {
      console.error("PVT decode error:", e.message);
      return;
    }
    sinks.onPvt(msg);
  });

  return {
    close() {
      obsSock.close();
      pvtSock.close();
    }
  };
}

module.exports = { initUdpReceivers, loadProtobufTypes, decodeObservables, decodePvt };
