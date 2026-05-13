#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FigmaClient, FigmaError, parseFileKey } from "./figma.js";
import { PluginBridge } from "./bridge.js";

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
const bridge = new PluginBridge({ url: bridgeUrl });

const server = new McpServer({
  name: "gemma-figma-mcp",
  version: "0.1.0",
});

const fileKeyArg = z
  .string()
  .min(1)
  .describe(
    "Figma file key or full Figma URL (e.g. https://www.figma.com/design/<KEY>/...). Optional if FIGMA_DEFAULT_FILE_KEY is set in .env.",
  )
  .optional();

const imageFormat = z.enum(["jpg", "png", "svg", "pdf"]);

function resolveKey(input?: string): string {
  return figma.resolveFileKey(input ? parseFileKey(input) : undefined);
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return {
      content: [
        {
          type: "text",
          text:
            typeof data === "string" ? data : JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (err) {
    if (err instanceof FigmaError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Figma API error ${err.status}: ${err.message}\n` +
              JSON.stringify(err.body, null, 2),
          },
        ],
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${msg}` }],
    };
  }
}

server.registerTool(
  "whoami",
  {
    title: "Get current Figma user",
    description: "Returns the Figma user associated with the configured token.",
    inputSchema: {},
  },
  async () => run(() => figma.me()),
);

server.registerTool(
  "get_file",
  {
    title: "Get full Figma file",
    description:
      "Returns the full document tree of a Figma file. Large files may produce big responses — prefer get_metadata or get_node when possible.",
    inputSchema: {
      file_key: fileKeyArg,
      depth: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Limit tree depth (1 = top-level pages only)."),
      geometry: z
        .literal("paths")
        .optional()
        .describe("Include vector path data when set to 'paths'."),
      branch_data: z.boolean().optional(),
    },
  },
  async ({ file_key, depth, geometry, branch_data }) =>
    run(() =>
      figma.getFile(resolveKey(file_key), { depth, geometry, branch_data }),
    ),
);

server.registerTool(
  "get_metadata",
  {
    title: "Get Figma file metadata",
    description:
      "Returns top-level file structure (pages only, depth=1). Cheap call for an overview.",
    inputSchema: { file_key: fileKeyArg },
  },
  async ({ file_key }) =>
    run(() => figma.getFile(resolveKey(file_key), { depth: 1 })),
);

server.registerTool(
  "get_node",
  {
    title: "Get specific Figma nodes",
    description: "Returns the subtree for one or more node IDs in a file.",
    inputSchema: {
      file_key: fileKeyArg,
      node_ids: z
        .array(z.string().min(1))
        .min(1)
        .describe("Figma node IDs (e.g. '1:2', '3:45')."),
    },
  },
  async ({ file_key, node_ids }) =>
    run(() => figma.getFileNodes(resolveKey(file_key), node_ids)),
);

server.registerTool(
  "get_components",
  {
    title: "List components in a Figma file",
    description: "Returns all components defined in the file.",
    inputSchema: { file_key: fileKeyArg },
  },
  async ({ file_key }) =>
    run(() => figma.getComponents(resolveKey(file_key))),
);

server.registerTool(
  "get_styles",
  {
    title: "List styles in a Figma file",
    description: "Returns all paint/text/effect/grid styles defined in the file.",
    inputSchema: { file_key: fileKeyArg },
  },
  async ({ file_key }) => run(() => figma.getStyles(resolveKey(file_key))),
);

server.registerTool(
  "get_comments",
  {
    title: "Read comments on a Figma file",
    description: "Returns all comments. Set as_md=true to receive markdown-formatted messages.",
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
    description:
      "Adds a comment to a file. Pass comment_id to reply to an existing comment.",
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
      "Renders one or more nodes as PNG/JPG/SVG/PDF. Returns S3 URLs (valid ~30 days).",
    inputSchema: {
      file_key: fileKeyArg,
      node_ids: z.array(z.string().min(1)).min(1),
      format: imageFormat.optional().default("png"),
      scale: z
        .number()
        .min(0.01)
        .max(4)
        .optional()
        .describe("Image scale, 0.01–4. Default 1."),
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
    description:
      "Returns whether the companion Figma plugin is connected to the MCP server's WebSocket bridge.",
    inputSchema: {},
  },
  async () =>
    run(async () => ({
      daemon_url: bridgeUrl,
      mcp_to_daemon: bridge.isConnected() ? "connected" : "disconnected",
      hint: bridge.isConnected()
        ? "Bridge daemon is reachable. Call use_figma / get_selection / get_screenshot to exercise the plugin."
        : `Bridge daemon not reachable at ${bridgeUrl}. Start it: 'npm run bridge' in the project directory.`,
    })),
);

server.registerTool(
  "use_figma",
  {
    title: "Execute JavaScript inside the Figma plugin sandbox",
    description:
      "Runs the given JS snippet inside the connected Figma plugin. `figma`, `selection`, and `currentPage` are in scope. Use `return value` (or set the last expression) to return data. The snippet is wrapped in an async function, so `await` is allowed.",
    inputSchema: {
      code: z
        .string()
        .min(1)
        .describe(
          "Body of an async function executed with figma, selection, currentPage in scope. Use 'return ...' to surface a value.",
        ),
      timeout_ms: z
        .number()
        .int()
        .min(100)
        .max(120_000)
        .optional()
        .describe("Per-call timeout. Default 30000."),
    },
  },
  async ({ code, timeout_ms }) =>
    run(() => bridge.send("exec", { code }, timeout_ms)),
);

server.registerTool(
  "get_selection",
  {
    title: "Get the current Figma selection",
    description:
      "Returns a summary of currently selected nodes in the active page of the connected Figma file.",
    inputSchema: {},
  },
  async () => run(() => bridge.send("get_selection")),
);

server.registerTool(
  "get_current_page",
  {
    title: "Get the active Figma page",
    description:
      "Returns the active page (id, name, child count, selection) of the connected Figma file.",
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
}

function safeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

server.registerTool(
  "get_screenshot",
  {
    title: "Screenshot Figma nodes",
    description:
      "Exports nodes via the plugin. Returns the saved file path(s) for each node and embeds the image inline (clients that render image content will display it). With no node_ids, exports the current selection.",
    inputSchema: {
      node_ids: z
        .array(z.string().min(1))
        .optional()
        .describe("Node IDs to render. Omit to use the current selection."),
      format: z.enum(["PNG", "JPG", "SVG"]).optional().default("PNG"),
      scale: z.number().min(0.1).max(4).optional().default(2),
    },
  },
  async ({ node_ids, format, scale }) => {
    try {
      const shots = (await bridge.send(
        "get_screenshot",
        { node_ids, format, scale },
        60_000,
      )) as PluginScreenshot[];

      mkdirSync(screenshotDir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);

      const saved: { path: string; bytes: number; shot: PluginScreenshot }[] = [];
      for (const shot of shots) {
        const ext = shot.format.toLowerCase();
        const filename = `${stamp}_${safeNodeId(shot.id)}.${ext}`;
        const filePath = path.join(screenshotDir, filename);
        const buf = Buffer.from(shot.base64, "base64");
        writeFileSync(filePath, buf);
        saved.push({ path: filePath, bytes: buf.length, shot });
      }

      const lines = saved.map(
        (s) =>
          `• ${s.shot.name} (${s.shot.id}) → ${s.path} (${s.bytes.toLocaleString()} bytes, ${s.shot.format})`,
      );
      const summary = `Saved ${saved.length} screenshot${saved.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;

      const content: ({ type: "text"; text: string } | {
        type: "image";
        data: string;
        mimeType: string;
      })[] = [{ type: "text", text: summary }];

      for (const s of saved) {
        // SVG is text, not a renderable image content block.
        if (s.shot.format === "SVG") continue;
        const mime = s.shot.format === "PNG" ? "image/png" : "image/jpeg";
        content.push({ type: "image", data: s.shot.base64, mimeType: mime });
      }

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
