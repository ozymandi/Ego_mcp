// Snapshot of a Figma subtree: the plugin walks the nodes once and ships a
// compact JSON; the rules run on the server over this shape. Keeping the
// rules off the plugin makes them testable with fixtures and portable.

export interface SnapPaint {
  type: "SOLID" | "GRADIENT" | "IMAGE" | "OTHER";
  hex?: string;        // #rrggbb for SOLID
  opacity?: number;    // paint opacity * color alpha, 0..1
  gradient?: string;   // GRADIENT_LINEAR | GRADIENT_RADIAL | ...
  stops?: { hex: string; a: number; pos: number }[];
  bound?: boolean;     // color bound to a variable
}

export interface SnapEffect {
  type: string;        // DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR
  radius: number;
  hex?: string;
  a?: number;
  visible: boolean;
}

export interface SnapText {
  chars: string;
  family: string | "mixed";
  style: string | "mixed";
  size: number | "mixed";
  families?: string[];      // when mixed
  lineHeight?: { unit: string; value: number } | "mixed";
  letterSpacing?: { unit: string; value: number } | "mixed";
  align?: string;
  autoResize?: string;
  truncation?: string;
  styleId?: boolean;        // has a text style applied
}

export interface SnapNode {
  id: string;
  name: string;
  type: string;
  parent: string | null;
  children: string[];
  visible: boolean;
  x: number;               // relative to parent
  y: number;
  w: number;
  h: number;
  ax: number;              // absolute (page) bounds
  ay: number;
  opacity?: number;
  fills?: SnapPaint[];
  strokes?: SnapPaint[];
  strokeWeight?: number;
  effects?: SnapEffect[];
  radius?: number | number[];   // uniform or [tl, tr, br, bl]
  radiusBound?: boolean;
  layout?: {
    mode: "HORIZONTAL" | "VERTICAL";
    gap: number;
    pad: [number, number, number, number]; // t r b l
    gapBound?: boolean;
    padBound?: boolean;
  };
  positioning?: "AUTO" | "ABSOLUTE";
  clips?: boolean;
  fillStyle?: boolean;
  text?: SnapText;
  instance?: { main: string; set?: string };
}

export interface SnapContext {
  page: string;
  rootIds: string[];
  colorVariables: { name: string; hex: string }[];   // local COLOR variables, default mode
  numberVariables: { name: string; value: number }[]; // local FLOAT variables, default mode
  textStyles: number;
  paintStyles: number;
}

export interface Snapshot {
  context: SnapContext;
  nodes: Record<string, SnapNode>;
  truncated: boolean;
}

/**
 * JS executed inside the plugin via `exec`. `ROOT_IDS` and `MAX_NODES` are
 * interpolated by the caller. Returns a Snapshot.
 */
export function snapshotScript(rootIds: string[] | null, maxNodes: number): string {
  return `
    const toHex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    const paint = (p) => {
      if (!p || p.visible === false) return null;
      if (p.type === 'SOLID') return { type: 'SOLID', hex: toHex(p.color), opacity: (p.opacity === undefined ? 1 : p.opacity), bound: !!(p.boundVariables && p.boundVariables.color) };
      if (p.type && p.type.startsWith('GRADIENT')) return { type: 'GRADIENT', gradient: p.type, opacity: p.opacity === undefined ? 1 : p.opacity, stops: (p.gradientStops || []).map(s => ({ hex: toHex(s.color), a: s.color.a === undefined ? 1 : s.color.a, pos: s.position })) };
      if (p.type === 'IMAGE') return { type: 'IMAGE' };
      return { type: 'OTHER' };
    };
    const paints = (arr) => arr === figma.mixed ? undefined : (arr || []).map(paint).filter(Boolean);
    const num = (v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    const nodes = {}; let count = 0; let truncated = false;
    const walk = (n, parentId) => {
      if (count >= ${maxNodes}) { truncated = true; return; }
      count++;
      const o = { id: n.id, name: n.name, type: n.type, parent: parentId, children: [], visible: n.visible !== false,
        x: num(n.x || 0), y: num(n.y || 0), w: num(n.width || 0), h: num(n.height || 0),
        ax: num(n.absoluteTransform ? n.absoluteTransform[0][2] : (n.x || 0)), ay: num(n.absoluteTransform ? n.absoluteTransform[1][2] : (n.y || 0)) };
      if ('opacity' in n && n.opacity < 1) o.opacity = num(n.opacity);
      if ('fills' in n) o.fills = paints(n.fills);
      if ('strokes' in n) { o.strokes = paints(n.strokes); if (n.strokeWeight !== figma.mixed && n.strokeWeight) o.strokeWeight = num(n.strokeWeight); }
      if ('effects' in n && n.effects && n.effects.length) o.effects = n.effects.map(e => ({ type: e.type, radius: num(e.radius || 0), hex: e.color ? toHex(e.color) : undefined, a: e.color ? num(e.color.a === undefined ? 1 : e.color.a) : undefined, visible: e.visible !== false }));
      if ('cornerRadius' in n) {
        if (n.cornerRadius === figma.mixed) o.radius = [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius].map(num);
        else if (n.cornerRadius) o.radius = num(n.cornerRadius);
        if (n.boundVariables && (n.boundVariables.topLeftRadius || n.boundVariables.cornerRadius)) o.radiusBound = true;
      }
      if ('layoutMode' in n && n.layoutMode && n.layoutMode !== 'NONE') {
        const bv = n.boundVariables || {};
        o.layout = { mode: n.layoutMode, gap: num(n.itemSpacing || 0), pad: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map(v => num(v || 0)),
          gapBound: !!bv.itemSpacing, padBound: !!(bv.paddingTop || bv.paddingLeft) };
      }
      if ('layoutPositioning' in n && n.layoutPositioning === 'ABSOLUTE') o.positioning = 'ABSOLUTE';
      if ('clipsContent' in n && n.clipsContent) o.clips = true;
      if ('fillStyleId' in n && typeof n.fillStyleId === 'string' && n.fillStyleId) o.fillStyle = true;
      if (n.type === 'TEXT') {
        const t = { chars: n.characters.slice(0, 400) };
        if (n.fontName === figma.mixed) {
          t.family = 'mixed'; t.style = 'mixed';
          const fams = new Set(); try { for (const s of n.getStyledTextSegments(['fontName'])) fams.add(s.fontName.family); } catch (e) {}
          t.families = [...fams];
        } else { t.family = n.fontName.family; t.style = n.fontName.style; }
        t.size = n.fontSize === figma.mixed ? 'mixed' : num(n.fontSize);
        t.lineHeight = n.lineHeight === figma.mixed ? 'mixed' : (n.lineHeight && n.lineHeight.unit !== 'AUTO' ? { unit: n.lineHeight.unit, value: num(n.lineHeight.value) } : undefined);
        t.letterSpacing = n.letterSpacing === figma.mixed ? 'mixed' : (n.letterSpacing && n.letterSpacing.value ? { unit: n.letterSpacing.unit, value: num(n.letterSpacing.value) } : undefined);
        t.align = n.textAlignHorizontal; t.autoResize = n.textAutoResize; t.truncation = n.textTruncation;
        if (typeof n.textStyleId === 'string' && n.textStyleId) t.styleId = true;
        o.text = t;
      }
      nodes[n.id] = o;
      if ('children' in n && !(n.type === 'INSTANCE' && parentId)) {
        for (const c of n.children) { o.children.push(c.id); walk(c, n.id); }
      }
    };
    const rootIds = ${JSON.stringify(rootIds)};
    let roots;
    if (rootIds) { roots = []; for (const id of rootIds) { const n = await figma.getNodeByIdAsync(id); if (!n) throw new Error('Node not found: ' + id); roots.push(n); } }
    else { roots = figma.currentPage.selection; if (!roots.length) throw new Error('Nothing selected; pass node_id'); }
    for (const r of roots) walk(r, null);
    // instances: record main component after the walk (async)
    for (const o of Object.values(nodes)) {
      if (o.type === 'INSTANCE') {
        try { const n = await figma.getNodeByIdAsync(o.id); const m = await n.getMainComponentAsync(); if (m) o.instance = { main: m.name, set: m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent.name : undefined }; } catch (e) {}
      }
    }
    const colorVariables = [], numberVariables = [];
    try {
      const cols = {}; for (const c of await figma.variables.getLocalVariableCollectionsAsync()) cols[c.id] = c;
      for (const v of await figma.variables.getLocalVariablesAsync()) {
        const col = cols[v.variableCollectionId]; if (!col) continue;
        const val = v.valuesByMode[col.defaultModeId];
        if (v.resolvedType === 'COLOR' && val && typeof val === 'object' && 'r' in val) colorVariables.push({ name: v.name, hex: toHex(val) });
        else if (v.resolvedType === 'FLOAT' && typeof val === 'number') numberVariables.push({ name: v.name, value: val });
      }
    } catch (e) {}
    let textStyles = 0, paintStyles = 0;
    try { textStyles = (await figma.getLocalTextStylesAsync()).length; paintStyles = (await figma.getLocalPaintStylesAsync()).length; } catch (e) {}
    return { context: { page: figma.currentPage.name, rootIds: roots.map(r => r.id), colorVariables, numberVariables, textStyles, paintStyles }, nodes, truncated };
  `;
}
