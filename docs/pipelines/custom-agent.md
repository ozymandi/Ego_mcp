# Your own agent loop

Any OpenAI-compatible model plus a few dozen lines of code: the same pattern
`scripts/eval/run-live.mjs` uses. Useful for automation (nightly design
checks, bulk edits from a spreadsheet) and for evals.

## Pattern

1. Start the server in-process over an in-memory transport (no stdio,
   no second process), or spawn `dist/server.js` with the SDK's stdio client.
2. `listTools()` → filter by a profile → convert to the model's tool format.
3. Loop: send messages + tools, execute each `tool_call` through the MCP
   client, append the result as a `tool` message, feed images back as
   `image_url` parts, stop when the model returns no tool call.

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";

// 1. capture the server instance instead of letting it bind stdio
let server;
const connect = McpServer.prototype.connect;
McpServer.prototype.connect = async function () { server = this; };
StdioServerTransport.prototype.start = async () => {};
await import(pathToFileURL("E:/Projects/gemma 4 figma mcp/dist/server.js").href);
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await connect.call(server, serverT);
const mcp = new Client({ name: "my-agent", version: "1" });
await mcp.connect(clientT);

// 2. tools for the model (core profile) and the skill as system prompt
const skillBody = (await fs.readFile("skills/figma-mcp/SKILL.md", "utf8")).replace(/^---[\s\S]*?---
/, "");
const profiles = JSON.parse(await fs.readFile("scripts/eval/profiles.json", "utf8"));
const { tools } = await mcp.listTools();
const openaiTools = tools
  .filter((t) => profiles.core.includes(t.name))
  .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

// 3. the loop
const messages = [
  { role: "system", content: skillBody + "\nComplete the task, then reply in one sentence." },
  { role: "user", content: "Recolor every rectangle named Swatch to #22c55e." },
];
for (let turn = 0; turn < 12; turn++) {
  const res = await fetch("http://localhost:1234/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qwen/qwen3.8-27b", messages, tools: openaiTools, max_tokens: 8000 }),
  }).then((r) => r.json());
  const msg = res.choices[0].message;
  messages.push(msg);
  if (!msg.tool_calls?.length) break;
  for (const tc of msg.tool_calls) {
    const r = await mcp.callTool({ name: tc.function.name, arguments: JSON.parse(tc.function.arguments || "{}") });
    const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    messages.push({ role: "tool", tool_call_id: tc.id, content: text });
    for (const img of r.content.filter((c) => c.type === "image"))
      messages.push({ role: "user", content: [{ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } }] });
  }
}
```

The full version with checks, cleanup and reporting is
`scripts/eval/run-live.mjs`; tasks are declared in `scripts/eval/live-tasks.mjs`.

## Without a model

The server is also just a programmatic Figma API. `scripts/smoke-tools.mjs`
calls 34 tools in sequence with no LLM at all; `scripts/smoke-plugin.mjs`
talks to the daemon directly over WebSocket (`{ role: "mcp" }` handshake,
then `{ id, type: "exec", payload: { code } }`).

## Things that matter in a loop

- **`max_tokens`**: Qwen3.8 and Gemma 4 reason before the tool call. Below
  ~2k output tokens they silently return no tool call (`finish_reason:
  length`). Use 8000.
- **Context**: `full` profile ≈ 12k prompt tokens before the conversation;
  load the model with 32k or more.
- **Sequential tools**: run tool calls one at a time; the plugin executes
  snippets sequentially and ids from one call feed the next.
- **Images**: `get_screenshot` and `use_figma { screenshot: true }` return
  `image` content blocks; pass them as `image_url` parts for multimodal
  models, drop them for text-only ones (the file path is in the text).
- **Errors**: `isError` results carry `Hint:` and `safe_to_retry:` lines from
  the plugin; feeding them back unchanged is enough for the model to fix the
  snippet.
- **Cleanup**: snapshot `figma.currentPage.children` ids before a task and
  remove the new ones afterwards when running on a scratch file.
