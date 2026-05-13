// Runs inside the plugin's UI iframe. Holds the WebSocket connection to the
// MCP server and forwards messages between the bridge and the plugin sandbox
// via figma's postMessage channel.

interface ParentEnvelope {
  pluginMessage: unknown;
  pluginId?: string;
}

const $ = (id: string) => document.getElementById(id)!;
const statusDot = $("status-dot");
const statusText = $("status-text");
const urlInput = $("url") as HTMLInputElement;
const reconnectBtn = $("reconnect") as HTMLButtonElement;
const logEl = $("log");

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let manualClose = false;

function log(line: string) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${line}\n${logEl.textContent ?? ""}`.slice(0, 4000);
}

function setStatus(state: "ok" | "warn" | "err", text: string) {
  statusDot.classList.remove("ok", "warn");
  if (state === "ok") statusDot.classList.add("ok");
  if (state === "warn") statusDot.classList.add("warn");
  statusText.textContent = text;
}

function toSandbox(msg: unknown) {
  parent.postMessage({ pluginMessage: msg } as ParentEnvelope, "*");
}

function connect(url: string) {
  manualClose = false;
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  setStatus("warn", `connecting to ${url}…`);
  try {
    ws = new WebSocket(url);
  } catch (err) {
    log(`ws init failed: ${(err as Error).message}`);
    scheduleReconnect(url);
    return;
  }

  ws.addEventListener("open", () => {
    setStatus("ok", `connected to ${url}`);
    log("connected");
    // Declare role to the bridge daemon. Without this, the daemon will not
    // route messages to/from this socket.
    try {
      ws!.send(JSON.stringify({ role: "plugin" }));
    } catch (err) {
      log(`role send failed: ${(err as Error).message}`);
    }
    toSandbox({ kind: "bridge-status", connected: true });
  });

  ws.addEventListener("close", (ev) => {
    setStatus("err", `disconnected (${ev.code})`);
    log(`closed: ${ev.code} ${ev.reason || ""}`);
    toSandbox({ kind: "bridge-status", connected: false });
    if (!manualClose) scheduleReconnect(url);
  });

  ws.addEventListener("error", () => {
    log("socket error");
  });

  ws.addEventListener("message", (ev) => {
    let data: unknown;
    try {
      data = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch (err) {
      log(`bad message: ${(err as Error).message}`);
      return;
    }
    // Forward the wire request to the sandbox.
    toSandbox({ kind: "request", request: data });
  });
}

function scheduleReconnect(url: string) {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect(url);
  }, 2000);
}

// Messages from the sandbox — primarily responses for the MCP server.
window.addEventListener("message", (event) => {
  const data = (event.data as ParentEnvelope | undefined)?.pluginMessage;
  if (!data || typeof data !== "object") return;
  const msg = data as { kind?: string; response?: unknown };
  if (msg.kind === "response" && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg.response));
  }
});

reconnectBtn.addEventListener("click", () => {
  manualClose = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connect(urlInput.value.trim() || "ws://localhost:7575");
});

// Auto-connect on load.
connect(urlInput.value.trim() || "ws://localhost:7575");
