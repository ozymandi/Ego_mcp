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

// ---- Mermaid (flowchart subset) parser ----------------------------------

type ShapeKind = "box" | "pill" | "circle" | "diamond";

interface DiagramNode {
  id: string;
  label: string;
  shape: ShapeKind;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

interface ParsedDiagram {
  direction: "TD" | "TB" | "LR" | "RL" | "BT";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

// Matches A[label], A(label), A((label)), A{label} — captures id and label.
const NODE_DECL_RE =
  /\b([A-Za-z_][\w]*)\s*(\[\[[^\]]+\]\]|\[[^\]]+\]|\(\([^)]+\)\)|\([^)]+\)|\{[^}]+\})/g;

// A --> B, A --label--> B, A -- label --> B, A -.-> B, A ==> B
const EDGE_RE =
  /\b([A-Za-z_][\w]*)\s*(?:--+\s*([^->\n|]+?)\s*--+>|--+>|-\.+->|==+>)\s*([A-Za-z_][\w]*)\b/g;

function parseMermaidFlowchart(input: string): ParsedDiagram {
  const cleaned = input
    .split("\n")
    .filter((l) => !l.trim().startsWith("%%"))
    .join("\n");

  const headerMatch = cleaned.match(/^\s*(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)/im);
  if (!headerMatch) {
    throw new Error(
      "Expected first non-comment line to be `flowchart TD|TB|LR|RL|BT` or `graph TD|...`.",
    );
  }
  const direction = headerMatch[1]!.toUpperCase() as ParsedDiagram["direction"];

  const nodes = new Map<string, DiagramNode>();
  const upsert = (id: string, label: string, shape: ShapeKind) => {
    const existing = nodes.get(id);
    if (!existing || existing.label === id) nodes.set(id, { id, label, shape });
  };

  for (const m of cleaned.matchAll(NODE_DECL_RE)) {
    const id = m[1]!;
    const raw = m[2]!;
    let shape: ShapeKind = "box";
    let label: string;
    if (raw.startsWith("((") && raw.endsWith("))")) {
      shape = "circle";
      label = raw.slice(2, -2);
    } else if (raw.startsWith("[[") && raw.endsWith("]]")) {
      shape = "box";
      label = raw.slice(2, -2);
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      shape = "box";
      label = raw.slice(1, -1);
    } else if (raw.startsWith("{") && raw.endsWith("}")) {
      shape = "diamond";
      label = raw.slice(1, -1);
    } else {
      // ( label )
      shape = "pill";
      label = raw.slice(1, -1);
    }
    upsert(id, stripQuotes(label), shape);
  }

  const edges: DiagramEdge[] = [];
  for (const m of cleaned.matchAll(EDGE_RE)) {
    const from = m[1]!;
    const label = m[2] ? m[2].trim() : undefined;
    const to = m[3]!;
    edges.push({ from, to, label });
    if (!nodes.has(from)) upsert(from, from, "box");
    if (!nodes.has(to)) upsert(to, to, "box");
  }

  return {
    direction,
    nodes: Array.from(nodes.values()),
    edges,
  };
}

function stripQuotes(s: string): string {
  return s.replace(/^["'`]+|["'`]+$/g, "").trim();
}

// ---- Layered layout -----------------------------------------------------

interface LaidOutNode extends DiagramNode {
  level: number;
  position_in_level: number;
}

function layoutNodes(diagram: ParsedDiagram): LaidOutNode[] {
  // Topological-ish layering: BFS from nodes with no incoming edges.
  const incoming = new Map<string, number>();
  for (const n of diagram.nodes) incoming.set(n.id, 0);
  for (const e of diagram.edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  const adj = new Map<string, string[]>();
  for (const n of diagram.nodes) adj.set(n.id, []);
  for (const e of diagram.edges) adj.get(e.from)?.push(e.to);

  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, n] of incoming) {
    if (n === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const lvl = levels.get(cur)!;
    for (const next of adj.get(cur) ?? []) {
      const existing = levels.get(next);
      const candidate = lvl + 1;
      if (existing === undefined || candidate > existing) {
        levels.set(next, candidate);
        queue.push(next);
      }
    }
  }
  // Orphan nodes (cycles or detached) — place on level 0.
  for (const n of diagram.nodes) {
    if (!levels.has(n.id)) levels.set(n.id, 0);
  }

  const byLevel = new Map<number, DiagramNode[]>();
  for (const n of diagram.nodes) {
    const lvl = levels.get(n.id)!;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(n);
  }

  const out: LaidOutNode[] = [];
  for (const [lvl, nodes] of byLevel) {
    nodes.forEach((n, i) =>
      out.push({ ...n, level: lvl, position_in_level: i }),
    );
  }
  return out;
}

// ---- Plugin code generation --------------------------------------------

interface FlowchartOpts {
  nodes: { id: string; label: string; shape?: ShapeKind }[];
  edges: { from: string; to: string; label?: string }[];
  direction?: "TD" | "TB" | "LR" | "RL" | "BT";
  origin?: { x: number; y: number };
  node_width?: number;
  node_height?: number;
  level_spacing?: number;
  node_spacing?: number;
  connector_style?: "STRAIGHT" | "ELBOWED";
}

function buildFlowchartCode(opts: FlowchartOpts): string {
  const dir = opts.direction ?? "TD";
  const horizontal = dir === "LR" || dir === "RL";
  const reversed = dir === "RL" || dir === "BT";
  const origin = opts.origin ?? { x: 0, y: 0 };
  const w = opts.node_width ?? 180;
  const h = opts.node_height ?? 64;
  const levelGap = opts.level_spacing ?? 100;
  const nodeGap = opts.node_spacing ?? 40;
  const connectorStyle = opts.connector_style ?? "ELBOWED";

  const diagram: ParsedDiagram = {
    direction: dir,
    nodes: opts.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      shape: n.shape ?? "box",
    })),
    edges: opts.edges,
  };
  const laidOut = layoutNodes(diagram);

  const positions: Record<string, { x: number; y: number }> = {};
  // Group by level for centered layout per level.
  const byLevel = new Map<number, LaidOutNode[]>();
  for (const n of laidOut) {
    if (!byLevel.has(n.level)) byLevel.set(n.level, []);
    byLevel.get(n.level)!.push(n);
  }
  for (const [lvl, nodes] of byLevel) {
    const total =
      nodes.length * (horizontal ? h : w) +
      (nodes.length - 1) * nodeGap;
    let cursor = -total / 2;
    for (const n of nodes) {
      const along = cursor;
      cursor += (horizontal ? h : w) + nodeGap;
      const acrossLevels =
        (reversed ? -1 : 1) * (lvl * ((horizontal ? w : h) + levelGap));
      positions[n.id] = horizontal
        ? { x: origin.x + acrossLevels, y: origin.y + along }
        : { x: origin.x + along, y: origin.y + acrossLevels };
    }
  }

  return `
    const positions = ${J(positions)};
    const direction = ${J(dir)};
    const w = ${w}, h = ${h};
    const connectorStyle = ${J(connectorStyle)};
    const fontLoaded = await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

    const createdNodes = {};
    const inputs = ${J(diagram.nodes)};

    for (const spec of inputs) {
      let node;
      switch (spec.shape) {
        case 'circle':
          node = figma.createEllipse();
          node.resize(w, h);
          break;
        case 'pill':
          node = figma.createRectangle();
          node.resize(w, h);
          node.cornerRadius = h / 2;
          break;
        case 'diamond':
          node = figma.createPolygon();
          node.pointCount = 4;
          node.resize(w, h);
          node.rotation = 0;
          break;
        case 'box':
        default:
          node = figma.createRectangle();
          node.resize(w, h);
          node.cornerRadius = 8;
      }
      node.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.97, b: 1 } }];
      node.strokes = [{ type: 'SOLID', color: { r: 0.18, g: 0.38, b: 0.72 } }];
      node.strokeWeight = 1.5;
      node.x = positions[spec.id].x;
      node.y = positions[spec.id].y;
      node.name = spec.label || spec.id;
      figma.currentPage.appendChild(node);

      const t = figma.createText();
      t.fontName = { family: 'Inter', style: 'Regular' };
      t.fontSize = 14;
      t.characters = spec.label || spec.id;
      t.textAlignHorizontal = 'CENTER';
      t.textAlignVertical = 'CENTER';
      t.resize(w - 16, h - 16);
      t.x = node.x + 8;
      t.y = node.y + 8;
      figma.currentPage.appendChild(t);

      createdNodes[spec.id] = { node, text: t };
    }

    const edges = ${J(diagram.edges)};
    const connectors = [];
    for (const e of edges) {
      const src = createdNodes[e.from]?.node;
      const dst = createdNodes[e.to]?.node;
      if (!src || !dst) continue;
      try {
        const c = figma.createConnector();
        c.connectorStart = { endpointNodeId: src.id, magnet: 'AUTO' };
        c.connectorEnd = { endpointNodeId: dst.id, magnet: 'AUTO' };
        c.connectorLineType = connectorStyle;
        c.strokes = [{ type: 'SOLID', color: { r: 0.18, g: 0.38, b: 0.72 } }];
        c.strokeWeight = 1.5;
        if (e.label) {
          try {
            await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            c.text.characters = e.label;
          } catch {}
        }
        connectors.push({ id: c.id, from: e.from, to: e.to, label: e.label });
      } catch (err) {
        connectors.push({ from: e.from, to: e.to, error: String(err && err.message || err) });
      }
    }

    return {
      direction,
      nodes: Object.entries(createdNodes).map(([id, v]) => ({ id, figma_id: v.node.id, name: v.node.name })),
      connectors,
    };
  `;
}

// ---- Tool registration ---------------------------------------------------

export function registerDiagramTools(
  server: McpServer,
  bridge: PluginBridge,
): void {
  const exec = (code: string, timeoutMs?: number) =>
    bridge.send("exec", { code }, timeoutMs);

  server.registerTool(
    "create_flowchart",
    {
      title: "Draw a flowchart on the Figma canvas",
      description:
        "Builds boxes and connectors for the given nodes/edges. Layout is layered (BFS from sources). Direction TD = top-down (default), LR = left-right.",
      inputSchema: {
        nodes: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
              shape: z.enum(["box", "pill", "circle", "diamond"]).optional(),
            }),
          )
          .min(1),
        edges: z
          .array(
            z.object({
              from: z.string().min(1),
              to: z.string().min(1),
              label: z.string().optional(),
            }),
          )
          .min(0),
        direction: z.enum(["TD", "TB", "LR", "RL", "BT"]).optional(),
        origin: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Canvas position for the diagram's center axis."),
        node_width: z.number().positive().optional(),
        node_height: z.number().positive().optional(),
        level_spacing: z.number().positive().optional(),
        node_spacing: z.number().positive().optional(),
        connector_style: z.enum(["STRAIGHT", "ELBOWED"]).optional(),
      },
    },
    async (args) => {
      try {
        const code = buildFlowchartCode(args as FlowchartOpts);
        return ok(await exec(code, 60_000));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "mermaid_to_canvas",
    {
      title: "Render simple Mermaid flowchart on the canvas",
      description:
        "Parses a Mermaid `flowchart TD|LR|...` block (nodes A[label]/A(label)/A((label))/A{label}; edges A-->B and A--label-->B) and renders it via create_flowchart. Subgraphs and class definitions are not supported.",
      inputSchema: {
        mermaid: z.string().min(1),
        origin: z
          .object({ x: z.number(), y: z.number() })
          .optional(),
        node_width: z.number().positive().optional(),
        node_height: z.number().positive().optional(),
        level_spacing: z.number().positive().optional(),
        node_spacing: z.number().positive().optional(),
        connector_style: z.enum(["STRAIGHT", "ELBOWED"]).optional(),
      },
    },
    async (args) => {
      try {
        const parsed = parseMermaidFlowchart(args.mermaid);
        const code = buildFlowchartCode({
          nodes: parsed.nodes,
          edges: parsed.edges,
          direction: parsed.direction,
          origin: args.origin,
          node_width: args.node_width,
          node_height: args.node_height,
          level_spacing: args.level_spacing,
          node_spacing: args.node_spacing,
          connector_style: args.connector_style,
        });
        return ok(await exec(code, 60_000));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
