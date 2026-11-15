const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSpawnController, createSystemdController } = require("../server/gnss_control");

const quiet = { log() {}, error() {} };

function makeCfg(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gnss-ctl-"));
  fs.writeFileSync(path.join(dir, "gps-l1ca-file.conf"), "[GNSS-SDR]\n");
  fs.writeFileSync(path.join(dir, "gps-l1ca-live.conf"), "[GNSS-SDR]\n");
  return {
    GNSS_CMD: "gnss-sdr",
    GNSS_CONF_DIR: dir,
    GNSS_UNIT: "gnss-sdr.service",
    GNSS_SELECT_FILE: path.join(dir, "selected.env"),
    GNSS_DEFAULTS_FILE: path.join(dir, "defaults"),
    STOP_TIMEOUT_MS: 2000,
    ...extra
  };
}

// A stand-in receiver: a process that runs until it is told to stop.
const fakeReceiver = (cmd, args, opts) =>
  childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], opts);

// ---------------------------------------------------------------------------
// spawn backend
// ---------------------------------------------------------------------------

// Regression: a missing gnss-sdr binary is reported through the child's
// 'error' event. Without a listener it crashed the whole server.
test("spawn: a missing binary is reported, the server survives", async () => {
  const ctl = createSpawnController(makeCfg({ GNSS_CMD: "definitely-not-a-real-binary-gnss" }), { log: quiet });
  const r = await ctl.start("gps-l1ca-file");
  assert.equal(r.ok, false);
  assert.equal(r.running, false);
  assert.match(r.error, /ENOENT|not found/i);

  const st = await ctl.status();
  assert.equal(st.running, false);
  assert.match(st.message, /last error/);
});

test("spawn: unknown and malicious configuration ids are rejected", async () => {
  const ctl = createSpawnController(makeCfg(), { spawn: fakeReceiver, log: quiet });
  for (const id of ["nope", "../../etc/passwd", ""]) {
    const r = await ctl.start(id);
    assert.equal(r.ok, false, `id ${JSON.stringify(id)}`);
    assert.match(r.error, /Unknown configuration/);
  }
  assert.equal((await ctl.status()).running, false);
});

// Regression: stop() used to answer "running: false" right after sending
// SIGTERM, so an immediate start() failed with "already running".
test("spawn: start, double start, stop, start again", async () => {
  const ctl = createSpawnController(makeCfg(), { spawn: fakeReceiver, log: quiet });

  const first = await ctl.start("gps-l1ca-file");
  assert.equal(first.ok, true);
  assert.equal(first.config, "gps-l1ca-file");
  assert.equal((await ctl.status()).running, true);

  const second = await ctl.start("gps-l1ca-live");
  assert.equal(second.ok, false);
  assert.match(second.error, /already running/);

  const stopped = await ctl.stop();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.running, false);
  assert.equal((await ctl.status()).running, false); // really gone when stop() resolves

  const again = await ctl.start("gps-l1ca-live");
  assert.equal(again.ok, true);
  assert.equal(again.config, "gps-l1ca-live");
  await ctl.stop();
});

test("spawn: stop when nothing runs is an error, not a crash", async () => {
  const ctl = createSpawnController(makeCfg(), { spawn: fakeReceiver, log: quiet });
  const r = await ctl.stop();
  assert.equal(r.ok, false);
  assert.match(r.error, /not running/);
});

test("spawn: the receiver exiting on its own clears the state", async () => {
  const shortLived = (cmd, args, opts) => childProcess.spawn(process.execPath, ["-e", "process.exit(3)"], opts);
  const ctl = createSpawnController(makeCfg(), { spawn: shortLived, log: quiet });
  await ctl.start("gps-l1ca-file");
  let st = await ctl.status();
  for (let i = 0; i < 100 && st.running; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    st = await ctl.status();
  }
  assert.equal(st.running, false);
  assert.match(st.message, /exit code 3/);
});

// ---------------------------------------------------------------------------
// systemd backend (systemctl is simulated)
// ---------------------------------------------------------------------------
function fakeSystemd(initial = "inactive") {
  const sim = { active: initial, calls: [], failStart: false };
  sim.execFile = (cmd, args, opts, cb) => {
    sim.calls.push([cmd, ...args]);
    const verb = args[1];
    if (verb === "show") {
      const result = sim.active === "failed" ? "exit-code" : "success";
      const status = sim.active === "failed" ? 78 : 0;
      cb(null, `ActiveState=${sim.active}\nSubState=x\nResult=${result}\nExecMainStatus=${status}\n`, "");
    } else if (verb === "start") {
      if (sim.failStart) {
        sim.active = "failed";
        cb(Object.assign(new Error("Job failed"), { code: 1 }), "", "Job for gnss-sdr.service failed");
      } else {
        sim.active = "active";
        cb(null, "", "");
      }
    } else if (verb === "stop") {
      sim.active = "inactive";
      cb(null, "", "");
    } else {
      cb(null, "", "");
    }
  };
  return sim;
}

test("systemd: start selects the profile and asks systemd, never a prompt", async () => {
  const cfg = makeCfg();
  const sim = fakeSystemd();
  const ctl = createSystemdController(cfg, { execFile: sim.execFile });

  const r = await ctl.start("gps-l1ca-live");
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(cfg.GNSS_SELECT_FILE, "utf8"), "GNSS_SDR_CONFIG=gps-l1ca-live\n");
  assert.ok(sim.calls.some((c) => c.includes("start") && c.includes("gnss-sdr.service")));
  assert.ok(sim.calls.every((c) => c[0] === "systemctl" && c[1] === "--no-ask-password"));

  const st = await ctl.status();
  assert.equal(st.running, true);
  assert.equal(st.config, "gps-l1ca-live");
});

test("systemd: start while active is refused and the selection is untouched", async () => {
  const cfg = makeCfg();
  fs.writeFileSync(cfg.GNSS_SELECT_FILE, "GNSS_SDR_CONFIG=gps-l1ca-file\n");
  const sim = fakeSystemd("active");
  const ctl = createSystemdController(cfg, { execFile: sim.execFile });

  const r = await ctl.start("gps-l1ca-live");
  assert.equal(r.ok, false);
  assert.match(r.error, /already running/);
  assert.equal(fs.readFileSync(cfg.GNSS_SELECT_FILE, "utf8"), "GNSS_SDR_CONFIG=gps-l1ca-file\n");
});

test("systemd: a failed start (e.g. no SDR plugged in) is reported with the reason", async () => {
  const sim = fakeSystemd();
  sim.failStart = true;
  const ctl = createSystemdController(makeCfg(), { execFile: sim.execFile });

  const r = await ctl.start("gps-l1ca-live");
  assert.equal(r.ok, false);
  assert.equal(r.running, false);
  assert.match(r.error, /failed .*exit status 78/);
});

test("systemd: only flat profile names are offered and accepted", async () => {
  const cfg = makeCfg();
  fs.mkdirSync(path.join(cfg.GNSS_CONF_DIR, "sub"));
  fs.writeFileSync(path.join(cfg.GNSS_CONF_DIR, "sub", "nested.conf"), "[GNSS-SDR]\n");
  const sim = fakeSystemd();
  const ctl = createSystemdController(cfg, { execFile: sim.execFile });

  assert.deepEqual(
    (await ctl.listConfigs()).map((c) => c.id),
    ["gps-l1ca-file", "gps-l1ca-live"]
  );
  const r = await ctl.start("sub/nested");
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown configuration/);
});

test("systemd: stop", async () => {
  const sim = fakeSystemd("active");
  const ctl = createSystemdController(makeCfg(), { execFile: sim.execFile });
  assert.equal((await ctl.stop()).ok, true);
  assert.equal((await ctl.status()).running, false);
  const again = await ctl.stop();
  assert.equal(again.ok, false);
  assert.match(again.error, /not running/);
});

test("systemd: the profile falls back to /etc/default when nothing was selected", async () => {
  const cfg = makeCfg();
  fs.writeFileSync(cfg.GNSS_DEFAULTS_FILE, '# defaults\nGNSS_SDR_CONFIG="gps-l1ca-file"\n');
  const sim = fakeSystemd("active");
  const ctl = createSystemdController(cfg, { execFile: sim.execFile });
  assert.equal((await ctl.status()).config, "gps-l1ca-file");
});
