// server/gnss_control.js
// Start/stop/status of the GNSS-SDR receiver, behind one interface with two
// backends:
//   - "spawn":   this process launches gnss-sdr as a child (development, Debian).
//   - "systemd": gnss-sdr.service owns the process; we only ask systemd.
//
// Both backends expose async listConfigs(), start(id), stop(), status().
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { listConfigs, findConfig } = require("./configs");

// ---------------------------------------------------------------------------
// spawn backend
// ---------------------------------------------------------------------------
function createSpawnController(cfg, deps = {}) {
  const spawn = deps.spawn || childProcess.spawn;
  const log = deps.log || console;

  let proc = null;
  let currentId = null;
  let stopping = false;
  let killTimer = null;
  let lastError = null;

  function clear() {
    proc = null;
    currentId = null;
    stopping = false;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
  }

  function status() {
    const running = !!proc;
    let message = "stopped";
    if (running) message = stopping ? `stopping (${currentId})` : `running (${currentId})`;
    else if (lastError) message = `stopped (last error: ${lastError})`;
    return Promise.resolve({ ok: true, backend: "spawn", running, stopping, config: currentId, message });
  }

  function start(id) {
    if (proc) {
      return Promise.resolve({
        ok: false,
        running: true,
        config: currentId,
        error: stopping ? "GNSS-SDR is still stopping" : "GNSS-SDR already running"
      });
    }
    const conf = findConfig(cfg.GNSS_CONF_DIR, id);
    if (!conf) {
      return Promise.resolve({ ok: false, running: false, config: null, error: `Unknown configuration "${id}"` });
    }

    return new Promise((resolve) => {
      let settled = false;
      const args = [`--config_file=${conf.path}`];
      let child;
      try {
        child = spawn(cfg.GNSS_CMD, args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        lastError = e.message;
        resolve({ ok: false, running: false, config: null, error: e.message });
        return;
      }
      proc = child;
      currentId = conf.id;
      lastError = null;

      // A missing binary is reported through 'error', not as an exception.
      // Without this listener Node would crash the whole server.
      child.on("error", (e) => {
        log.error("Failed to run gnss-sdr:", e.message);
        lastError = e.message;
        if (proc === child) clear();
        if (!settled) {
          settled = true;
          resolve({ ok: false, running: false, config: null, error: e.message });
        }
      });
      child.on("spawn", () => {
        log.log(`Started GNSS-SDR: ${cfg.GNSS_CMD} ${args.join(" ")}`);
        if (!settled) {
          settled = true;
          resolve({ ok: true, running: true, config: conf.id, message: `GNSS-SDR started (${conf.id})` });
        }
      });
      child.on("exit", (code, signal) => {
        log.log(`GNSS-SDR exited (code=${code}, signal=${signal})`);
        if (code !== 0 && code !== null && !stopping) lastError = `exit code ${code}`;
        if (proc === child) clear();
      });
      if (child.stdout) child.stdout.on("data", (d) => log.log("[gnss-sdr]", d.toString().trimEnd()));
      if (child.stderr) child.stderr.on("data", (d) => log.error("[gnss-sdr]", d.toString().trimEnd()));
    });
  }

  function stop() {
    if (!proc) {
      return Promise.resolve({ ok: false, running: false, config: null, error: "GNSS-SDR is not running" });
    }
    const child = proc;
    const id = currentId;

    return new Promise((resolve) => {
      const done = () => resolve({ ok: true, running: false, config: null, message: `GNSS-SDR stopped (${id})` });
      child.once("exit", done);

      if (!stopping) {
        stopping = true;
        try {
          child.kill("SIGTERM"); // gnss-sdr handles SIGTERM and stops the flowgraph
        } catch (e) {
          child.removeListener("exit", done);
          resolve({ ok: false, running: true, config: id, error: e.message });
          return;
        }
        killTimer = setTimeout(() => {
          log.error(`GNSS-SDR did not stop after ${cfg.STOP_TIMEOUT_MS} ms, sending SIGKILL`);
          try {
            child.kill("SIGKILL");
          } catch (e) {
            /* already gone */
          }
        }, cfg.STOP_TIMEOUT_MS);
      }
    });
  }

  return {
    backend: "spawn",
    listConfigs: () => Promise.resolve(listConfigs(cfg.GNSS_CONF_DIR).map(({ id, label }) => ({ id, label }))),
    start,
    stop,
    status
  };
}

// ---------------------------------------------------------------------------
// systemd backend
// ---------------------------------------------------------------------------
function createSystemdController(cfg, deps = {}) {
  const execFile = deps.execFile || childProcess.execFile;
  const fsImpl = deps.fs || fs;

  // The unit reads /etc/gnss-sdr/${GNSS_SDR_CONFIG}.conf, so only flat names.
  const DEPTH = 1;

  function systemctl(args) {
    return new Promise((resolve) => {
      execFile("systemctl", ["--no-ask-password", ...args], { timeout: 30000 }, (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || (err && err.message) || "")
        });
      });
    });
  }

  function readEnvValue(file, key) {
    try {
      const text = fsImpl.readFileSync(file, "utf8");
      const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]*)"?\\s*$`, "m"));
      return m ? m[1].trim() : null;
    } catch (e) {
      return null;
    }
  }

  function selectedConfig() {
    return readEnvValue(cfg.GNSS_SELECT_FILE, "GNSS_SDR_CONFIG") || readEnvValue(cfg.GNSS_DEFAULTS_FILE, "GNSS_SDR_CONFIG");
  }

  async function status() {
    const r = await systemctl([
      "show",
      cfg.GNSS_UNIT,
      "--property=ActiveState",
      "--property=SubState",
      "--property=Result",
      "--property=ExecMainStatus"
    ]);
    const props = {};
    for (const line of r.stdout.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) props[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    const active = props.ActiveState || "unknown";
    const running = active === "active" || active === "activating" || active === "reloading";
    const stopping = active === "deactivating";
    const config = running || stopping ? selectedConfig() : null;

    let message = `${active}${props.SubState ? "/" + props.SubState : ""}`;
    if (running && config) message = `running (${config})`;
    if (active === "failed") {
      message = `failed (${props.Result || "unknown"}, exit status ${props.ExecMainStatus || "?"}) - see journalctl -u ${cfg.GNSS_UNIT}`;
    }
    return { ok: r.code === 0, backend: "systemd", running, stopping, config, message };
  }

  async function start(id) {
    const conf = findConfig(cfg.GNSS_CONF_DIR, id, DEPTH);
    if (!conf) return { ok: false, running: false, config: null, error: `Unknown configuration "${id}"` };

    const st = await status();
    if (st.running || st.stopping) {
      return { ok: false, running: true, config: st.config, error: "GNSS-SDR already running" };
    }

    try {
      const dir = path.dirname(cfg.GNSS_SELECT_FILE);
      const tmp = path.join(dir, `.selected.${process.pid}.tmp`);
      fsImpl.writeFileSync(tmp, `GNSS_SDR_CONFIG=${conf.id}\n`, { mode: 0o644 });
      fsImpl.renameSync(tmp, cfg.GNSS_SELECT_FILE);
    } catch (e) {
      return { ok: false, running: false, config: null, error: `Cannot select configuration: ${e.message}` };
    }

    await systemctl(["reset-failed", cfg.GNSS_UNIT]); // clear a previous failure / start limit
    const r = await systemctl(["start", cfg.GNSS_UNIT]);
    if (r.code !== 0) {
      const after = await status();
      return { ok: false, running: after.running, config: after.config, error: after.message || r.stderr.trim() };
    }
    return { ok: true, running: true, config: conf.id, message: `GNSS-SDR started (${conf.id})` };
  }

  async function stop() {
    const st = await status();
    if (!st.running && !st.stopping) {
      return { ok: false, running: false, config: null, error: "GNSS-SDR is not running" };
    }
    const r = await systemctl(["stop", cfg.GNSS_UNIT]);
    if (r.code !== 0) return { ok: false, running: true, config: st.config, error: r.stderr.trim() || "systemctl stop failed" };
    return { ok: true, running: false, config: null, message: "GNSS-SDR stopped" };
  }

  return {
    backend: "systemd",
    listConfigs: () => Promise.resolve(listConfigs(cfg.GNSS_CONF_DIR, DEPTH).map(({ id, label }) => ({ id, label }))),
    start,
    stop,
    status
  };
}

function createController(cfg, deps) {
  return cfg.GNSS_CONTROL === "systemd" ? createSystemdController(cfg, deps) : createSpawnController(cfg, deps);
}

module.exports = { createController, createSpawnController, createSystemdController };
