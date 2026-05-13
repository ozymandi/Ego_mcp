#!/usr/bin/env node
// Standalone bridge daemon. Holds a long-lived WebSocket server on
// FIGMA_BRIDGE_PORT (default 7575) and routes wire messages between the
// Figma plugin (one allowed) and any number of MCP server processes.
//
// Roles are declared by the first message a client sends:
//   { role: "plugin" }  — exec/get_* requests are forwarded TO this socket
//   { role: "mcp" }     — requests come FROM this socket, replies go back here
//
// The daemon keeps a map of request id -> originating mcp socket so plugin
// responses are routed back to the correct caller.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

const port = Number(process.env.FIGMA_BRIDGE_PORT ?? 7575);

const wss = new WebSocketServer({ port });

let plugin: WebSocket | null = null;
const mcps = new Set<WebSocket>();
const pending = new Map<string, WebSocket>(); // request id -> origin mcp socket

interface RoleMessage {
  role: "plugin" | "mcp";
}

interface RequestMessage {
  id: string;
  type: string;
  payload?: unknown;
}

interface ResponseMessage {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

type WireMessage = Partial<RoleMessage & RequestMessage & ResponseMessage>;

function safeSend(ws: WebSocket, data: string) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(data);
  } catch (err) {
    console.error("[daemon] send error:", (err as Error).message);
  }
}

wss.on("connection", (ws) => {
  let role: "plugin" | "mcp" | null = null;

  ws.on("message", (raw) => {
    let msg: WireMessage;
    try {
      msg = JSON.parse(raw.toString()) as WireMessage;
    } catch (err) {
      console.error("[daemon] bad json:", (err as Error).message);
      return;
    }

    // Role handshake — must be the first message.
    if (msg.role && !role) {
      if (msg.role === "plugin") {
        if (plugin && plugin !== ws && plugin.readyState === WebSocket.OPEN) {
          plugin.close(1000, "replaced by new plugin connection");
        }
        plugin = ws;
        role = "plugin";
        console.error("[daemon] plugin connected");
      } else if (msg.role === "mcp") {
        mcps.add(ws);
        role = "mcp";
        console.error(`[daemon] mcp connected (${mcps.size} active)`);
      } else {
        console.error("[daemon] unknown role:", msg.role);
        ws.close(1008, "unknown role");
      }
      return;
    }

    if (!role) {
      console.error("[daemon] message before role handshake; closing");
      ws.close(1008, "expected role first");
      return;
    }

    if (role === "mcp") {
      // Forward a request to the plugin.
      if (typeof msg.id !== "string" || typeof msg.type !== "string") {
        console.error("[daemon] mcp sent malformed request");
        return;
      }
      if (!plugin || plugin.readyState !== WebSocket.OPEN) {
        const errResp: ResponseMessage = {
          id: msg.id,
          ok: false,
          error: "Figma plugin not connected to bridge daemon",
        };
        safeSend(ws, JSON.stringify(errResp));
        return;
      }
      pending.set(msg.id, ws);
      safeSend(plugin, JSON.stringify(msg));
    } else if (role === "plugin") {
      // Forward a response back to whichever mcp issued the request.
      if (typeof msg.id !== "string") return;
      const target = pending.get(msg.id);
      pending.delete(msg.id);
      if (target && target.readyState === WebSocket.OPEN) {
        safeSend(target, JSON.stringify(msg));
      }
    }
  });

  ws.on("close", () => {
    if (role === "plugin" && plugin === ws) {
      plugin = null;
      console.error("[daemon] plugin disconnected");
      // Notify all waiting MCPs that their requests cannot be fulfilled.
      for (const [id, target] of pending) {
        const errResp: ResponseMessage = {
          id,
          ok: false,
          error: "Figma plugin disconnected before response",
        };
        safeSend(target, JSON.stringify(errResp));
      }
      pending.clear();
    } else if (role === "mcp") {
      mcps.delete(ws);
      for (const [id, target] of pending) {
        if (target === ws) pending.delete(id);
      }
      console.error(`[daemon] mcp disconnected (${mcps.size} active)`);
    }
  });

  ws.on("error", (err) => {
    console.error("[daemon] socket error:", err.message);
  });
});

wss.on("listening", () => {
  const addr = wss.address();
  const shown =
    addr === null
      ? "(unknown)"
      : typeof addr === "string"
        ? addr
        : `${addr.address}:${addr.port}`;
  console.error(`[daemon] listening on ws://${shown}`);
});

wss.on("error", (err) => {
  console.error("[daemon] fatal:", err);
  process.exit(1);
});

function shutdown() {
  console.error("[daemon] shutting down");
  for (const client of wss.clients) {
    try {
      client.close(1001, "daemon shutting down");
    } catch {
      // ignore
    }
  }
  wss.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
