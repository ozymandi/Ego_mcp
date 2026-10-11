import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { icons } from "lucide";
import type { PluginBridge } from "./bridge.js";
import { J, appendToParent, parseColor } from "./canvas-helpers.js";
import { ok, fail } from "./result.js";

// Vector content: arbitrary SVG strings and the Lucide icon set (ISC licence,
// 2000+ icons). Models cannot draw icons from primitives; this gives them a
// real one by name.

type IconNode = [string, Record<string, string | number>][];
const ICONS = icons as unknown as Record<string, IconNode>;

function toPascal(name: string): string {
  return name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
}

function toKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
}

function findIcon(name: string): { name: string; node: IconNode } | null {
  const pascal = toPascal(name);
  if (ICONS[pascal]) return { name: toKebab(pascal), node: ICONS[pascal]! };
  const lower = name.toLowerCase().replace(/[-_\s]/g, "");
  for (const key of Object.keys(ICONS)) {
    if (key.toLowerCase() === lower) return { name: toKebab(key), node: ICONS[key]! };
  }
  return null;
}

function iconSvg(node: IconNode, size: number, color: string, strokeWidth: number): string {
  const body = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function hexNoAlpha(color: string): string {
  const c = parseColor(color);
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function registerSvgTools(server: McpServer, bridge: PluginBridge): void {
  const exec = (code: string, timeoutMs?: number) => bridge.send("exec", { code }, timeoutMs);

  const placeSvg = (svg: string, x: number, y: number, name: string, parentId?: string) => `
    const n = figma.createNodeFromSvg(${J(svg)});
    n.name = ${J(name)};
    n.x = ${x}; n.y = ${y};
    ${appendToParent("n", parentId)}
    return { id: n.id, name: n.name, type: n.type, width: n.width, height: n.height, children: 'children' in n ? n.children.length : 0 };
  `;

  server.registerTool(
    "create_from_svg",
    {
      title: "Create nodes from SVG",
      description: "Import an SVG string onto the canvas as a frame of vectors.",
      inputSchema: {
        svg: z.string().min(10),
        x: z.number(),
        y: z.number(),
        name: z.string().optional(),
        parent_id: z.string().optional().describe("Parent node id; default: current page."),
      },
    },
    async ({ svg, x, y, name, parent_id }) => {
      try {
        if (!/<svg[\s>]/i.test(svg)) throw new Error("svg must be a complete <svg ...>...</svg> document");
        return ok(await exec(placeSvg(svg, x, y, name ?? "SVG", parent_id)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "insert_icon",
    {
      title: "Insert a Lucide icon",
      description:
        "Place an icon from the Lucide set (2000+; names like 'heart', 'arrow-right', 'message-circle'). Unknown name: use search_icons.",
      inputSchema: {
        name: z.string().min(1),
        x: z.number(),
        y: z.number(),
        size: z.number().positive().optional().default(24),
        color: z.string().optional().default("#000000").describe("Hex stroke color."),
        stroke_width: z.number().positive().optional().default(2),
        parent_id: z.string().optional().describe("Parent node id; default: current page."),
      },
    },
    async ({ name, x, y, size, color, stroke_width, parent_id }) => {
      try {
        const icon = findIcon(name);
        if (!icon) {
          const near = searchIcons(name, 8).map((i) => i.name);
          throw new Error(`No Lucide icon '${name}'.${near.length ? ` Similar: ${near.join(", ")}` : " Try search_icons."}`);
        }
        const svg = iconSvg(icon.node, size, hexNoAlpha(color), stroke_width);
        return ok(await exec(placeSvg(svg, x, y, `icon/${icon.name}`, parent_id)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "search_icons",
    {
      title: "Search Lucide icon names",
      description: "Find icon names for insert_icon by keyword (e.g. 'arrow', 'user', 'chat').",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional().default(25),
      },
    },
    async ({ query, limit }) => {
      try {
        const hits = searchIcons(query, limit);
        return ok({ count: hits.length, icons: hits.map((h) => h.name) });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

function searchIcons(query: string, limit: number): { name: string; score: number }[] {
  const terms = query.toLowerCase().split(/[\s,-]+/).filter(Boolean);
  const out: { name: string; score: number }[] = [];
  for (const key of Object.keys(ICONS)) {
    const kebab = toKebab(key);
    let score = kebab === terms.join("-") ? 50 : 0;
    for (const t of terms) {
      if (kebab === t) score += 10;
      else if (kebab.split("-").includes(t)) score += 5;
      else if (kebab.includes(t)) score += 2;
    }
    if (score > 0) out.push({ name: kebab, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
