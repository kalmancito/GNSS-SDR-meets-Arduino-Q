// server/config.js
// Runtime configuration, all overridable through environment variables.
const os = require("os");
const path = require("path");

function intEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return n;
}

function defaultConfDir() {
  if (process.env.GNSS_CONF_DIR) return process.env.GNSS_CONF_DIR;
  // Backwards compatible with the original Debian demo layout.
  const home = process.env.GNSS_SDR_HOME || path.join(os.homedir(), "gnss-sdr");
  return path.join(home, "conf");
}

const control = (process.env.GNSS_CONTROL || "spawn").toLowerCase();
if (control !== "spawn" && control !== "systemd") {
  throw new Error(`GNSS_CONTROL must be "spawn" or "systemd", got "${control}"`);
}

module.exports = {
  APP_ROOT: path.join(__dirname, ".."),

  // HTTP / WebSocket
  HTTP_HOST: process.env.HTTP_HOST || "0.0.0.0",
  HTTP_PORT: intEnv("HTTP_PORT", 8080),

  // UDP monitor inputs (GNSS-SDR Monitor / PVT.monitor). Loopback by default:
  // anything else lets any host on the network inject fake receiver data.
  UDP_HOST: process.env.UDP_HOST || "127.0.0.1",
  UDP_PORT_OBS: intEnv("UDP_PORT_OBS", 1112), // Monitor.udp_port
  UDP_PORT_PVT: intEnv("UDP_PORT_PVT", 1111), // PVT.monitor_udp_port

  // Receiver control
  GNSS_CONTROL: control, // "spawn" (development / Debian) or "systemd" (Yocto image)
  GNSS_CMD: process.env.GNSS_CMD || "gnss-sdr",
  GNSS_CONF_DIR: defaultConfDir(),
  GNSS_UNIT: process.env.GNSS_UNIT || "gnss-sdr.service",
  GNSS_SELECT_FILE: process.env.GNSS_SELECT_FILE || "/run/gnss-sdr/selected.env",
  GNSS_DEFAULTS_FILE: process.env.GNSS_DEFAULTS_FILE || "/etc/default/gnss-sdr",
  STOP_TIMEOUT_MS: intEnv("GNSS_STOP_TIMEOUT_MS", 10000),

  // Data older than this is reported as stale.
  TTL_MS: intEnv("GNSS_TTL_MS", 5000)
};
