import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { Request, RequestType, Response } from "./protocol.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BridgeOptions {
  port: number;
  host?: string;
  defaultTimeoutMs?: number;
}

export class PluginBridge {
  private readonly wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly defaultTimeoutMs: number;

  constructor(opts: BridgeOptions) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this.wss = new WebSocketServer({
      port: opts.port,
      host: opts.host ?? "127.0.0.1",
    });

    this.wss.on("connection", (ws) => {
      // Only one plugin instance is supported. Newest connection wins.
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.close(1000, "replaced by new connection");
        } catch {
          // ignore
        }
      }
      this.socket = ws;
      console.error("[bridge] plugin connected");

      ws.on("message", (data) => this.handleMessage(data.toString()));
      ws.on("close", () => {
        if (this.socket === ws) {
          this.socket = null;
        }
        console.error("[bridge] plugin disconnected");
        // Fail every pending request — they will not be answered.
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("Plugin disconnected before response"));
          this.pending.delete(id);
        }
      });
      ws.on("error", (err) => {
        console.error("[bridge] socket error:", err);
      });
    });

    this.wss.on("listening", () => {
      const addr = this.wss.address();
      const shown =
        addr === null
          ? "(unknown address)"
          : typeof addr === "string"
            ? addr
            : `${addr.address}:${addr.port}`;
      console.error(`[bridge] listening on ws://${shown}`);
    });
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  async send<T = unknown>(
    type: RequestType,
    payload?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(
        "Figma plugin is not connected. Install and run the 'Gemma 4 MCP Bridge' plugin in Figma.",
      );
    }
    const id = randomUUID();
    const req: Request = { id, type, payload };
    const json = JSON.stringify(req);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Plugin request '${type}' timed out`));
      }, timeoutMs ?? this.defaultTimeoutMs);

      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });

      this.socket!.send(json, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: Response;
    try {
      msg = JSON.parse(raw) as Response;
    } catch (err) {
      console.error("[bridge] malformed message from plugin:", raw);
      return;
    }
    if (!msg || typeof msg.id !== "string") {
      console.error("[bridge] missing id in message:", raw);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) {
      // Plugin pushed something unsolicited — ignore silently for now.
      return;
    }
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg.result);
    } else {
      p.reject(new Error(msg.error ?? "Plugin returned an error"));
    }
  }

  close(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Bridge shutting down"));
    }
    this.pending.clear();
    if (this.socket) {
      try {
        this.socket.close(1000, "server shutting down");
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.wss.close();
  }
}
