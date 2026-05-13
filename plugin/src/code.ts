// Plugin main thread (sandbox). Receives wire requests via the UI iframe,
// executes them against the Figma plugin API, and posts the response back.

interface WireRequest {
  id: string;
  type: string;
  payload?: unknown;
}

interface WireResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface UiToSandbox {
  kind: "request" | "bridge-status";
  request?: WireRequest;
  connected?: boolean;
}

figma.showUI(__html__, { width: 320, height: 240, title: "Gemma 4 MCP" });

figma.ui.onmessage = async (msg: UiToSandbox) => {
  if (msg.kind === "bridge-status") {
    return;
  }
  if (msg.kind !== "request" || !msg.request) return;

  const { request } = msg;
  try {
    const result = await handle(request);
    reply({ id: request.id, ok: true, result });
  } catch (err) {
    reply({
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function reply(response: WireResponse) {
  figma.ui.postMessage({ kind: "response", response });
}

async function handle(req: WireRequest): Promise<unknown> {
  switch (req.type) {
    case "ping":
      return { pong: true, fileName: figma.root.name };

    case "get_current_page":
      return summarizePage(figma.currentPage);

    case "get_selection":
      return figma.currentPage.selection.map(summarizeNode);

    case "exec":
      return execCode(req.payload as { code: string; async?: boolean });

    case "get_screenshot":
      return screenshot(
        req.payload as {
          node_ids?: string[];
          format?: "PNG" | "JPG" | "SVG";
          scale?: number;
        },
      );

    default:
      throw new Error(`Unknown request type: ${req.type}`);
  }
}

function summarizePage(page: PageNode) {
  return {
    id: page.id,
    name: page.name,
    children_count: page.children.length,
    selection: page.selection.map(summarizeNode),
  };
}

function summarizeNode(node: SceneNode) {
  const base = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  } as Record<string, unknown>;
  if ("width" in node && "height" in node) {
    base.width = node.width;
    base.height = node.height;
  }
  if ("x" in node && "y" in node) {
    base.x = node.x;
    base.y = node.y;
  }
  if ("children" in node) {
    base.children_count = (node as ChildrenMixin).children.length;
  }
  return base;
}

async function execCode(payload: { code: string; async?: boolean }) {
  if (!payload || typeof payload.code !== "string") {
    throw new Error("exec: payload.code (string) is required");
  }
  // The snippet runs with `figma` available as the global. We wrap the user
  // body in an async function so they can use `await` and `return`.
  const factory = new Function(
    "figma",
    "selection",
    "currentPage",
    `return (async () => { ${payload.code} \n })();`,
  );
  const result = await factory(figma, figma.currentPage.selection, figma.currentPage);
  return jsonSafe(result);
}

async function screenshot(payload: {
  node_ids?: string[];
  format?: "PNG" | "JPG" | "SVG";
  scale?: number;
}) {
  const format = payload?.format ?? "PNG";
  const scale = payload?.scale ?? 2;
  let nodes: readonly SceneNode[];
  if (payload?.node_ids && payload.node_ids.length > 0) {
    const found: SceneNode[] = [];
    for (const id of payload.node_ids) {
      const node = await figma.getNodeByIdAsync(id);
      if (node && "exportAsync" in node) found.push(node as SceneNode);
    }
    if (found.length === 0) {
      throw new Error("None of the provided node_ids were found in this file");
    }
    nodes = found;
  } else {
    nodes = figma.currentPage.selection;
    if (nodes.length === 0) {
      throw new Error("No selection — pick a node in Figma or pass node_ids");
    }
  }

  const out: { id: string; name: string; format: string; base64: string }[] = [];
  for (const node of nodes) {
    const bytes = await (node as SceneNode & {
      exportAsync: (settings: ExportSettings) => Promise<Uint8Array>;
    }).exportAsync(
      format === "SVG"
        ? { format: "SVG" }
        : { format, constraint: { type: "SCALE", value: scale } },
    );
    out.push({
      id: node.id,
      name: node.name,
      format,
      base64: bytesToBase64(bytes),
    });
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // figma.base64Encode exists in newer plugin runtimes; fall back otherwise.
  const f = figma as unknown as { base64Encode?: (b: Uint8Array) => string };
  if (typeof f.base64Encode === "function") {
    return f.base64Encode(bytes);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa exists in the plugin sandbox.
  return btoa(bin);
}

// Strip values that can't survive a JSON round-trip (functions, undefined,
// cyclic refs). We also unwrap Figma node instances to their summaries so
// users can simply `return node` from exec snippets.
function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "undefined" || t === "function" || t === "symbol") return undefined;
  if (t !== "object") return value;
  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  // Figma node detection — they expose `id` and `type` and `exportAsync`-ish surface.
  if ("id" in obj && "type" in obj && "name" in obj) {
    return summarizeNode(obj as SceneNode);
  }
  if (Array.isArray(value)) {
    return value.map((v) => jsonSafe(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const safe = jsonSafe(v, seen);
    if (safe !== undefined) out[k] = safe;
  }
  return out;
}
