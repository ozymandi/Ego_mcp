#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FigmaClient, FigmaError, parseFileKey } from "./figma.js";

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[gemma-figma-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[gemma-figma-mcp] fatal:", err);
  process.exit(1);
});
