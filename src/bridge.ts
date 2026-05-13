import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { RequestType } from "./protocol.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BridgeOptions {
  url: string;
  defaultTimeoutMs?: number;
  reconnectDelayMs?: number;
}

// WebSocket client that talks to the bridge daemon. The daemon owns the
// listening socket and the plugin handle; this class is just a transport
// for the MCP server.
export class PluginBridge {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly defaultTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly url: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(opts: BridgeOptions) {
    this.url = opts.url;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 2_000;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      console.error(`[bridge-client] connected to ${this.url}`);
      ws.send(JSON.stringify({ role: "mcp" }));
    });

    ws.on("message", (raw) => {
      let msg: { id?: string; ok?: boolean; result?: unknown; error?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg.id) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? "Plugin returned an error"));
    });

    ws.on("close", () => {
      if (this.ws === ws) this.ws = null;
      // Don't immediately fail pending; the reconnect may resolve them via
      // a retry. But the daemon won't replay, so they will time out — that's
      // fine, the MCP client will see a timeout error.
      if (!this.closed) {
        console.error(
          `[bridge-client] disconnected from daemon; retrying in ${this.reconnectDelayMs}ms`,
        );
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      // Suppress noisy reconnect spam; the close handler will retry.
      if (this.pending.size > 0) {
        console.error("[bridge-client] socket error:", err.message);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async send<T = unknown>(
    type: RequestType,
    payload?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(
        `Bridge daemon not reachable at ${this.url}. Start it with 'npm run bridge' in this project directory.`,
      );
    }
    const id = randomUUID();
    const req = { id, type, payload };
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

      this.ws!.send(json, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Bridge client shutting down"));
    }
    this.pending.clear();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
