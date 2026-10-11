// Compact text outline of Figma REST node JSON. One line per node:
//
//   - FRAME "Card" id=12:34 [100,200 320x180] layout=VERTICAL gap=8 pad=16 fill=#ffffff r=12
//     - TEXT "Title" id=12:35 [116,216 288x22] "Card title" Inter 18/700 fill=#111111
//
// A 2 MB REST payload becomes a few KB that a local model can actually read.

interface RestColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface RestPaint {
  type?: string;
  visible?: boolean;
  color?: RestColor;
  opacity?: number;
}

export interface RestNode {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  children?: RestNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  characters?: string;
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number };
  fills?: RestPaint[];
  strokes?: RestPaint[];
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  cornerRadius?: number;
  opacity?: number;
  componentId?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  boundVariables?: Record<string, unknown>;
}

export interface OutlineOptions {
  /** Deepest level to descend into. Root is depth 0. */
  maxDepth?: number;
  /** Stop after this many lines and append a marker. */
  maxNodes?: number;
  /** Characters of text content to show per TEXT node. */
  textChars?: number;
}

const DEFAULTS: Required<OutlineOptions> = {
  maxDepth: 8,
  maxNodes: 400,
  textChars: 60,
};

function hex(c: RestColor): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function paintSummary(paints: RestPaint[] | undefined): string | null {
  if (!paints || paints.length === 0) return null;
  const visible = paints.filter((p) => p.visible !== false);
  if (visible.length === 0) return null;
  const first = visible[0]!;
  if (first.type === "SOLID" && first.color) {
    const alpha = first.opacity ?? first.color.a ?? 1;
    const base = hex(first.color);
    const suffix = alpha < 1 ? `@${Math.round(alpha * 100)}%` : "";
    return visible.length > 1 ? `${base}${suffix}+${visible.length - 1}` : `${base}${suffix}`;
  }
  return (first.type ?? "paint").toLowerCase();
}

function num(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function describe(n: RestNode, textChars: number): string {
  const parts: string[] = [];
  parts.push(n.type ?? "NODE");
  if (n.name !== undefined) parts.push(JSON.stringify(n.name));
  if (n.id) parts.push(`id=${n.id}`);
  const bb = n.absoluteBoundingBox;
  if (bb) parts.push(`[${num(bb.x)},${num(bb.y)} ${num(bb.width)}x${num(bb.height)}]`);
  if (n.visible === false) parts.push("hidden");

  if (n.type === "TEXT" && typeof n.characters === "string") {
    const t = n.characters.replace(/\s+/g, " ").trim();
    parts.push(JSON.stringify(t.length > textChars ? `${t.slice(0, textChars)}…` : t));
    const s = n.style;
    if (s) {
      const font = [s.fontFamily, s.fontSize !== undefined ? `${num(s.fontSize)}${s.fontWeight ? `/${s.fontWeight}` : ""}` : null]
        .filter(Boolean)
        .join(" ");
      if (font) parts.push(font);
    }
  }

  if (n.layoutMode && n.layoutMode !== "NONE") {
    parts.push(`layout=${n.layoutMode}`);
    if (n.itemSpacing) parts.push(`gap=${num(n.itemSpacing)}`);
    const pads = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((p) => p ?? 0);
    if (pads.some((p) => p !== 0)) {
      const uniform = pads.every((p) => p === pads[0]);
      parts.push(`pad=${uniform ? num(pads[0]!) : pads.map(num).join("/")}`);
    }
  }
  const sizing = [n.layoutSizingHorizontal, n.layoutSizingVertical].filter(Boolean);
  if (sizing.length === 2 && !(sizing[0] === "FIXED" && sizing[1] === "FIXED")) {
    parts.push(`size=${sizing[0]}x${sizing[1]}`);
  }

  const fill = paintSummary(n.fills);
  if (fill) parts.push(`fill=${fill}`);
  const stroke = paintSummary(n.strokes);
  if (stroke) parts.push(`stroke=${stroke}`);
  if (n.cornerRadius) parts.push(`r=${num(n.cornerRadius)}`);
  if (n.opacity !== undefined && n.opacity < 1) parts.push(`opacity=${Math.round(n.opacity * 100)}%`);
  if (n.componentId) parts.push(`component=${n.componentId}`);
  if (n.boundVariables && Object.keys(n.boundVariables).length > 0) {
    parts.push(`vars=${Object.keys(n.boundVariables).join(",")}`);
  }
  return parts.join(" ");
}

/** Renders a node subtree as an indented outline. */
export function outlineNode(root: RestNode, opts: OutlineOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const lines: string[] = [];
  let truncated = 0;
  const walk = (n: RestNode, depth: number) => {
    if (lines.length >= o.maxNodes) {
      truncated++;
      return;
    }
    lines.push(`${"  ".repeat(depth)}- ${describe(n, o.textChars)}`);
    const kids = n.children ?? [];
    if (kids.length === 0) return;
    if (depth >= o.maxDepth) {
      lines.push(`${"  ".repeat(depth + 1)}… ${kids.length} children (raise max_depth or use get_node on id=${n.id})`);
      return;
    }
    for (const c of kids) walk(c, depth + 1);
  };
  walk(root, 0);
  if (truncated > 0) {
    lines.push(`… ${truncated} more nodes not shown (max_nodes=${o.maxNodes}; narrow with node_ids or max_depth)`);
  }
  return lines.join("\n");
}

interface FileResponse {
  name?: string;
  lastModified?: string;
  version?: string;
  document?: RestNode;
  components?: Record<string, unknown>;
  styles?: Record<string, unknown>;
}

/** Outline for GET /v1/files/:key. */
export function outlineFile(file: FileResponse, opts: OutlineOptions = {}): string {
  const head = [
    `file: ${JSON.stringify(file.name ?? "")}`,
    file.lastModified ? `modified: ${file.lastModified}` : null,
    file.components ? `components: ${Object.keys(file.components).length}` : null,
    file.styles ? `styles: ${Object.keys(file.styles).length}` : null,
  ]
    .filter(Boolean)
    .join("  ");
  const pages = file.document?.children ?? [];
  const body = pages.map((p) => outlineNode(p, opts)).join("\n");
  return `${head}\n${body}`;
}

interface NodesResponse {
  name?: string;
  nodes?: Record<string, { document?: RestNode } | null>;
}

/** Outline for GET /v1/files/:key/nodes. */
export function outlineNodes(res: NodesResponse, opts: OutlineOptions = {}): string {
  const entries = Object.entries(res.nodes ?? {});
  const blocks = entries.map(([id, entry]) =>
    entry?.document ? outlineNode(entry.document, opts) : `- (not found) id=${id}`,
  );
  return `file: ${JSON.stringify(res.name ?? "")}\n${blocks.join("\n")}`;
}
