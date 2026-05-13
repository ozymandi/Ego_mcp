import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import { J } from "./canvas-helpers.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
}

const STICKY_COLOR = z.enum([
  "yellow",
  "green",
  "blue",
  "pink",
  "red",
  "orange",
  "gray",
  "lightGray",
  "violet",
  "teal",
]);

export function registerFigJamTools(
  server: McpServer,
  bridge: PluginBridge,
): void {
  const exec = (code: string, timeoutMs?: number) =>
    bridge.send("exec", { code }, timeoutMs);

  server.registerTool(
    "create_sticky",
    {
      title: "Create a FigJam sticky note",
      description:
        "Creates a sticky at (x, y) with the given text and color. FigJam-only (Figma Design files don't support sticky nodes).",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        text: z.string().min(1),
        color: STICKY_COLOR.optional().default("yellow"),
        parent_id: z
          .string()
          .optional()
          .describe("Optional parent node id. Default: current page."),
      },
    },
    async ({ x, y, text, color, parent_id }) => {
      try {
        const appendCode = parent_id
          ? `const __parent = await figma.getNodeByIdAsync(${J(parent_id)}); if (!__parent || !('appendChild' in __parent)) throw new Error('Parent not found or does not accept children: ' + ${J(parent_id)}); __parent.appendChild(s);`
          : `figma.currentPage.appendChild(s);`;
        const code = `
          if (figma.editorType !== 'figjam') {
            throw new Error('create_sticky only works in FigJam files. Current editor: ' + figma.editorType);
          }
          const s = figma.createSticky();
          s.x = ${x}; s.y = ${y};
          await figma.loadFontAsync(s.text.fontName);
          s.text.characters = ${J(text)};
          // authorVisible defaults to true; setting the named color via the sticky's color picker map
          const colorName = ${J(color ?? "yellow")};
          // The plugin API uses RGB; map names to FigJam's stock palette.
          const palette = {
            yellow:    { r: 1.00, g: 0.92, b: 0.51 },
            green:     { r: 0.74, g: 0.92, b: 0.71 },
            blue:      { r: 0.66, g: 0.84, b: 1.00 },
            pink:      { r: 1.00, g: 0.76, b: 0.86 },
            red:       { r: 1.00, g: 0.66, b: 0.66 },
            orange:    { r: 1.00, g: 0.82, b: 0.58 },
            gray:      { r: 0.80, g: 0.80, b: 0.80 },
            lightGray: { r: 0.92, g: 0.92, b: 0.92 },
            violet:    { r: 0.78, g: 0.69, b: 1.00 },
            teal:      { r: 0.62, g: 0.91, b: 0.88 },
          };
          const c = palette[colorName] || palette.yellow;
          s.fills = [{ type: 'SOLID', color: c }];
          ${appendCode}
          return { id: s.id, name: s.name, type: s.type, color: colorName };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_connector",
    {
      title: "Create a connector between two nodes",
      description:
        "Draws a connector from one node to another. Works in both FigJam and Figma Design files (with documentAccess: dynamic-page).",
      inputSchema: {
        from_id: z.string().min(1),
        to_id: z.string().min(1),
        label: z.string().optional(),
        style: z.enum(["STRAIGHT", "ELBOWED"]).optional().default("ELBOWED"),
        stroke_color: z
          .string()
          .optional()
          .describe("Hex color for the connector stroke. Default: dark gray."),
      },
    },
    async ({ from_id, to_id, label, style, stroke_color }) => {
      try {
        const colorCode = stroke_color
          ? `
            const hex = ${J(stroke_color)}.replace('#','');
            const full = hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex;
            const r = parseInt(full.slice(0,2),16)/255;
            const g = parseInt(full.slice(2,4),16)/255;
            const b = parseInt(full.slice(4,6),16)/255;
            c.strokes = [{ type: 'SOLID', color: { r, g, b } }];`
          : "";
        const code = `
          const src = await figma.getNodeByIdAsync(${J(from_id)});
          const dst = await figma.getNodeByIdAsync(${J(to_id)});
          if (!src) throw new Error('from_id not found: ' + ${J(from_id)});
          if (!dst) throw new Error('to_id not found: ' + ${J(to_id)});
          const c = figma.createConnector();
          c.connectorStart = { endpointNodeId: src.id, magnet: 'AUTO' };
          c.connectorEnd = { endpointNodeId: dst.id, magnet: 'AUTO' };
          c.connectorLineType = ${J(style ?? "ELBOWED")};
          ${colorCode}
          if (${J(label ?? null)} !== null) {
            await figma.loadFontAsync(c.text.fontName);
            c.text.characters = ${J(label ?? "")};
          }
          return { id: c.id, type: c.type, from: src.id, to: dst.id };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
