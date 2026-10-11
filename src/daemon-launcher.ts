// Starts the bridge daemon on demand so no client needs start-bridge.bat:
// whichever MCP client spawns this server first brings the daemon up as a
// detached process that outlives the MCP server. The plugin reconnects to
// the port every two seconds, so it picks the daemon up by itself.

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";

export type DaemonStart =
  | { state: "running" }
  | { state: "started"; pid: number | undefined; log: string }
  | { state: "failed"; log: string; reason: string }
  | { state: "disabled"; reason: string };

function portOpen(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (v: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ensures a daemon is listening for `bridgeUrl`. Only acts for localhost
 * URLs; a remote daemon is somebody else's job. `distDir` is where
 * daemon.js lives (next to server.js); the log goes to the project root.
 */
export async function ensureDaemon(bridgeUrl: string, distDir: string): Promise<DaemonStart> {
  if (process.env.FIGMA_BRIDGE_AUTOSTART === "0") {
    return { state: "disabled", reason: "FIGMA_BRIDGE_AUTOSTART=0" };
  }
  let host = "localhost";
  let port = 7575;
  try {
    const u = new URL(bridgeUrl);
    host = u.hostname;
    port = Number(u.port || 7575);
  } catch {
    return { state: "disabled", reason: `unparseable FIGMA_BRIDGE_URL ${bridgeUrl}` };
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    return { state: "disabled", reason: `daemon host ${host} is not local` };
  }
  if (await portOpen(host, port)) return { state: "running" };

  // Running from dist/ normally; from src/ via tsx, fall back to ../dist.
  let daemonPath = path.join(distDir, "daemon.js");
  if (!existsSync(daemonPath)) daemonPath = path.resolve(distDir, "..", "dist", "daemon.js");
  const projectRoot = path.resolve(distDir, "..");
  if (!existsSync(daemonPath)) {
    return { state: "failed", log: path.join(projectRoot, "daemon.log"), reason: `daemon.js not found (run npm run build)` };
  }
  const log = path.join(projectRoot, "daemon.log");
  let pid: number | undefined;
  try {
    const fd = openSync(log, "a");
    const child = spawn(process.execPath, [daemonPath], {
      cwd: projectRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, FIGMA_BRIDGE_PORT: String(port) },
    });
    child.unref();
    closeSync(fd);
    pid = child.pid;
  } catch (err) {
    return { state: "failed", log, reason: err instanceof Error ? err.message : String(err) };
  }

  for (let i = 0; i < 25; i++) {
    await sleep(200);
    if (await portOpen(host, port)) return { state: "started", pid, log };
  }
  return { state: "failed", log, reason: `port ${port} did not open within 5 s; see ${log}` };
}
