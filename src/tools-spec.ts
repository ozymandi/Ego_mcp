import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import { J } from "./canvas-helpers.js";
import { ok, fail } from "./result.js";

// get_node_spec: a design spec of a live node, compact enough for a local
// model and complete enough for a large one to write code from. Structure,
// auto-layout, sizing, fills/strokes as hex, bound variables, typography,
// instances with their component and properties.

const SPEC_JS = `
  const toHex = (c, o) => {
    const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    const a = o === undefined ? 1 : o;
    return '#' + h(c.r) + h(c.g) + h(c.b) + (a < 1 ? '@' + Math.round(a * 100) + '%' : '');
  };
  const num = (v) => Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
  const varName = async (alias) => {
    if (!alias || !alias.id) return null;
    const v = await figma.variables.getVariableByIdAsync(alias.id);
    return v ? v.name : alias.id;
  };
  const paintStr = async (paints, bound) => {
    if (paints === figma.mixed) return 'mixed';
    if (!paints || !paints.length) return null;
    const vis = paints.filter(p => p.visible !== false);
    if (!vis.length) return null;
    const p = vis[0];
    let s;
    if (p.type === 'SOLID') {
      s = toHex(p.color, p.opacity);
      const bv = p.boundVariables && p.boundVariables.color;
      if (bv) { const n = await varName(bv); if (n) s += '{' + n + '}'; }
    } else if (p.type === 'IMAGE') s = 'image';
    else if (p.type.startsWith('GRADIENT')) s = p.type.toLowerCase().replace('gradient_', 'gradient:');
    else s = p.type.toLowerCase();
    if (vis.length > 1) s += '+' + (vis.length - 1);
    return s;
  };
  const boundOf = async (node, field) => {
    const bv = node.boundVariables && node.boundVariables[field];
    return bv && bv.id ? await varName(bv) : null;
  };
  const withVar = async (node, field, value) => {
    const n = await boundOf(node, field);
    return n ? value + '{' + n + '}' : value;
  };

  const describe = async (n, depth, isRoot) => {
    const parts = [n.type, JSON.stringify(n.name), 'id=' + n.id];
    if (n.visible === false) parts.push('hidden');
    if ('width' in n) {
      const x = isRoot ? Math.round(n.absoluteTransform ? n.absoluteTransform[0][2] : n.x) : Math.round(n.x);
      const y = isRoot ? Math.round(n.absoluteTransform ? n.absoluteTransform[1][2] : n.y) : Math.round(n.y);
      const w = await withVar(n, 'width', num(n.width));
      const h = await withVar(n, 'height', num(n.height));
      parts.push('[' + x + ',' + y + ' ' + w + 'x' + h + ']');
    }
    if (n.type === 'INSTANCE') {
      const main = await n.getMainComponentAsync();
      if (main) {
        const owner = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
        parts.push('component=' + JSON.stringify(owner.name) + (owner !== main ? '/' + JSON.stringify(main.name) : '') + ' key=' + (owner.key || main.key));
      }
      const props = n.componentProperties || {};
      const ps = Object.entries(props).filter(([k, v]) => v.type !== 'INSTANCE_SWAP').map(([k, v]) => k.split('#')[0] + '=' + JSON.stringify(v.value)).slice(0, 8);
      if (ps.length) parts.push('props{' + ps.join(', ') + '}');
    }
    if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') {
      try { const d = n.componentPropertyDefinitions; const ks = Object.keys(d); if (ks.length) parts.push('propdefs{' + ks.map(k => k.split('#')[0] + ':' + d[k].type.toLowerCase()).join(', ') + '}'); } catch (e) {}
      if (n.key) parts.push('key=' + n.key);
    }
    if ('layoutMode' in n && n.layoutMode && n.layoutMode !== 'NONE') {
      parts.push('layout=' + n.layoutMode + (n.layoutWrap === 'WRAP' ? '/wrap' : ''));
      if (n.itemSpacing) parts.push('gap=' + await withVar(n, 'itemSpacing', num(n.itemSpacing)));
      const pads = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft];
      if (pads.some(p => p)) parts.push('pad=' + (pads.every(p => p === pads[0]) ? num(pads[0]) : pads.map(num).join('/')));
      const align = [n.primaryAxisAlignItems, n.counterAxisAlignItems].map(a => (a || 'MIN').toLowerCase());
      if (align[0] !== 'min' || align[1] !== 'min') parts.push('align=' + align.join('/'));
      const sz = [n.primaryAxisSizingMode, n.counterAxisSizingMode];
      if (sz[0] !== 'FIXED' || sz[1] !== 'FIXED') parts.push('axis=' + sz.map(s => (s || 'FIXED').toLowerCase()).join('/'));
    }
    if ('layoutSizingHorizontal' in n && n.parent && 'layoutMode' in n.parent && n.parent.layoutMode !== 'NONE') {
      const s = [n.layoutSizingHorizontal, n.layoutSizingVertical];
      if (s[0] !== 'FIXED' || s[1] !== 'FIXED') parts.push('size=' + s.map(x => (x || 'FIXED').toLowerCase()).join('x'));
      if (n.layoutPositioning === 'ABSOLUTE') parts.push('absolute');
    }
    if (n.type === 'TEXT') {
      const t = n.characters.replace(/\\s+/g, ' ').trim();
      parts.push(JSON.stringify(t.length > 80 ? t.slice(0, 80) + '…' : t));
      const fn = n.fontName === figma.mixed ? null : n.fontName;
      const fs = n.fontSize === figma.mixed ? 'mixed' : num(n.fontSize);
      parts.push((fn ? fn.family + ' ' + fn.style : 'mixed font') + ' ' + fs);
      if (n.lineHeight !== figma.mixed && n.lineHeight && n.lineHeight.unit !== 'AUTO') parts.push('lh=' + num(n.lineHeight.value) + (n.lineHeight.unit === 'PERCENT' ? '%' : ''));
      if (n.letterSpacing !== figma.mixed && n.letterSpacing && n.letterSpacing.value) parts.push('ls=' + num(n.letterSpacing.value) + (n.letterSpacing.unit === 'PERCENT' ? '%' : ''));
      if (n.textAlignHorizontal && n.textAlignHorizontal !== 'LEFT') parts.push('align=' + n.textAlignHorizontal.toLowerCase());
      if (n.textAutoResize && n.textAutoResize !== 'WIDTH_AND_HEIGHT') parts.push('resize=' + n.textAutoResize.toLowerCase());
      if (typeof n.textStyleId === 'string' && n.textStyleId) { const st = await figma.getStyleByIdAsync(n.textStyleId); if (st) parts.push('style=' + JSON.stringify(st.name)); }
    }
    if ('fills' in n) { const f = await paintStr(n.fills); if (f) parts.push('fill=' + f); }
    if ('strokes' in n) {
      const s = await paintStr(n.strokes);
      if (s) parts.push('stroke=' + s + (n.strokeWeight !== figma.mixed && n.strokeWeight ? '/' + num(n.strokeWeight) : ''));
    }
    if ('cornerRadius' in n && n.cornerRadius) {
      if (n.cornerRadius === figma.mixed) parts.push('r=' + [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius].map(num).join('/'));
      else parts.push('r=' + await withVar(n, 'topLeftRadius', num(n.cornerRadius)));
    }
    if ('opacity' in n && n.opacity < 1) parts.push('opacity=' + Math.round(n.opacity * 100) + '%');
    if ('effects' in n && n.effects && n.effects.length) {
      const e = n.effects.filter(x => x.visible !== false).map(x => x.type.toLowerCase().replace('_', '-'));
      if (e.length) parts.push('effects=' + e.join(','));
    }
    if ('clipsContent' in n && n.clipsContent && n.type === 'FRAME') parts.push('clip');
    if ('constraints' in n && n.constraints && (n.constraints.horizontal !== 'MIN' || n.constraints.vertical !== 'MIN') && !(n.parent && 'layoutMode' in n.parent && n.parent.layoutMode !== 'NONE')) {
      parts.push('constraints=' + n.constraints.horizontal.toLowerCase() + '/' + n.constraints.vertical.toLowerCase());
    }
    return parts.join(' ');
  };
`;

export function registerSpecTools(server: McpServer, bridge: PluginBridge): void {
  const exec = (code: string, timeoutMs?: number) => bridge.send("exec", { code }, timeoutMs);

  server.registerTool(
    "get_node_spec",
    {
      title: "Design spec of a node",
      description:
        "Compact spec of a live node (or the selection): one line per layer with position/size, auto-layout, sizing, fills/strokes as hex with {variable} names, radius, effects, typography, instances with component + props. Use before implementing a design in code or before editing it.",
      inputSchema: {
        node_id: z.string().optional().describe("Default: current selection."),
        max_depth: z.number().int().min(0).max(30).optional().default(8),
        max_nodes: z.number().int().positive().max(2000).optional().default(300),
      },
    },
    async ({ node_id, max_depth, max_nodes }) => {
      try {
        return ok(
          await exec(
            `
            ${SPEC_JS}
            let roots;
            if (${J(node_id ?? null)}) { const n = await figma.getNodeByIdAsync(${J(node_id ?? "")}); if (!n) throw new Error('Node not found: ' + ${J(node_id ?? "")}); roots = [n]; }
            else { roots = figma.currentPage.selection; if (!roots.length) throw new Error('Nothing selected; pass node_id'); }
            const lines = []; let count = 0; let cut = 0;
            const walk = async (n, depth, isRoot) => {
              if (count >= ${max_nodes}) { cut++; return; }
              count++;
              lines.push('  '.repeat(depth) + '- ' + await describe(n, depth, isRoot));
              if (!('children' in n) || !n.children.length) return;
              if (n.type === 'INSTANCE' && depth > 0) return; // instance internals belong to the component
              if (depth >= ${max_depth}) { lines.push('  '.repeat(depth + 1) + '… ' + n.children.length + ' children (raise max_depth or call get_node_spec on id=' + n.id + ')'); return; }
              for (const c of n.children) await walk(c, depth + 1, false);
            };
            for (const r of roots) await walk(r, 0, true);
            if (cut) lines.push('… ' + cut + ' more nodes not shown (max_nodes=${max_nodes})');
            const path = roots[0].parent && roots[0].parent.type !== 'PAGE' ? ' (inside ' + roots[0].parent.name + ')' : '';
            return 'page: ' + JSON.stringify(figma.currentPage.name) + path + '\\n' + lines.join('\\n');
          `,
            60_000,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}
