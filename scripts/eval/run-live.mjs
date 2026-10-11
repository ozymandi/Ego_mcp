#!/usr/bin/env node
// Multi-step LIVE eval: the model drives the real MCP server (-> daemon ->
// plugin -> Figma desktop) in an agent loop until it stops calling tools, then
// a deterministic check inspects the canvas. Needs the daemon running, the
// plugin connected and an OpenAI-compatible model server.
//
//   node scripts/eval/run-live.mjs --model qwen/qwen3.8-27b --profile design --skill
//   node scripts/eval/run-live.mjs --tasks card,recolor --max-turns 8
//
// Options: --model, --profile core|design|full (default design), --skill,
//          --tasks a,b,c, --max-turns N (default 12), --no-vision (do not feed
//          screenshots back as images), --base-url, --temperature.
//
// Every page-level node created during a task is deleted afterwards.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TASKS } from "./live-tasks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const baseUrl = (opt("base-url", process.env.EVAL_BASE_URL ?? "http://localhost:1234/v1")).replace(/\/$/, "");
const profileName = opt("profile", "design");
const useSkill = flag("skill");
const vision = !flag("no-vision");
const maxTurnsRaw = Number(opt("max-turns", 12));
const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw >= 0 ? maxTurnsRaw : 12;
const temperature = Number(opt("temperature", 0)) || 0;
const onlyTasks = opt("tasks", "").split(",").filter(Boolean);

// ---- real server over in-memory transport --------------------------------
let captured = null;
const origConnect = McpServer.prototype.connect;
McpServer.prototype.connect = async function () {
  captured = this;
};
StdioServerTransport.prototype.start = async function () {};
await import(pathToFileURL(path.join(root, "dist", "server.js")).href);
const [ct, st] = InMemoryTransport.createLinkedPair();
await origConnect.call(captured, st);
const mcp = new Client({ name: "live-eval", version: "0" });
await mcp.connect(ct);

async function callTool(name, args) {
  const res = await mcp.callTool({ name, arguments: args ?? {} });
  const text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const images = res.content.filter((c) => c.type === "image").map((c) => `data:${c.mimeType};base64,${c.data}`);
  return { ok: !res.isError, text, images };
}
async function snippet(code) {
  const r = await callTool("use_figma", { code });
  if (!r.ok) throw new Error(`snippet failed: ${r.text}`);
  const data = JSON.parse(r.text);
  return data.result;
}

// wait for daemon + plugin
let status = null;
for (let i = 0; i < 25 && status?.plugin !== "connected"; i++) {
  const r = await callTool("bridge_status");
  try {
    status = JSON.parse(r.text);
  } catch {
    status = null;
  }
  if (status?.plugin !== "connected") await new Promise((r) => setTimeout(r, 200));
}
if (status?.plugin !== "connected") {
  console.error("plugin not connected:", JSON.stringify(status));
  process.exit(1);
}

const { tools: allTools } = await mcp.listTools();
const profiles = JSON.parse(readFileSync(path.join(here, "profiles.json"), "utf8"));
const include = profiles[profileName];
const tools = include ? allTools.filter((t) => include.includes(t.name)) : allTools;
const openaiTools = tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
}));
const toolNames = new Set(tools.map((t) => t.name));

// ---- model ---------------------------------------------------------------
async function api(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EVAL_API_KEY ?? "lm-studio"}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
let model = opt("model", process.env.EVAL_MODEL);
if (!model) {
  model = (await api("/models")).data?.[0]?.id;
  if (!model) throw new Error("no model loaded; pass --model");
}

const skillBody = readFileSync(path.join(root, "skills", "figma-mcp", "SKILL.md"), "utf8").replace(/^---[\s\S]*?---\n/, "");
const systemPrompt =
  (useSkill ? skillBody + "\n\n" : "") +
  "You are operating Figma through the provided tools. The bridge daemon and the Figma plugin are connected and a design file is open on its current page. Complete the user's task by calling tools; use node ids returned by earlier calls. When the task is done, stop calling tools and reply with one short sentence. Do not ask questions.";

// ---- runner ---------------------------------------------------------------
const pageSnapshot = async () => snippet(`return figma.currentPage.children.map(n => n.id);`);
const cleanup = async (before) =>
  snippet(`
    const keep = new Set(${JSON.stringify(before)});
    let removed = 0;
    for (const n of [...figma.currentPage.children]) if (!keep.has(n.id)) { try { n.remove(); removed++; } catch (e) {} }
    return removed;
  `);

const tasks = TASKS.filter((t) => !onlyTasks.length || onlyTasks.includes(t.id)).filter((t) => !t.profiles || t.profiles.includes(profileName));
console.log(`model=${model}  profile=${profileName} (${tools.length} tools)  skill=${useSkill}  vision=${vision}  tasks=${tasks.length}  max-turns=${maxTurns}`);

const results = [];
for (const task of tasks) {
  const before = await pageSnapshot();
  if (task.setup) await snippet(task.setup);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task.prompt },
  ];
  const calls = [];
  let turns = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalText = "";
  let error = null;
  const t0 = Date.now();

  try {
    for (; turns < maxTurns; turns++) {
      // Thinking models spend output tokens on reasoning before the tool
      // call; a low cap silently yields "no tool call" with finish_reason=length.
      const res = await api("/chat/completions", { model, temperature, max_tokens: 8000, messages, tools: openaiTools, tool_choice: "auto" });
      promptTokens += res.usage?.prompt_tokens ?? 0;
      completionTokens += res.usage?.completion_tokens ?? 0;
      const choice = res.choices?.[0] ?? {};
      const msg = choice.message ?? {};
      const toolCalls = msg.tool_calls ?? [];
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls.length ? toolCalls : undefined });
      if (!toolCalls.length) {
        finalText = msg.content ?? "";
        if (choice.finish_reason === "length") error = `output cut at max_tokens (finish_reason=length) after ${res.usage?.completion_tokens} tokens`;
        break;
      }
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? "";
        let args = {};
        let argError = null;
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch (e) {
          argError = e.message;
        }
        let out;
        if (!toolNames.has(name)) out = { ok: false, text: `Unknown tool ${name}`, images: [] };
        else if (argError) out = { ok: false, text: `Arguments are not valid JSON: ${argError}`, images: [] };
        else out = await callTool(name, args);
        calls.push({ name, args, ok: out.ok, chars: out.text.length, error: out.ok ? undefined : out.text.slice(0, 400) });
        const summary = out.text.length > 6000 ? out.text.slice(0, 6000) + "\n…[truncated for eval]" : out.text;
        messages.push({ role: "tool", tool_call_id: tc.id, content: summary || "(empty)" });
        if (vision && out.images.length) {
          messages.push({
            role: "user",
            content: [
              { type: "text", text: `Screenshot returned by ${name}:` },
              ...out.images.slice(0, 2).map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          });
        }
      }
    }
  } catch (e) {
    error = e.message;
  }

  let check = { pass: false, reason: error ?? "no check" };
  if (!error) {
    try {
      check = await snippet(task.check);
      if (task.answer && !task.answer.test(finalText)) check = { pass: false, reason: `answer did not match: ${finalText.slice(0, 120)}` };
    } catch (e) {
      check = { pass: false, reason: `check failed: ${e.message}` };
    }
  }
  const ms = Date.now() - t0;
  let removed = 0;
  try {
    removed = await cleanup(before);
  } catch {
    // leave it
  }
  const row = { id: task.id, pass: Boolean(check.pass), reason: check.reason ?? "", turns, calls, promptTokens, completionTokens, ms, finalText: finalText.slice(0, 300), removed };
  results.push(row);
  const seq = calls.map((c) => `${c.name}${c.ok ? "" : "!"}`).join(" > ");
  console.log(`${row.pass ? "PASS" : "FAIL"}  ${task.id.padEnd(19)} ${String(turns).padStart(2)} turns ${String(calls.length).padStart(2)} calls ${String(Math.round(ms / 1000)).padStart(4)}s  ${(promptTokens + completionTokens).toLocaleString().padStart(8)} tok  ${row.reason}`);
  console.log(`      ${seq}`);
}

const passed = results.filter((r) => r.pass).length;
const totalTok = results.reduce((a, r) => a + r.promptTokens + r.completionTokens, 0);
console.log(`\npassed ${passed}/${results.length}   total tokens ${totalTok.toLocaleString()}   total time ${Math.round(results.reduce((a, r) => a + r.ms, 0) / 1000)}s`);

const outDir = path.join(root, ".eval");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(outDir, `${stamp}_live_${model.replace(/[^a-z0-9._-]+/gi, "_")}_${profileName}${useSkill ? "_skill" : ""}.json`);
writeFileSync(outFile, JSON.stringify({ model, profile: profileName, skill: useSkill, vision, maxTurns, summary: { passed, total: results.length, totalTok }, results }, null, 1));
console.log(`saved ${outFile}`);
await mcp.close();
process.exit(0);
