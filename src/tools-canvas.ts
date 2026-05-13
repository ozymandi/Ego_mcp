import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import {
  J,
  appendToParent,
  parseColor,
  resolveNode,
  solidFillExpr,
  summaryReturn,
} from "./canvas-helpers.js";

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
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${msg}` }],
  };
}

const colorArg = z
  .string()
  .describe("Hex color like '#0d99ff' or '#0d99ffcc' (with alpha).");

const parentArg = z
  .string()
  .min(1)
  .optional()
  .describe("Optional parent node id. Defaults to the current page.");

const nodeIdArg = z.string().min(1).describe("Figma node id (e.g. '12:345').");

const direction = z.enum(["HORIZONTAL", "VERTICAL", "NONE"]);

export function registerCanvasTools(
  server: McpServer,
  bridge: PluginBridge,
): void {
  const exec = async (code: string, timeoutMs?: number): Promise<unknown> =>
    bridge.send("exec", { code }, timeoutMs);

  // ---- Create -------------------------------------------------------------

  server.registerTool(
    "create_frame",
    {
      title: "Create a frame",
      description:
        "Creates an empty frame at (x, y) with the given size. Appends to parent_id or current page.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        name: z.string().optional(),
        parent_id: parentArg,
      },
    },
    async ({ x, y, width, height, name, parent_id }) => {
      try {
        const code = `
          const f = figma.createFrame();
          f.x = ${x}; f.y = ${y};
          f.resize(${width}, ${height});
          f.name = ${J(name ?? "Frame")};
          ${appendToParent("f", parent_id)}
          ${summaryReturn("f")}
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_rectangle",
    {
      title: "Create a rectangle",
      description:
        "Creates a rectangle. Optional fill (hex). Appends to parent_id or current page.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        fill: colorArg.optional(),
        name: z.string().optional(),
        parent_id: parentArg,
      },
    },
    async ({ x, y, width, height, fill, name, parent_id }) => {
      try {
        const fillCode = fill
          ? `r.fills = ${solidFillExpr(parseColor(fill))};`
          : "";
        const code = `
          const r = figma.createRectangle();
          r.x = ${x}; r.y = ${y};
          r.resize(${width}, ${height});
          r.name = ${J(name ?? "Rectangle")};
          ${fillCode}
          ${appendToParent("r", parent_id)}
          ${summaryReturn("r")}
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_ellipse",
    {
      title: "Create an ellipse",
      description: "Creates an ellipse/circle. Optional fill (hex).",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        fill: colorArg.optional(),
        name: z.string().optional(),
        parent_id: parentArg,
      },
    },
    async ({ x, y, width, height, fill, name, parent_id }) => {
      try {
        const fillCode = fill
          ? `e.fills = ${solidFillExpr(parseColor(fill))};`
          : "";
        const code = `
          const e = figma.createEllipse();
          e.x = ${x}; e.y = ${y};
          e.resize(${width}, ${height});
          e.name = ${J(name ?? "Ellipse")};
          ${fillCode}
          ${appendToParent("e", parent_id)}
          ${summaryReturn("e")}
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_text",
    {
      title: "Create a text node",
      description:
        "Creates a text node. Loads the requested font (defaults to Inter Regular) before setting characters.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        content: z.string().min(1),
        font_size: z.number().positive().optional(),
        font_family: z.string().optional(),
        font_style: z
          .string()
          .optional()
          .describe("e.g. 'Regular', 'Bold', 'Medium'. Default 'Regular'."),
        color: colorArg.optional(),
        name: z.string().optional(),
        parent_id: parentArg,
      },
    },
    async ({
      x,
      y,
      content,
      font_size,
      font_family,
      font_style,
      color,
      name,
      parent_id,
    }) => {
      try {
        const family = font_family ?? "Inter";
        const style = font_style ?? "Regular";
        const colorCode = color
          ? `t.fills = ${solidFillExpr(parseColor(color))};`
          : "";
        const sizeCode =
          font_size !== undefined ? `t.fontSize = ${font_size};` : "";
        const code = `
          const font = { family: ${J(family)}, style: ${J(style)} };
          try { await figma.loadFontAsync(font); }
          catch (e) {
            // Fallback to Inter Regular if requested font is unavailable.
            await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            font.family = 'Inter'; font.style = 'Regular';
          }
          const t = figma.createText();
          t.fontName = font;
          t.x = ${x}; t.y = ${y};
          t.characters = ${J(content)};
          t.name = ${J(name ?? content.slice(0, 40))};
          ${sizeCode}
          ${colorCode}
          ${appendToParent("t", parent_id)}
          return { id: t.id, name: t.name, type: t.type, font: t.fontName, size: t.fontSize };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_line",
    {
      title: "Create a line",
      description:
        "Creates a line segment from (x1,y1) to (x2,y2). Optional stroke color and weight.",
      inputSchema: {
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
        stroke: colorArg.optional(),
        stroke_weight: z.number().positive().optional(),
        name: z.string().optional(),
        parent_id: parentArg,
      },
    },
    async ({ x1, y1, x2, y2, stroke, stroke_weight, name, parent_id }) => {
      try {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        // Figma rotation: degrees, positive is counter-clockwise.
        // Y axis points down, so we negate the math angle.
        const angle = -((Math.atan2(dy, dx) * 180) / Math.PI);
        const strokeCode = stroke
          ? `l.strokes = ${solidFillExpr(parseColor(stroke))};`
          : "";
        const weightCode =
          stroke_weight !== undefined
            ? `l.strokeWeight = ${stroke_weight};`
            : "";
        const code = `
          const l = figma.createLine();
          l.x = ${x1}; l.y = ${y1};
          l.resize(${length}, 0);
          l.rotation = ${angle};
          l.name = ${J(name ?? "Line")};
          ${strokeCode}
          ${weightCode}
          ${appendToParent("l", parent_id)}
          ${summaryReturn("l")}
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "clone_node",
    {
      title: "Clone a node",
      description:
        "Duplicates a node and offsets the clone by 20px so it doesn't overlap exactly.",
      inputSchema: { node_id: nodeIdArg },
    },
    async ({ node_id }) => {
      try {
        const code = `${resolveNode(node_id, "src")}
          if (!('clone' in src)) throw new Error('Node type cannot be cloned: ' + src.type);
          const c = src.clone();
          if ('x' in c && 'y' in c) { c.x = (src.x ?? 0) + 20; c.y = (src.y ?? 0) + 20; }
          (src.parent || figma.currentPage).appendChild(c);
          return { id: c.id, name: c.name, type: c.type, source_id: src.id };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- Modify -------------------------------------------------------------

  server.registerTool(
    "move_node",
    {
      title: "Move a node",
      description: "Sets the absolute x/y of a node.",
      inputSchema: { node_id: nodeIdArg, x: z.number(), y: z.number() },
    },
    async ({ node_id, x, y }) => {
      try {
        const code = `${resolveNode(node_id)} n.x = ${x}; n.y = ${y}; ${summaryReturn()}`;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "resize_node",
    {
      title: "Resize a node",
      description: "Resizes a node to the given width/height.",
      inputSchema: {
        node_id: nodeIdArg,
        width: z.number().positive(),
        height: z.number().positive(),
      },
    },
    async ({ node_id, width, height }) => {
      try {
        const code = `${resolveNode(node_id)} n.resize(${width}, ${height}); ${summaryReturn()}`;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_fill",
    {
      title: "Set node fill",
      description: "Replaces a node's fills with a single solid color.",
      inputSchema: {
        node_id: nodeIdArg,
        color: colorArg,
        opacity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Overrides the alpha channel of `color` if provided."),
      },
    },
    async ({ node_id, color, opacity }) => {
      try {
        const c = parseColor(color);
        if (opacity !== undefined) c.a = opacity;
        const code = `${resolveNode(node_id)}
          if (!('fills' in n)) throw new Error('Node has no fills: ' + n.type);
          n.fills = ${solidFillExpr(c)};
          ${summaryReturn()}`;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_stroke",
    {
      title: "Set node stroke",
      description: "Replaces a node's strokes with a single solid color. Optional weight.",
      inputSchema: {
        node_id: nodeIdArg,
        color: colorArg,
        weight: z.number().positive().optional(),
      },
    },
    async ({ node_id, color, weight }) => {
      try {
        const c = parseColor(color);
        const weightCode =
          weight !== undefined ? `n.strokeWeight = ${weight};` : "";
        const code = `${resolveNode(node_id)}
          if (!('strokes' in n)) throw new Error('Node has no strokes: ' + n.type);
          n.strokes = ${solidFillExpr(c)};
          ${weightCode}
          ${summaryReturn()}`;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_text",
    {
      title: "Set text content",
      description: "Replaces the characters of a text node, loading its current font first.",
      inputSchema: { node_id: nodeIdArg, content: z.string() },
    },
    async ({ node_id, content }) => {
      try {
        const code = `${resolveNode(node_id)}
          if (n.type !== 'TEXT') throw new Error('Not a text node: ' + n.type);
          const fn = n.fontName;
          if (fn === figma.mixed) throw new Error('Mixed fonts — split the runs manually before setting text.');
          await figma.loadFontAsync(fn);
          n.characters = ${J(content)};
          return { id: n.id, name: n.name, characters: n.characters };`;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rename_node",
    {
      title: "Rename a node",
      description: "Sets the name of a node.",
      inputSchema: { node_id: nodeIdArg, name: z.string().min(1) },
    },
    async ({ node_id, name }) => {
      try {
        const code = `${resolveNode(node_id)} n.name = ${J(name)}; ${summaryReturn()}`;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- Tree / utility -----------------------------------------------------

  server.registerTool(
    "delete_nodes",
    {
      title: "Delete nodes",
      description: "Removes one or more nodes by id. Missing ids are reported in 'skipped'.",
      inputSchema: { node_ids: z.array(z.string().min(1)).min(1) },
    },
    async ({ node_ids }) => {
      try {
        const code = `
          const deleted = [], skipped = [];
          for (const id of ${J(node_ids)}) {
            const n = await figma.getNodeByIdAsync(id);
            if (!n) { skipped.push(id); continue; }
            try { n.remove(); deleted.push(id); }
            catch (e) { skipped.push(id); }
          }
          return { deleted, skipped };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_selection",
    {
      title: "Set Figma selection",
      description: "Selects the given node ids on the current page.",
      inputSchema: { node_ids: z.array(z.string().min(1)) },
    },
    async ({ node_ids }) => {
      try {
        const code = `
          const ids = ${J(node_ids)};
          const nodes = [];
          for (const id of ids) {
            const n = await figma.getNodeByIdAsync(id);
            if (n && 'parent' in n) nodes.push(n);
          }
          figma.currentPage.selection = nodes;
          return { selected: nodes.map(n => ({ id: n.id, name: n.name, type: n.type })) };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "find_nodes",
    {
      title: "Find nodes on the current page",
      description:
        "Walks the current page tree and returns nodes matching the optional name pattern (case-insensitive regex) and/or type.",
      inputSchema: {
        name_pattern: z
          .string()
          .optional()
          .describe("Case-insensitive regex tested against each node's name."),
        type: z
          .string()
          .optional()
          .describe("Figma node type, e.g. 'FRAME', 'TEXT', 'RECTANGLE'."),
        limit: z.number().int().positive().max(500).optional().default(50),
      },
    },
    async ({ name_pattern, type, limit }) => {
      try {
        const code = `
          const pattern = ${J(name_pattern ?? null)};
          const type = ${J(type ?? null)};
          const limit = ${limit};
          const re = pattern ? new RegExp(pattern, 'i') : null;
          const found = [];
          const walk = (node) => {
            if (found.length >= limit) return;
            if (node !== figma.currentPage) {
              const matchType = !type || node.type === type;
              const matchName = !re || re.test(node.name);
              if (matchType && matchName) {
                found.push({ id: node.id, name: node.name, type: node.type });
              }
            }
            if ('children' in node) for (const c of node.children) walk(c);
          };
          for (const c of figma.currentPage.children) walk(c);
          return { count: found.length, nodes: found };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "group_nodes",
    {
      title: "Group nodes",
      description: "Wraps the given nodes into a Figma group inside their shared parent.",
      inputSchema: {
        node_ids: z.array(z.string().min(1)).min(1),
        name: z.string().optional(),
      },
    },
    async ({ node_ids, name }) => {
      try {
        const code = `
          const ids = ${J(node_ids)};
          const nodes = [];
          for (const id of ids) {
            const n = await figma.getNodeByIdAsync(id);
            if (n && 'parent' in n) nodes.push(n);
          }
          if (nodes.length === 0) throw new Error('No valid nodes to group');
          const parent = nodes[0].parent || figma.currentPage;
          const g = figma.group(nodes, parent);
          g.name = ${J(name ?? "Group")};
          ${summaryReturn("g")}
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_auto_layout",
    {
      title: "Set auto-layout on a frame",
      description:
        "Enables or updates auto-layout on a frame. direction='NONE' disables it.",
      inputSchema: {
        node_id: nodeIdArg,
        direction,
        item_spacing: z.number().min(0).optional(),
        padding: z
          .number()
          .min(0)
          .optional()
          .describe("Uniform padding for all four sides."),
      },
    },
    async ({ node_id, direction, item_spacing, padding }) => {
      try {
        const spacingCode =
          item_spacing !== undefined
            ? `n.itemSpacing = ${item_spacing};`
            : "";
        const paddingCode =
          padding !== undefined
            ? `n.paddingLeft = ${padding}; n.paddingRight = ${padding}; n.paddingTop = ${padding}; n.paddingBottom = ${padding};`
            : "";
        const code = `${resolveNode(node_id)}
          if (!('layoutMode' in n)) throw new Error('Node does not support auto-layout: ' + n.type);
          n.layoutMode = ${J(direction)};
          ${spacingCode}
          ${paddingCode}
          return { id: n.id, name: n.name, layoutMode: n.layoutMode, itemSpacing: n.itemSpacing, padding: { left: n.paddingLeft, right: n.paddingRight, top: n.paddingTop, bottom: n.paddingBottom } };
        `;
        return ok(await exec(code));
      } catch (err) {
        return fail(err);
      }
    },
  );

}
