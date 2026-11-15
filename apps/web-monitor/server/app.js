// server/app.js
// Builds the Express application. Kept separate from server.js (which opens
// sockets) so the HTTP API can be exercised in tests.
const fs = require("fs");
const path = require("path");
const express = require("express");

// Browser libraries served from the installed npm packages instead of a CDN,
// so the UI also works on a receiver without Internet access.
const VENDOR_FILES = {
  "/vendor/chart.umd.js": ["chart.js", "dist/chart.umd.js"],
  "/vendor/leaflet/leaflet.js": ["leaflet", "dist/leaflet.js"],
  "/vendor/leaflet/leaflet.css": ["leaflet", "dist/leaflet.css"]
};
const VENDOR_DIRS = {
  "/vendor/leaflet/images": ["leaflet", "dist/images"]
};

function createApp({ cfg, state, controller }) {
  const app = express();
  const publicDir = path.join(cfg.APP_ROOT, "public");
  const modulesDir = path.join(cfg.APP_ROOT, "node_modules");

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  // ---- static files -------------------------------------------------------
  app.use(express.static(publicDir));
  for (const [route, [pkg, rel]] of Object.entries(VENDOR_FILES)) {
    const file = path.join(modulesDir, pkg, rel);
    app.get(route, (req, res) => {
      if (!fs.existsSync(file)) {
        res.status(404).type("text/plain").send(`${pkg} is not installed (run "npm install")`);
        return;
      }
      res.sendFile(file);
    });
  }
  for (const [route, [pkg, rel]] of Object.entries(VENDOR_DIRS)) {
    app.use(route, express.static(path.join(modulesDir, pkg, rel)));
  }

  // ---- state-changing requests -------------------------------------------
  // No CORS headers are sent, and POSTs must be JSON: a JSON content type is
  // not a "simple" cross-origin request, so another web page cannot start or
  // stop the receiver behind the user's back.
  function requireJson(req, res, next) {
    // Checked on the header itself: req.is() returns null for an empty body.
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      res.status(415).json({ ok: false, error: "Content-Type must be application/json" });
      return;
    }
    next();
  }

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error("API error:", e);
      if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
    });
  };

  // ---- API: latest data ---------------------------------------------------
  app.get("/api/latest/pvt", (req, res) => {
    // pvt is null when stale or never received; age_ms is null if never received.
    res.json({ ok: true, pvt: state.getLatestPvt(), age_ms: state.getPvtAgeMs() });
  });

  app.get("/api/latest/observables", (req, res) => {
    const limit = Number(req.query.limit ?? 64);
    const observables = state.getLatestObservables({ limit: Number.isFinite(limit) && limit >= 0 ? limit : 64 });
    res.json({ ok: true, meta: state.getLatestObservablesMeta(), observables });
  });

  // ---- API: receiver control ----------------------------------------------
  app.get(
    "/api/gnss/configs",
    wrap(async (req, res) => {
      res.json({ ok: true, backend: controller.backend, configs: await controller.listConfigs() });
    })
  );

  app.get(
    "/api/gnss/status",
    wrap(async (req, res) => {
      res.json(await controller.status());
    })
  );

  app.post(
    "/api/gnss/start",
    requireJson,
    wrap(async (req, res) => {
      const id = req.body && req.body.config;
      if (typeof id !== "string" || id === "") {
        res.status(400).json({ ok: false, error: 'Request body must be {"config": "<id>"} (see /api/gnss/configs)' });
        return;
      }
      const result = await controller.start(id);
      res.status(result.ok ? 200 : 409).json(result);
    })
  );

  app.post(
    "/api/gnss/stop",
    requireJson,
    wrap(async (req, res) => {
      const result = await controller.stop();
      res.status(result.ok ? 200 : 409).json(result);
    })
  );

  // ---- SPA routes (after the API) -----------------------------------------
  app.get(["/", "/summary", "/historics", "/stats", "/observables"], (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}

module.exports = { createApp };
