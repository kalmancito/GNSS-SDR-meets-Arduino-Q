const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { createApp } = require("../server/app");
const { createState } = require("../server/state");

function fakeController() {
  const calls = [];
  return {
    calls,
    backend: "fake",
    listConfigs: async () => [{ id: "gps-l1ca-file", label: "File" }],
    status: async () => ({ ok: true, backend: "fake", running: false, stopping: false, config: null, message: "stopped" }),
    start: async (id) => {
      calls.push(["start", id]);
      return id === "gps-l1ca-file"
        ? { ok: true, running: true, config: id, message: "started" }
        : { ok: false, running: false, config: null, error: `Unknown configuration "${id}"` };
    },
    stop: async () => {
      calls.push(["stop"]);
      return { ok: true, running: false, config: null, message: "stopped" };
    }
  };
}

async function withServer(fn) {
  const controller = fakeController();
  const state = createState({ ttlMs: 5000 });
  const cfg = { APP_ROOT: path.join(__dirname, "..") };
  const server = http.createServer(createApp({ cfg, state, controller }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, controller, state });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("latest pvt: null with null age before any data, then the message", async () => {
  await withServer(async ({ base, state }) => {
    let r = await (await fetch(`${base}/api/latest/pvt`)).json();
    assert.deepEqual(r, { ok: true, pvt: null, age_ms: null });

    state.setLatestPvt({ type: "pvt", lat: 41.2 });
    r = await (await fetch(`${base}/api/latest/pvt`)).json();
    assert.equal(r.pvt.lat, 41.2);
    assert.equal(typeof r.age_ms, "number");
  });
});

test("configs and status are exposed", async () => {
  await withServer(async ({ base }) => {
    const configs = await (await fetch(`${base}/api/gnss/configs`)).json();
    assert.deepEqual(configs.configs, [{ id: "gps-l1ca-file", label: "File" }]);
    const status = await (await fetch(`${base}/api/gnss/status`)).json();
    assert.equal(status.running, false);
  });
});

test("start: needs a JSON body naming a configuration", async () => {
  await withServer(async ({ base, controller }) => {
    let res = await fetch(`${base}/api/gnss/start`, json({ config: "gps-l1ca-file" }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).running, true);

    res = await fetch(`${base}/api/gnss/start`, json({}));
    assert.equal(res.status, 400);

    res = await fetch(`${base}/api/gnss/start`, json({ config: "nope" }));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /Unknown configuration/);

    assert.deepEqual(controller.calls, [
      ["start", "gps-l1ca-file"],
      ["start", "nope"]
    ]);
  });
});

// Regression: the API used to send "Access-Control-Allow-Origin: *" and accept
// any POST, so any web page open in a browser on the LAN could start or stop
// the receiver. A form/plain-text POST (a CORS "simple request") must be refused.
test("cross-site requests cannot control the receiver", async () => {
  await withServer(async ({ base, controller }) => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
      const res = await fetch(`${base}/api/gnss/stop`, { method: "POST", headers: { "Content-Type": type }, body: "{}" });
      assert.equal(res.status, 415, type);
    }
    const bare = await fetch(`${base}/api/gnss/stop`, { method: "POST" });
    assert.equal(bare.status, 415);
    assert.deepEqual(controller.calls, []);

    const ok = await fetch(`${base}/api/gnss/stop`, json({}));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(controller.calls, [["stop"]]);
  });
});

test("the UI and its libraries are served locally", async () => {
  await withServer(async ({ base }) => {
    for (const route of ["/", "/summary", "/stats", "/app.js", "/styles.css"]) {
      assert.equal((await fetch(base + route)).status, 200, route);
    }
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /https?:\/\/(cdn|unpkg)\./, "index.html must not load scripts from a CDN");
    for (const route of ["/vendor/chart.umd.js", "/vendor/leaflet/leaflet.js", "/vendor/leaflet/leaflet.css", "/vendor/leaflet/images/marker-icon.png"]) {
      assert.equal((await fetch(base + route)).status, 200, route);
    }
  });
});
