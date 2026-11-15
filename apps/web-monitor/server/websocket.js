// server/websocket.js
const WebSocket = require("ws");

let wss = null;

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    console.log("🔌 WebSocket client connected");
    ws.on("close", () => console.log("🔌 WebSocket client disconnected"));
  });

  console.log("✅ WebSocket server initialized on /ws");
}

function broadcast(obj) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
      } catch (e) {
        console.error("WS send error:", e.message);
      }
    }
  });
}

module.exports = {
  initWebSocket,
  broadcast
};
