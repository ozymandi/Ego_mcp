#!/usr/bin/env node
// Tool-selection eval for local models.
//
// Feeds each prompt in cases.json to an OpenAI-compatible chat endpoint
// (LM Studio by default) together with this server's real tool list, and
// scores the FIRST tool call: right tool? right arguments? It never touches
// Figma, so it is safe to run any time the model server is up.
//
//   node scripts/eval/run-eval.mjs --model qwen3.8-27b --profile core
//   node scripts/eval/run-eval.mjs --profile full --skill --limit 5
//
// Options
//   --model <id>        model id as the server lists it (default: first of /v1/models)
//   --profile <name>    core | design | full (scripts/eval/profiles.json), default core
//   --skill             prepend skills/figma-mcp/SKILL.md as the system prompt
//   --base-url <url>    default EVAL_BASE_URL or http://localhost:1234/v1
//   --cases <file>      default scripts/eval/cases.json
//   --limit <n>         run only the first n applicable cases
//   --runs <n>          repeat each case n times (default 1); pass rate is averaged
//   --temperature <t>   default 0
//
// Writes .eval/<timestamp>_<model>_<profile>.json and prints a summary table.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const baseUrl = (opt("base-url", process.env.EVAL_BASE_URL ?? "http://localhost:1234/v1")).replace(/\/$/, "");
const profileName = opt("profile", "core");
const useSkill = flag("skill");
const limit = Number(opt("limit", 0)) || 0;
const runs = Number(opt("runs", 1)) || 1;
const temperature = Number(opt("temperature", 0)) || 0;
const casesFile = opt("cases", path.join(here, "cases.json"));

// ---- tool list from the real server --------------------------------------
let captured = null;
const origConnect = McpServer.prototype.connect;
McpServer.prototype.connect = async function () {
  captured = this;
};
StdioServerTransport.prototype.start = async function () {};
process.env.FIGMA_TOKEN ||= "placeholder";
await import(pathToFileURL(path.join(root, "dist", "server.js")).href);
const [ct, st] = InMemoryTransport.createLinkedPair();
await origConnect.call(captured, st);
const mcp = new Client({ name: "eval", version: "0" });
await mcp.connect(ct);
const { tools: allTools } = await mcp.listTools();
await mcp.close();

const profiles = JSON.parse(readFileSync(path.join(here, "profiles.json"), "utf8"));
if (!(profileName in profiles)) throw new Error(`unknown profile ${profileName}`);
const include = profiles[profileName];
const tools = include ? allTools.filter((t) => include.includes(t.name)) : allTools;
const openaiTools = tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
}));
const toolBytes = JSON.stringify(openaiTools).length;

// ---- model ---------------------------------------------------------------
async function api(pathname, init) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EVAL_API_KEY ?? "lm-studio"}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

let model = opt("model", process.env.EVAL_MODEL);
if (!model) {
  const list = await api("/models");
  model = list.data?.[0]?.id;
  if (!model) throw new Error("no model loaded on the server; pass --model");
}

const systemPrompt = useSkill
  ? readFileSync(path.join(root, "skills", "figma-mcp", "SKILL.md"), "utf8").replace(/^---[\s\S]*?---\n/, "")
  : "You control Figma through the provided tools. The bridge daemon and the Figma plugin are connected and a design file is open. When the user asks for an action, call the matching tool directly; do not ask clarifying questions.";

// ---- scoring -------------------------------------------------------------
function matchValue(expected, actual) {
  if (expected && typeof expected === "object" && "$re" in expected) {
    return typeof actual === "string" && new RegExp(expected.$re, "i").test(actual);
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => matchValue(e, actual[i]));
  }
  if (typeof expected === "number") return typeof actual === "number" && Math.abs(actual - expected) <= 0.5;
  if (expected && typeof expected === "object") {
    return actual && typeof actual === "object" && Object.entries(expected).every(([k, v]) => matchValue(v, actual[k]));
  }
  return expected === actual;
}

function score(c, call) {
  const wantTools = c.tool === null ? [] : Array.isArray(c.tool) ? c.tool : [c.tool];
  if (!call) return { toolOk: c.tool === null, argsOk: c.tool === null, reason: c.tool === null ? "" : "no tool call" };
  if (c.tool === null) return { toolOk: false, argsOk: false, reason: `called ${call.name} but no tool expected` };
  const toolOk = wantTools.includes(call.name);
  if (!toolOk) return { toolOk, argsOk: false, reason: `called ${call.name}, wanted ${wantTools.join("|")}` };
  let args = {};
  try {
    args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : call.arguments ?? {};
  } catch (e) {
    return { toolOk, argsOk: false, reason: `arguments not JSON: ${e.message}` };
  }
  const expected = (c.args_for && c.args_for[call.name]) ?? c.args ?? {};
  const bad = Object.entries(expected).filter(([k, v]) => !matchValue(v, args[k])).map(([k]) => k);
  return { toolOk, argsOk: bad.length === 0, reason: bad.length ? `args off: ${bad.join(", ")} -> ${JSON.stringify(args)}` : "" };
}

// ---- run -----------------------------------------------------------------
let cases = JSON.parse(readFileSync(casesFile, "utf8")).filter((c) => !c.profiles || c.profiles.includes(profileName));
if (limit) cases = cases.slice(0, limit);

console.log(`model=${model}  profile=${profileName} (${tools.length} tools, ${toolBytes.toLocaleString()} bytes)  skill=${useSkill}  cases=${cases.length}  runs=${runs}`);
const results = [];
for (const c of cases) {
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now();
    let call = null;
    let text = "";
    let usage = null;
    let error = null;
    try {
      const res = await api("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: 8000, // thinking models reason before the tool call
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: c.prompt },
          ],
          tools: openaiTools,
          tool_choice: "auto",
        }),
      });
      const choice = res.choices?.[0] ?? {};
      const msg = choice.message ?? {};
      usage = res.usage ?? null;
      text = (msg.content ?? "").slice(0, 200);
      const tc = msg.tool_calls?.[0];
      if (tc?.function) call = { name: tc.function.name, arguments: tc.function.arguments };
      else if (choice.finish_reason === "length") error = `output cut at max_tokens (finish_reason=length)`;
    } catch (e) {
      error = e.message;
    }
    const s = error ? { toolOk: false, argsOk: false, reason: error } : score(c, call);
    const row = { id: c.id, run: r, ms: Date.now() - t0, call, text, usage, ...s };
    results.push(row);
    const mark = s.toolOk && s.argsOk ? "PASS" : s.toolOk ? "ARGS" : "FAIL";
    console.log(`${mark}  ${c.id.padEnd(12)} ${String(row.ms).padStart(6)}ms  ${s.reason}`);
  }
}

const n = results.length;
const toolPass = results.filter((r) => r.toolOk).length;
const fullPass = results.filter((r) => r.toolOk && r.argsOk).length;
const promptTokens = results.map((r) => r.usage?.prompt_tokens).filter((x) => typeof x === "number");
const avgPrompt = promptTokens.length ? Math.round(promptTokens.reduce((a, b) => a + b, 0) / promptTokens.length) : null;
const avgMs = Math.round(results.reduce((a, r) => a + r.ms, 0) / n);
console.log(`\ntool choice: ${toolPass}/${n} (${Math.round((100 * toolPass) / n)}%)   tool+args: ${fullPass}/${n} (${Math.round((100 * fullPass) / n)}%)   avg prompt tokens: ${avgPrompt ?? "n/a"}   avg latency: ${avgMs} ms`);

const outDir = path.join(root, ".eval");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(outDir, `${stamp}_${model.replace(/[^a-z0-9._-]+/gi, "_")}_${profileName}${useSkill ? "_skill" : ""}.json`);
writeFileSync(outFile, JSON.stringify({ model, profile: profileName, skill: useSkill, tools: tools.length, toolBytes, summary: { n, toolPass, fullPass, avgPrompt, avgMs }, results }, null, 1));
console.log(`saved ${outFile}`);
process.exit(0);
