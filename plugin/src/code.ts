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
  // Set when the error is one we recognise: what to do, and whether the
  // snippet can be re-sent without first re-reading the canvas.
  hint?: string;
  safe_to_retry?: boolean;
}

interface UiToSandbox {
  kind: "request" | "bridge-status";
  request?: WireRequest;
  connected?: boolean;
}

interface ExecPayload {
  code: string;
  // Collect ids of nodes created/changed while the snippet ran and merge
  // them into the response (use_figma sets this; structured tools don't).
  track?: boolean;
  // After a tracked run, export the top-level created nodes (max 2) so the
  // model sees what it built without a second round-trip.
  screenshot?: boolean;
  // Soft limit on nodes created per call; exceeding it adds a warning.
  max_created?: number;
  // When the snippet throws, remove the nodes it created (tracked) first.
  rollback_on_error?: boolean;
}

import { BUILD } from "./build-info";

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
    const message = err instanceof Error ? err.message : String(err);
    const diag = diagnose(message);
    reply({
      id: request.id,
      ok: false,
      error: message,
      hint: diag?.hint,
      safe_to_retry: diag?.safe_to_retry,
    });
  }
};

function reply(response: WireResponse) {
  figma.ui.postMessage({ kind: "response", response });
}

async function handle(req: WireRequest): Promise<unknown> {
  switch (req.type) {
    case "ping":
      return {
        pong: true,
        fileName: figma.root.name,
        editorType: figma.editorType,
        currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
        build: BUILD,
      };

    case "get_current_page":
      return summarizePage(figma.currentPage);

    case "get_selection":
      return figma.currentPage.selection.map(summarizeNode);

    case "exec":
      return execCode(req.payload as ExecPayload);

    case "get_screenshot":
      return screenshot(
        req.payload as {
          node_ids?: string[];
          format?: "PNG" | "JPG" | "SVG";
          scale?: number;
          max_px?: number;
        },
      );

    case "place_image":
      return placeImage(
        req.payload as {
          base64: string;
          mime_type?: string;
          x: number;
          y: number;
          width?: number;
          height?: number;
          name?: string;
          parent_id?: string;
          fit?: "FILL" | "FIT" | "CROP" | "TILE";
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

// ---------------------------------------------------------------------------
// Error diagnosis: map the Plugin API's terse messages to an actionable hint.
// `safe_to_retry` = the fix is in the snippet; nothing on the canvas changed
// in a way the model needs to re-read first.

const DIAGNOSES: { re: RegExp; hint: string; safe_to_retry: boolean }[] = [
  {
    re: /unloaded font|font .* not loaded|loadFontAsync/i,
    hint: "Load the font before editing text: `await loadFontsFor(node)` for existing text, or `await figma.loadFontAsync({family:'Inter', style:'Regular'})` before setting characters/fontSize on new text.",
    safe_to_retry: true,
  },
  {
    re: /set_currentPage|Setting figma\.currentPage|setCurrentPageAsync instead/i,
    hint: "Use `await figma.setCurrentPageAsync(page)` to switch pages.",
    safe_to_retry: true,
  },
  {
    re: /layoutSizing|must be an auto-layout frame|FILL can only be set|HUG can only be set/i,
    hint: "Append the node to an auto-layout parent first (`createAutoLayout('VERTICAL')` + `appendChild`), resize() before sizing, then set layoutSizingHorizontal/Vertical. FIXED | HUG | FILL are for children; the frame itself uses primaryAxisSizingMode/counterAxisSizingMode = FIXED | AUTO.",
    safe_to_retry: true,
  },
  {
    re: /Expected 'FIXED' \| 'AUTO'|Expected "FIXED" \| "AUTO"/i,
    hint: "primaryAxisSizingMode/counterAxisSizingMode take 'FIXED' or 'AUTO' (not HUG/FILL). HUG/FILL go on layoutSizingHorizontal/Vertical of a child.",
    safe_to_retry: true,
  },
  {
    re: /out of range|Expected number in range|must be between 0 and 1/i,
    hint: "Colors are 0-1 per channel, not 0-255. Use `hex('#0d99ff')` or divide by 255. Opacity goes on the paint, not inside color.",
    safe_to_retry: true,
  },
  {
    re: /Node not found|does not exist|cannot read propert(y|ies)\b.*\bof (null|undefined)|null is not an object|undefined is not an object/i,
    hint: "A node id was wrong or the node is gone (wrong page, deleted, or re-created with a new id). Re-find it with find_nodes / currentPage.findAllWithCriteria before retrying.",
    safe_to_retry: false,
  },
  {
    re: /getNodeById is not a function|figma\.getNodeById/i,
    hint: "Use `await figma.getNodeByIdAsync(id)` (dynamic-page access has no sync lookup).",
    safe_to_retry: true,
  },
  {
    re: /not implemented|figma\.notify|closePlugin|showUI/i,
    hint: "figma.notify / closePlugin / ui APIs are not available inside snippets. Just `return` data.",
    safe_to_retry: true,
  },
  {
    re: /Cannot set property .* of .* which has only a getter|read.?only/i,
    hint: "fills/strokes/effects are read-only arrays: build a new array and assign it. Some properties (width/height) need resize().",
    safe_to_retry: true,
  },
  {
    re: /characters|fontSize|fontName/i,
    hint: "Only TEXT nodes have characters/fontSize/fontName. Narrow with `node.type === 'TEXT'` first, and load fonts before writing.",
    safe_to_retry: true,
  },
  {
    re: /componentPropertyDefinitions/i,
    hint: "Read componentPropertyDefinitions on the COMPONENT_SET (or a COMPONENT that is not a variant), never on a variant inside a set.",
    safe_to_retry: true,
  },
  {
    re: /is not defined/i,
    hint: "Undefined name. In scope: figma, selection, currentPage, and helpers query(figma.currentPage, 'FRAME[name=Card]'), set(node, {...}), createAutoLayout('VERTICAL', {...}), await loadFontsFor(node), hex('#0d99ff'), solid('#0d99ff'). For a node id use `await figma.getNodeByIdAsync('12:34')`.",
    safe_to_retry: true,
  },
  {
    re: /not a function/i,
    hint: "That method does not exist. Common correct names: figma.createComponentFromNode(node), component.createInstance(), figma.createFrame()/createText()/createRectangle(), figma.group(nodes, parent), figma.combineAsVariants(components, parent), node.findAllWithCriteria({types:['TEXT']}), instance.setProperties({...}), await figma.importComponentByKeyAsync(key). Variables: figma.variables.createVariableCollection(name), figma.variables.createVariable(name, collection, 'COLOR'|'FLOAT'|'STRING'|'BOOLEAN'), variable.setValueForMode(modeId, value), figma.variables.setBoundVariableForPaint(paint, 'color', variable), node.setBoundVariable(field, variable). Text styles: figma.createTextStyle(), await node.setTextStyleIdAsync(id). Or use the structured tools (create_variables, bind_variables).",
    safe_to_retry: true,
  },
  {
    re: /SyntaxError|Unexpected token|Unexpected identifier/i,
    hint: "The snippet did not parse. Send the plain body of an async function (no outer `(async () => {})()` wrapper, no `import`).",
    safe_to_retry: true,
  },
];

function diagnose(message: string): { hint: string; safe_to_retry: boolean } | null {
  for (const d of DIAGNOSES) {
    if (d.re.test(message)) return { hint: d.hint, safe_to_retry: d.safe_to_retry };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snippet helpers. Exposed inside use_figma snippets as plain functions so a
// model that writes modest JavaScript does not need the verbose API.

type Rgb = { r: number; g: number; b: number };

function hex(input: string): Rgb {
  const m = String(input).trim().match(/^#?([0-9a-fA-F]{3,8})$/);
  if (!m) throw new Error(`hex(): invalid color '${input}'. Use #rrggbb or #rrggbbaa.`);
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4) };
}

function hexAlpha(input: string): number {
  const h = String(input).trim().replace(/^#/, "");
  const full = h.length === 4 ? h.split("").map((c) => c + c).join("") : h;
  return full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
}

function solid(input: string, opacity?: number): SolidPaint {
  const a = opacity ?? hexAlpha(input);
  return a < 1
    ? { type: "SOLID", color: hex(input), opacity: a }
    : { type: "SOLID", color: hex(input) };
}

async function loadFontsFor(node: BaseNode): Promise<number> {
  let loaded = 0;
  const visit = async (n: BaseNode) => {
    if (n.type === "TEXT") {
      const t = n as TextNode;
      if (t.fontName === figma.mixed) {
        for (const seg of t.getStyledTextSegments(["fontName"])) {
          await figma.loadFontAsync(seg.fontName);
          loaded++;
        }
      } else {
        await figma.loadFontAsync(t.fontName);
        loaded++;
      }
    }
    if ("children" in n) {
      for (const c of (n as ChildrenMixin).children) await visit(c);
    }
  };
  await visit(node);
  return loaded;
}

const SIZING_FIRST = ["layoutMode", "primaryAxisSizingMode", "counterAxisSizingMode"];

function set<T extends BaseNode>(node: T, props: Record<string, unknown>): T {
  const n = node as unknown as Record<string, unknown>;
  const keys = Object.keys(props).sort(
    (a, b) => Number(SIZING_FIRST.includes(b)) - Number(SIZING_FIRST.includes(a)),
  );
  let w: number | undefined;
  let h: number | undefined;
  for (const k of keys) {
    const v = props[k];
    if (k === "width") w = v as number;
    else if (k === "height") h = v as number;
    else if (k === "fill" && typeof v === "string") n.fills = [solid(v)];
    else if (k === "stroke" && typeof v === "string") n.strokes = [solid(v)];
    else if (k === "padding" && typeof v === "number") {
      n.paddingTop = n.paddingBottom = n.paddingLeft = n.paddingRight = v;
    } else n[k] = v;
  }
  if (w !== undefined || h !== undefined) {
    const cur = node as unknown as { width: number; height: number; resize: (w: number, h: number) => void };
    cur.resize(w ?? cur.width, h ?? cur.height);
  }
  return node;
}

function createAutoLayout(
  direction: "HORIZONTAL" | "VERTICAL" | Record<string, unknown> = "HORIZONTAL",
  props: Record<string, unknown> = {},
): FrameNode {
  if (typeof direction === "object") {
    props = direction;
    direction = "HORIZONTAL";
  }
  const f = figma.createFrame();
  f.layoutMode = direction;
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  set(f, props);
  return f;
}

// Minimal CSS-like selector: `FRAME`, `TEXT[name=Title]`, `[name*=card]`,
// `[name^=Btn]`, `[name$=/x]`, `[visible=false]`, `#12:34`, `*`,
// descendant (`A B`), child (`A > B`), union (`A, B`).
interface Sel {
  type: string | null;
  id: string | null;
  attrs: { key: string; op: "=" | "*=" | "^=" | "$="; val: string }[];
}

function parseCompound(src: string): Sel {
  const sel: Sel = { type: null, id: null, attrs: [] };
  let rest = src.trim();
  const tm = rest.match(/^([A-Za-z_*]+)/);
  if (tm) {
    sel.type = tm[1] === "*" ? null : tm[1]!.toUpperCase();
    rest = rest.slice(tm[0].length);
  }
  const im = rest.match(/^#([^\[\s]+)/);
  if (im) {
    sel.id = im[1]!;
    rest = rest.slice(im[0].length);
  }
  const attrRe = /\[\s*([A-Za-z_]+)\s*(\*=|\^=|\$=|=)\s*("([^"]*)"|'([^']*)'|([^\]]*))\s*\]/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(rest))) {
    sel.attrs.push({
      key: am[1]!,
      op: am[2] as Sel["attrs"][number]["op"],
      val: (am[4] ?? am[5] ?? am[6] ?? "").trim(),
    });
  }
  return sel;
}

function matches(n: BaseNode, s: Sel): boolean {
  if (s.type && n.type !== s.type) return false;
  if (s.id && n.id !== s.id) return false;
  const o = n as unknown as Record<string, unknown>;
  for (const a of s.attrs) {
    const raw = o[a.key];
    const v = raw === undefined || raw === null ? "" : String(raw);
    const t = a.val;
    const ok =
      a.op === "=" ? v === t :
      a.op === "*=" ? v.includes(t) :
      a.op === "^=" ? v.startsWith(t) :
      v.endsWith(t);
    if (!ok) return false;
  }
  return true;
}

function descendants(n: BaseNode): BaseNode[] {
  const out: BaseNode[] = [];
  if ("children" in n) {
    for (const c of (n as ChildrenMixin).children) {
      out.push(c);
      out.push(...descendants(c));
    }
  }
  return out;
}

function query(root: BaseNode, selector: string): SceneNode[] {
  const seen = new Set<string>();
  const result: SceneNode[] = [];
  for (const branch of selector.split(",")) {
    const tokens = branch.trim().split(/\s*(>)\s*|\s+/).filter((t) => t !== undefined && t !== "");
    let current: BaseNode[] = [root];
    let childOnly = false;
    for (const tok of tokens) {
      if (tok === ">") {
        childOnly = true;
        continue;
      }
      const sel = parseCompound(tok);
      const next: BaseNode[] = [];
      for (const base of current) {
        const pool = childOnly
          ? "children" in base ? [...(base as ChildrenMixin).children] : []
          : descendants(base);
        for (const cand of pool) if (matches(cand, sel)) next.push(cand);
      }
      current = next;
      childOnly = false;
    }
    for (const n of current) {
      if (n !== root && !seen.has(n.id)) {
        seen.add(n.id);
        result.push(n as SceneNode);
      }
    }
  }
  return result;
}

const HELPERS = { query, set, createAutoLayout, loadFontsFor, hex, solid };
const PRELUDE = "const { query, set, createAutoLayout, loadFontsFor, hex, solid } = __helpers;";

// ---------------------------------------------------------------------------
// Change tracking.
//
// Two sources, because neither alone is reliable:
//  1. A Proxy over `figma` notes the return value of every create*/group/
//     boolean-op call synchronously. Deterministic for the common case.
//  2. `documentchange` catches the rest (clone(), createInstance(), property
//     edits, deletes). Figma delivers it in batches, sometimes hundreds of ms
//     after the fact, so the listener stays on for the plugin's lifetime and
//     each exec claims the events delivered between its start and a quiet
//     period after its end.

interface BufferedChange {
  t: number;
  type: string;
  id: string;
}
const changeBuffer: BufferedChange[] = [];
let lastEventAt = 0;

// With documentAccess: dynamic-page, "documentchange" needs loadAllPagesAsync
// first. The per-page "nodechange" event has no such cost, so listen on the
// current page and follow page switches.
const onNodeChange = (ev: NodeChangeEvent) => {
  const t = Date.now();
  lastEventAt = t;
  for (const ch of ev.nodeChanges) {
    if (ch.type === "CREATE" || ch.type === "DELETE" || ch.type === "PROPERTY_CHANGE") {
      changeBuffer.push({ t, type: ch.type, id: ch.id });
    }
  }
  // Keep the buffer bounded.
  const cutoff = t - 5000;
  while (changeBuffer.length && changeBuffer[0]!.t < cutoff) changeBuffer.shift();
};
let watchedPage: PageNode | null = null;
function watchCurrentPage() {
  if (watchedPage === figma.currentPage) return;
  if (watchedPage) {
    try {
      watchedPage.off("nodechange", onNodeChange);
    } catch {
      // page may be gone
    }
  }
  watchedPage = figma.currentPage;
  watchedPage.on("nodechange", onNodeChange);
}
watchCurrentPage();
figma.on("currentpagechange", watchCurrentPage);

const CREATE_RE = /^(create(?!Image$)|group|union|subtract|intersect|exclude|flatten|combineAsVariants|ungroup)/;

function trackingApi(created: Set<string>): PluginAPI {
  // A Proxy over `figma` trips invariant checks on its frozen properties, so
  // build a plain forwarding object instead: methods bound to figma (create*
  // ones wrapped to note their result), everything else as live accessors.
  const note = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) note(x);
      return;
    }
    if (typeof v === "object") {
      const o = v as { id?: unknown; then?: unknown };
      if (typeof o.then === "function") {
        (v as Promise<unknown>).then(note, () => undefined);
      } else if (typeof o.id === "string" && "type" in o) {
        created.add(o.id);
      }
    }
  };
  const target = figma as unknown as Record<string, unknown>;
  const api: Record<string, unknown> = {};
  const seen = new Set<string>();
  let proto: object | null = figma;
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (seen.has(k) || k === "constructor") continue;
      seen.add(k);
      const d = Object.getOwnPropertyDescriptor(proto, k);
      if (!d) continue;
      if (typeof d.value === "function") {
        const fn = d.value as (...a: unknown[]) => unknown;
        api[k] = CREATE_RE.test(k)
          ? (...args: unknown[]) => {
              const r = fn.apply(figma, args);
              note(r);
              return r;
            }
          : fn.bind(figma);
      } else {
        Object.defineProperty(api, k, {
          enumerable: true,
          get: () => target[k],
          set: (v: unknown) => {
            target[k] = v;
          },
        });
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return api as unknown as PluginAPI;
}

async function settleChanges(start: number): Promise<void> {
  // Wait until no documentchange batch has arrived for 120 ms, at most 500 ms.
  const deadline = start + 500;
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, 60));
    const now = Date.now();
    if (now >= deadline) return;
    if (now - Math.max(lastEventAt, start) >= 120) return;
  }
}

async function execCode(payload: ExecPayload) {
  if (!payload || typeof payload.code !== "string") {
    throw new Error("exec: payload.code (string) is required");
  }
  const track = payload.track === true;
  const created = new Set<string>();
  const changed = new Set<string>();
  const deleted = new Set<string>();
  const start = Date.now();
  const api = track ? trackingApi(created) : figma;

  let result: unknown;
  try {
    // The snippet runs with `figma` available as the global. We wrap the user
    // body in an async function so they can use `await` and `return`.
    const factory = new Function(
      "figma",
      "selection",
      "currentPage",
      "__helpers",
      // The snippet gets its own block so redeclaring a helper name
      // (const hex = …) shadows ours instead of throwing.
      `return (async () => { ${PRELUDE}\n{\n${payload.code}\n}\n })();`,
    );
    result = await factory(api, figma.currentPage.selection, figma.currentPage, HELPERS);
  } catch (err) {
    if (track && payload.rollback_on_error !== false) {
      await settleChanges(Date.now());
      const rolled: string[] = [];
      for (const id of created) {
        try {
          const n = await figma.getNodeByIdAsync(id);
          if (n && !n.removed) {
            n.remove();
            rolled.push(id);
          }
        } catch {
          // already gone or not removable
        }
      }
      if (rolled.length) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${msg}\nRolled back ${rolled.length} node(s) created by this call (${rolled.slice(0, 8).join(", ")}${rolled.length > 8 ? ", …" : ""}); the canvas is as it was before the call.`);
      }
    }
    throw err;
  } finally {
    if (track) await settleChanges(Date.now());
  }

  const safe = jsonSafe(result);
  if (!track) return safe;

  for (const ch of changeBuffer) {
    if (ch.t < start) continue;
    if (ch.type === "CREATE") created.add(ch.id);
    else if (ch.type === "DELETE") deleted.add(ch.id);
    else if (ch.type === "PROPERTY_CHANGE") changed.add(ch.id);
  }
  // Claimed: drop them so a late batch is not attributed twice.
  for (let i = changeBuffer.length - 1; i >= 0; i--) {
    if (changeBuffer[i]!.t >= start) changeBuffer.splice(i, 1);
  }
  for (const id of deleted) {
    created.delete(id);
    changed.delete(id);
  }
  for (const id of created) changed.delete(id);
  // Children of a freshly created subtree report PROPERTY_CHANGE while they
  // are being set up; they are new, not "changed", so drop them.
  if (created.size && changed.size) {
    let budget = 200;
    for (const id of [...changed]) {
      if (budget-- <= 0) break;
      const n = await figma.getNodeByIdAsync(id);
      let p = n?.parent;
      while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
        if (created.has(p.id)) {
          changed.delete(id);
          break;
        }
        p = p.parent;
      }
    }
  }
  const out: Record<string, unknown> = { result: safe };
  if (created.size) out.created_ids = [...created];
  if (changed.size) out.changed_ids = [...changed];
  if (deleted.size) out.deleted_ids = [...deleted];
  const limit = payload.max_created ?? 2000;
  if (created.size > limit) {
    out.warning = `Created ${created.size} nodes in one call (soft limit ${limit}). Check for a runaway loop; delete with delete_nodes if unintended.`;
  }

  if (payload.screenshot && created.size) {
    // Top-most created nodes: created, with no created ancestor.
    const tops: SceneNode[] = [];
    for (const id of created) {
      const n = await figma.getNodeByIdAsync(id);
      if (!n || !("exportAsync" in n)) continue;
      let p = n.parent;
      let nested = false;
      while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
        if (created.has(p.id)) {
          nested = true;
          break;
        }
        p = p.parent;
      }
      if (!nested) tops.push(n as SceneNode);
      if (tops.length >= 2) break;
    }
    if (tops.length) {
      out.screenshots = await screenshot({
        node_ids: tops.map((n) => n.id),
        format: "PNG",
        scale: 1,
        max_px: 1024,
      });
    }
  }
  return out;
}

async function screenshot(payload: {
  node_ids?: string[];
  format?: "PNG" | "JPG" | "SVG";
  scale?: number;
  // Largest output dimension in px. The effective scale is reduced so the
  // render never exceeds it (keeps inline images small for the model).
  max_px?: number;
}) {
  const format = payload?.format ?? "PNG";
  const requestedScale = payload?.scale ?? 1;
  const maxPx = payload?.max_px ?? 1024;
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

  const out: {
    id: string;
    name: string;
    format: string;
    base64: string;
    scale: number;
    width: number;
    height: number;
  }[] = [];
  for (const node of nodes) {
    const w = "width" in node ? node.width : 0;
    const h = "height" in node ? node.height : 0;
    const longest = Math.max(w, h, 1);
    const scale = Math.min(requestedScale, maxPx / longest);
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
      scale: Math.round(scale * 1000) / 1000,
      width: Math.round(w * scale),
      height: Math.round(h * scale),
    });
  }
  return out;
}

async function placeImage(payload: {
  base64: string;
  mime_type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  name?: string;
  parent_id?: string;
  fit?: "FILL" | "FIT" | "CROP" | "TILE";
}) {
  if (!payload || typeof payload.base64 !== "string") {
    throw new Error("place_image: payload.base64 is required");
  }
  const bytes = base64ToBytes(payload.base64);
  const image = figma.createImage(bytes);
  const size = await image.getSizeAsync();

  const rect = figma.createRectangle();
  const targetW = payload.width ?? size.width;
  const targetH = payload.height ?? size.height;
  rect.x = payload.x;
  rect.y = payload.y;
  rect.resize(targetW, targetH);
  rect.name = payload.name ?? "Imported image";
  rect.fills = [
    {
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: payload.fit ?? "FILL",
    },
  ];

  let parent: BaseNode = figma.currentPage;
  if (payload.parent_id) {
    const p = await figma.getNodeByIdAsync(payload.parent_id);
    if (!p || !("appendChild" in p)) {
      throw new Error(
        `place_image: parent_id ${payload.parent_id} not found or doesn't accept children`,
      );
    }
    parent = p;
  }
  (parent as ChildrenMixin).appendChild(rect);

  return {
    id: rect.id,
    name: rect.name,
    type: rect.type,
    width: rect.width,
    height: rect.height,
    image_hash: image.hash,
    natural_size: size,
    fit: payload.fit ?? "FILL",
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const f = figma as unknown as { base64Decode?: (s: string) => Uint8Array };
  if (typeof f.base64Decode === "function") {
    return f.base64Decode(b64);
  }
  // Fallback for older plugin runtimes that lack figma.base64Decode.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
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

  // Figma node detection. Plain result objects often carry id/type/name too,
  // so require the node-only surface (parent + remove()) before summarising.
  if (
    "id" in obj &&
    "type" in obj &&
    "parent" in obj &&
    typeof (obj as { remove?: unknown }).remove === "function"
  ) {
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
