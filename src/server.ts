#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FigmaClient, parseFileKey } from "./figma.js";
import { ok, fail, type ToolResult } from "./result.js";
import { outlineFile, outlineNodes } from "./outline.js";
import { PluginBridge } from "./bridge.js";
import { ensureDaemon, type DaemonStart } from "./daemon-launcher.js";
import { registerCanvasTools } from "./tools-canvas.js";
import { registerHelpTools } from "./tools-help.js";
import { registerLibraryTools } from "./tools-libraries.js";
import { registerCodeConnectTools } from "./tools-code-connect.js";
import { registerDesignSystemTools } from "./tools-design-system.js";
import { registerDiagramTools } from "./tools-diagrams.js";
import { registerFigJamTools } from "./tools-figjam.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { registerFilesystemTools } from "./tools-filesystem.js";
import { registerComponentTools } from "./tools-components.js";
import { registerVariableTools } from "./tools-variables.js";
import { registerSpecTools } from "./tools-spec.js";
import { registerPageTools } from "./tools-pages.js";
import { registerSvgTools } from "./tools-svg.js";
import { registerCritiqueTools } from "./tools-critique.js";

// Resolve .env relative to this script, not process.cwd(). LM Studio (and
// other MCP clients) launch the server from arbitrary working directories.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config({ path: path.resolve(here, "../../.env") }); // when running via tsx from src/

const token = process.env.FIGMA_TOKEN;
if (!token) {
  console.error(
    "[gemma-figma-mcp] FIGMA_TOKEN is not set. Copy .env.example to .env and fill it in.",
  );
  process.exit(1);
}

const figma = new FigmaClient({
  token,
  defaultFileKey: process.env.FIGMA_DEFAULT_FILE_KEY || undefined,
});

const bridgeUrl =
  process.env.FIGMA_BRIDGE_URL ??
  `ws://localhost:${process.env.FIGMA_BRIDGE_PORT ?? 7575}`;
// Bring the bridge daemon up if nobody is listening yet (detached; it
// outlives this process). Clients then only need the plugin running in Figma.
let daemonStart: DaemonStart = await ensureDaemon(bridgeUrl, here);
reportDaemon(daemonStart);
function reportDaemon(d: DaemonStart): void {
  if (d.state === "started") console.error(`[gemma-figma-mcp] bridge daemon autostarted (pid ${d.pid}, log ${d.log})`);
  else if (d.state === "failed") console.error(`[gemma-figma-mcp] bridge daemon autostart failed: ${d.reason}`);
}
const bridge = new PluginBridge({ url: bridgeUrl });

const workspacesFile = path.resolve(here, "../.workspaces.json");
const workspaces = new WorkspaceRegistry(workspacesFile);

const server = new McpServer({
  name: "gemma-figma-mcp",
  version: "0.1.0",
});

const fileKeyArg = z
  .string()
  .min(1)
  .describe("File key or Figma URL. Optional if FIGMA_DEFAULT_FILE_KEY is set.")
  .optional();

const formatArg = z
  .enum(["outline", "raw"])
  .optional()
  .default("outline")
  .describe("'outline' = compact one-line-per-node text (default). 'raw' = full REST JSON (large).");

const maxDepthArg = z
  .number()
  .int()
  .min(0)
  .max(50)
  .optional()
  .describe("Outline only: deepest level to expand. Default 8.");

const maxCharsArg = z
  .number()
  .int()
  .min(1000)
  .optional()
  .describe("Cap on response characters. Default 20000.");

const imageFormat = z.enum(["jpg", "png", "svg", "pdf"]);

function resolveKey(input?: string): string {
  return figma.resolveFileKey(input ? parseFileKey(input) : undefined);
}

async function run(
  fn: () => Promise<unknown>,
  maxChars?: number,
): Promise<ToolResult> {
  try {
    return ok(await fn(), maxChars);
  } catch (err) {
    return fail(err);
  }
}

server.registerTool(
  "whoami",
  {
    title: "Get current Figma user",
    description: "User behind the configured token. Confirms the token works.",
    inputSchema: {},
  },
  async () => run(() => figma.me()),
);

server.registerTool(
  "get_file",
  {
    title: "Get Figma file tree",
    description:
      "Whole document as a compact outline (or raw JSON). Big files: pass depth, or use get_metadata then get_node.",
    inputSchema: {
      file_key: fileKeyArg,
      depth: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("REST depth limit (1 = pages only, 2 = pages + top-level frames)."),
      format: formatArg,
      max_depth: maxDepthArg,
      max_chars: maxCharsArg,
      geometry: z.literal("paths").optional(),
      branch_data: z.boolean().optional(),
    },
  },
  async ({ file_key, depth, format, max_depth, max_chars, geometry, branch_data }) =>
    run(async () => {
      const data = await figma.getFile(resolveKey(file_key), { depth, geometry, branch_data });
      return format === "raw" ? data : outlineFile(data as object, { maxDepth: max_depth });
    }, max_chars),
);

server.registerTool(
  "get_metadata",
  {
    title: "Get Figma file metadata",
    description: "Pages and top-level frames only (depth=2). Cheap overview; start here.",
    inputSchema: { file_key: fileKeyArg, format: formatArg },
  },
  async ({ file_key, format }) =>
    run(async () => {
      const data = await figma.getFile(resolveKey(file_key), { depth: 2 });
      return format === "raw" ? data : outlineFile(data as object, { maxDepth: 2 });
    }),
);

server.registerTool(
  "get_node",
  {
    title: "Get specific Figma nodes",
    description: "Subtree of one or more nodes as a compact outline (or raw JSON).",
    inputSchema: {
      file_key: fileKeyArg,
      node_ids: z.array(z.string().min(1)).min(1).describe("Node ids like '12:34'."),
      format: formatArg,
      max_depth: maxDepthArg,
      max_chars: maxCharsArg,
    },
  },
  async ({ file_key, node_ids, format, max_depth, max_chars }) =>
    run(async () => {
      const data = await figma.getFileNodes(resolveKey(file_key), node_ids);
      return format === "raw" ? data : outlineNodes(data as object, { maxDepth: max_depth });
    }, max_chars),
);

server.registerTool(
  "get_components",
  {
    title: "List components in a Figma file",
    description: "Components defined in the file (key, name, description).",
    inputSchema: { file_key: fileKeyArg },
  },
  async ({ file_key }) =>
    run(() => figma.getComponents(resolveKey(file_key))),
);

server.registerTool(
  "get_styles",
  {
    title: "List styles in a Figma file",
    description: "Paint/text/effect/grid styles defined in the file.",
    inputSchema: { file_key: fileKeyArg },
  },
  async ({ file_key }) => run(() => figma.getStyles(resolveKey(file_key))),
);

server.registerTool(
  "get_comments",
  {
    title: "Read comments on a Figma file",
    description: "All comments on the file.",
    inputSchema: {
      file_key: fileKeyArg,
      as_md: z.boolean().optional(),
    },
  },
  async ({ file_key, as_md }) =>
    run(() => figma.getComments(resolveKey(file_key), Boolean(as_md))),
);

server.registerTool(
  "post_comment",
  {
    title: "Post a comment on a Figma file",
    description: "Add a comment; comment_id makes it a reply.",
    inputSchema: {
      file_key: fileKeyArg,
      message: z.string().min(1),
      comment_id: z.string().optional(),
    },
  },
  async ({ file_key, message, comment_id }) =>
    run(() => figma.postComment(resolveKey(file_key), message, comment_id)),
);

server.registerTool(
  "get_image",
  {
    title: "Export Figma nodes as images",
    description:
      "Figma-rendered PNG/JPG/SVG/PDF of nodes via REST. Returns temporary URLs, no image inline. Prefer get_screenshot when the plugin is connected.",
    inputSchema: {
      file_key: fileKeyArg,
      node_ids: z.array(z.string().min(1)).min(1),
      format: imageFormat.optional().default("png"),
      scale: z.number().min(0.01).max(4).optional(),
      svg_include_id: z.boolean().optional(),
      svg_simplify_stroke: z.boolean().optional(),
      use_absolute_bounds: z.boolean().optional(),
      version: z.string().optional(),
    },
  },
  async ({
    file_key,
    node_ids,
    format,
    scale,
    svg_include_id,
    svg_simplify_stroke,
    use_absolute_bounds,
    version,
  }) =>
    run(() =>
      figma.getImages(resolveKey(file_key), {
        ids: node_ids,
        format,
        scale,
        svg_include_id,
        svg_simplify_stroke,
        use_absolute_bounds,
        version,
      }),
    ),
);

server.registerTool(
  "bridge_status",
  {
    title: "Check Figma plugin bridge status",
    description: "Connection check: daemon, plugin, open file, current page. Use once per session or after a canvas tool fails; other tools do not need it first.",
    inputSchema: {},
  },
  async () =>
    run(async () => {
      if (!bridge.isConnected()) {
        // The daemon may have died since startup; try once more, then give
        // the bridge client a moment to reconnect (it retries every 2 s).
        daemonStart = await ensureDaemon(bridgeUrl, here);
        reportDaemon(daemonStart);
        for (let i = 0; i < 20 && !bridge.isConnected(); i++) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      if (!bridge.isConnected()) {
        return {
          daemon: "unreachable",
          daemon_url: bridgeUrl,
          autostart: daemonStart,
          hint:
            daemonStart.state === "disabled"
              ? "Autostart is off. Start the daemon: start-bridge.bat or 'npm run bridge' in the project directory."
              : `Could not start the bridge daemon automatically; check ${daemonStart.state === "failed" ? daemonStart.log : "daemon.log"} or run start-bridge.bat.`,
        };
      }
      try {
        const ping = (await bridge.send("ping", undefined, 5_000)) as Record<string, unknown>;
        return { daemon: "connected", plugin: "connected", ...ping };
      } catch (err) {
        return {
          daemon: "connected",
          plugin: "disconnected",
          hint: "Open the plugin in Figma desktop: Plugins > Development > Gemma 4 MCP Bridge, then press Reconnect.",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
);

server.registerTool(
  "use_figma",
  {
    title: "Execute JavaScript inside the Figma plugin sandbox",
    description:
      "Run Plugin API JavaScript in the open Figma file. Body of an async function; `figma`, `selection`, `currentPage` plus helpers query(root, sel), set(node, props), createAutoLayout(dir, props), loadFontsFor(node), hex(c), solid(c) in scope. `return` a small object. Response adds created_ids/changed_ids.",
    inputSchema: {
      code: z.string().min(1),
      screenshot: z.boolean().optional().describe("Also return a PNG of the top-level nodes the snippet created."),
      timeout_ms: z.number().int().min(100).max(120_000).optional().describe("Default 30000."),
    },
  },
  async ({ code, screenshot, timeout_ms }) => {
    try {
      const data = (await bridge.send(
        "exec",
        { code, track: true, screenshot: Boolean(screenshot) },
        timeout_ms,
      )) as { screenshots?: PluginScreenshot[] } & Record<string, unknown>;
      const { screenshots, ...rest } = data;
      const res = ok(rest);
      for (const shot of screenshots ?? []) {
        if (shot.format === "SVG") continue;
        res.content.push({
          type: "image",
          data: shot.base64,
          mimeType: shot.format === "PNG" ? "image/png" : "image/jpeg",
        });
      }
      return res;
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_selection",
  {
    title: "Get the current Figma selection",
    description: "Summary of the nodes selected in Figma right now.",
    inputSchema: {},
  },
  async () => run(() => bridge.send("get_selection")),
);

server.registerTool(
  "get_current_page",
  {
    title: "Get the active Figma page",
    description: "Active page (id, name, child count) and current selection.",
    inputSchema: {},
  },
  async () => run(() => bridge.send("get_current_page")),
);

const screenshotDir = path.resolve(here, "../screenshots");

interface PluginScreenshot {
  id: string;
  name: string;
  format: "PNG" | "JPG" | "SVG";
  base64: string;
  scale?: number;
  width?: number;
  height?: number;
}

// Last export per node id, so an unchanged canvas does not cost another image.
const lastShots = new Map<string, { hash: string; path: string; at: string }>();

const screenshotKeep = (() => {
  const raw = Number(process.env.FIGMA_SCREENSHOT_KEEP);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
})();

function pruneScreenshots(): void {
  if (screenshotKeep === 0) return;
  try {
    const files = readdirSync(screenshotDir)
      .map((f) => ({ f, t: statSync(path.join(screenshotDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(screenshotKeep)) {
      unlinkSync(path.join(screenshotDir, f));
    }
  } catch {
    // best effort
  }
}

function safeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

server.registerTool(
  "get_screenshot",
  {
    title: "Screenshot Figma nodes",
    description:
      "Render nodes via the plugin: saves to ./screenshots and returns the image inline. Omit node_ids for the selection. If pixels are unchanged since the last call, says so and sends no image.",
    inputSchema: {
      node_ids: z.array(z.string().min(1)).optional(),
      format: z.enum(["PNG", "JPG", "SVG"]).optional().default("PNG"),
      scale: z.number().min(0.1).max(4).optional().default(1),
      max_px: z
        .number()
        .int()
        .min(64)
        .max(4096)
        .optional()
        .default(1024)
        .describe("Longest side cap in px; scale is lowered to fit."),
    },
  },
  async ({ node_ids, format, scale, max_px }) => {
    try {
      const shots = (await bridge.send(
        "get_screenshot",
        { node_ids, format, scale, max_px },
        60_000,
      )) as PluginScreenshot[];

      mkdirSync(screenshotDir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);

      const lines: string[] = [];
      const content: ToolResult["content"] = [];
      let fresh = 0;
      for (const shot of shots) {
        const buf = Buffer.from(shot.base64, "base64");
        const hash = createHash("sha1").update(buf).digest("hex");
        const dims = shot.width && shot.height ? `${shot.width}x${shot.height}px` : shot.format;
        const prev = lastShots.get(shot.id);
        if (prev && prev.hash === hash) {
          lines.push(
            `- ${shot.name} (${shot.id}): unchanged since ${prev.at}, same pixels as ${prev.path}; no image attached.`,
          );
          continue;
        }
        const ext = shot.format.toLowerCase();
        const filePath = path.join(screenshotDir, `${stamp}_${safeNodeId(shot.id)}.${ext}`);
        writeFileSync(filePath, buf);
        const at = new Date().toTimeString().slice(0, 8);
        lastShots.set(shot.id, { hash, path: filePath, at });
        fresh++;
        lines.push(
          `- ${shot.name} (${shot.id}) -> ${filePath} (${dims}, scale ${shot.scale ?? scale}, ${buf.length.toLocaleString()} bytes)`,
        );
        // SVG is text, not a renderable image content block.
        if (shot.format === "SVG") continue;
        const mime = shot.format === "PNG" ? "image/png" : "image/jpeg";
        content.push({ type: "image", data: shot.base64, mimeType: mime });
      }
      if (fresh > 0) pruneScreenshots();

      const summary = `${fresh} new screenshot${fresh === 1 ? "" : "s"}, ${shots.length - fresh} unchanged:\n${lines.join("\n")}`;
      content.unshift({ type: "text", text: summary });
      return { content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  },
);

registerCanvasTools(server, bridge);
registerSpecTools(server, bridge);
registerPageTools(server, bridge);
registerComponentTools(server, bridge);
registerVariableTools(server, bridge);
registerSvgTools(server, bridge);
registerCritiqueTools(server, bridge);
registerLibraryTools(server, figma);
registerCodeConnectTools(server, figma);
registerDesignSystemTools(server, figma);
registerDiagramTools(server, bridge);
registerFigJamTools(server, bridge);
registerFilesystemTools(server, workspaces, bridge);
registerHelpTools(server);

// Shrink the tools/list payload. zod-to-json-schema stamps every schema with
// "$schema" and "additionalProperties": false; across 60+ tools that is
// several KB of context for zero information. Clients without deferred tool
// loading (Hermes, LM Studio) pay for it on every turn. Wrap the SDK's
// handler and strip the noise; if the SDK internals change, leave it alone.
compactToolList(server);

function compactToolList(s: McpServer): void {
  const inner = s.server as unknown as {
    _requestHandlers?: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
  };
  const original = inner._requestHandlers?.get("tools/list");
  if (!original) return;
  const strip = (schema: unknown): unknown => {
    if (!schema || typeof schema !== "object") return schema;
    const o = { ...(schema as Record<string, unknown>) };
    delete o.$schema;
    if (o.additionalProperties === false) delete o.additionalProperties;
    if (o.properties && typeof o.properties === "object") {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o.properties as Record<string, unknown>)) {
        props[k] = strip(v);
      }
      o.properties = props;
    }
    if (o.items) o.items = strip(o.items);
    return o;
  };
  inner._requestHandlers!.set("tools/list", async (req, extra) => {
    const res = (await original(req, extra)) as {
      tools?: { inputSchema?: unknown; execution?: { taskSupport?: string } }[];
    };
    for (const t of res.tools ?? []) {
      t.inputSchema = strip(t.inputSchema);
      // "forbidden" is the protocol default; sending it is pure overhead.
      if (t.execution?.taskSupport === "forbidden") delete t.execution;
    }
    return res;
  });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[gemma-figma-mcp] ready on stdio");
}

function shutdown() {
  bridge.close();
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

main().catch((err) => {
  console.error("[gemma-figma-mcp] fatal:", err);
  process.exit(1);
});
