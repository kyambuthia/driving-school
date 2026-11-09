import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { WebSocketServer } from "ws";

function ndotoAgentBridge() {
  return {
    name: "ndoto-agent-bridge",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      const clients = new Set();

      wss.on("connection", (ws) => {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "hello", ok: true, msg: "ndoto agent bridge" }));
        ws.on("message", (data) => {
          let msg;
          try { msg = JSON.parse(String(data)); } catch { return; }
          // Broadcast intents/commands to other clients? Primarily: agent -> browser intent.
          // Browser also sends obs; we can forward obs to non-sender clients (agents).
          for (const c of clients) {
            if (c !== ws && c.readyState === 1) c.send(JSON.stringify(msg));
          }
        });
        ws.on("close", () => clients.delete(ws));
        ws.on("error", () => clients.delete(ws));
      });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = req.url || "";
        if (url.startsWith("/__ndoto_agent")) {
          wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
        }
        // let Vite handle its own HMR upgrades
      });

      server.middlewares.use("/__ndoto_agent/status", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, clients: clients.size }));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ndotoAgentBridge()],
})
