#!/usr/bin/env node
// server/server.js
// GNSS-SDR web monitor: HTTP API + static UI + WebSocket push, fed by the
// GNSS-SDR UDP monitor streams.
const http = require("http");

const cfg = require("./config");
const { createApp } = require("./app");
const { createState } = require("./state");
const { createController } = require("./gnss_control");
const { initWebSocket, broadcast } = require("./websocket");
const { initUdpReceivers } = require("./udp_handlers");

async function main() {
  const state = createState({ ttlMs: cfg.TTL_MS });
  const controller = createController(cfg);
  const app = createApp({ cfg, state, controller });
  const server = http.createServer(app);

  initWebSocket(server);

  const udp = await initUdpReceivers(cfg, {
    onPvt(msg) {
      state.setLatestPvt(msg);
      broadcast(msg);
    },
    onObservables(samples) {
      state.updateLatestObservables(samples);
      broadcast(samples);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.HTTP_PORT, cfg.HTTP_HOST, resolve);
  });
  console.log(`Web monitor listening on http://${cfg.HTTP_HOST}:${cfg.HTTP_PORT}`);
  console.log(`Receiver control backend: ${controller.backend}; configurations from ${cfg.GNSS_CONF_DIR}`);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    udp.close();
    // In spawn mode the receiver is our child: do not leave it orphaned.
    if (controller.backend === "spawn") {
      await controller.stop().catch(() => {});
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
