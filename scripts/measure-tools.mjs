#!/usr/bin/env node
// Measures what an MCP client actually receives from tools/list: bytes and a
// rough token estimate, overall and per tool. Runs the real server in-process
// over an in-memory transport, so no daemon, token or Figma is needed.
//
// Usage: node scripts/measure-tools.mjs [--top N] [--json]

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const args = process.argv.slice(2);
const top = Number(args[args.indexOf("--top") + 1]) || 10;
const asJson = args.includes("--json");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Capture the server instance instead of letting it bind stdio.
let captured = null;
const origConnect = McpServer.prototype.connect;
McpServer.prototype.connect = async function () {
  captured = this;
};
StdioServerTransport.prototype.start = async function () {};
process.env.FIGMA_TOKEN ||= "placeholder";
await import(pathToFileURL(path.join(root, "dist", "server.js")).href);
if (!captured) throw new Error("server instance not captured");

const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await origConnect.call(captured, serverT);
const client = new Client({ name: "measure", version: "0" });
await client.connect(clientT);

const { tools } = await client.listTools();
const wire = JSON.stringify(tools);
const perTool = tools
  .map((t) => ({ name: t.name, bytes: JSON.stringify(t).length }))
  .sort((a, b) => b.bytes - a.bytes);
const est = (b) => Math.round(b / 3.6);

if (asJson) {
  console.log(JSON.stringify({ count: tools.length, bytes: wire.length, tokens: est(wire.length), perTool }, null, 1));
} else {
  console.log(`tools: ${tools.length}`);
  console.log(`tools/list payload: ${wire.length.toLocaleString()} bytes (~${est(wire.length).toLocaleString()} tokens at 3.6 chars/token)`);
  console.log(`average per tool: ${Math.round(wire.length / tools.length)} bytes`);
  console.log(`heaviest ${top}:`);
  for (const t of perTool.slice(0, top)) console.log(`  ${t.name.padEnd(28)} ${t.bytes}`);
}
await client.close();
process.exit(0);
