import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import { J, resolveNode } from "./canvas-helpers.js";
import { ok, fail } from "./result.js";

// Local variables through the plugin. Unlike the Variables REST endpoints
// (Enterprise only), figma.variables works on every plan.

const nodeIdArg = z.string().min(1).describe("Node id, e.g. 12:345.");
const variableType = z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);

// JS helpers shared by the snippets.
const prelude = `
  const toHex = (c) => {
    const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + h(c.r) + h(c.g) + h(c.b) + (c.a !== undefined && c.a < 1 ? h(c.a) : '');
  };
  const fromHex = (s) => {
    const m = String(s).trim().match(/^#?([0-9a-f]{3,8})$/i);
    if (!m) throw new Error('Invalid color ' + s + ' (use #rrggbb or #rrggbbaa)');
    let x = m[1]; if (x.length === 3 || x.length === 4) x = x.split('').map(ch => ch + ch).join('');
    const n = (i) => parseInt(x.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: x.length === 8 ? n(6) : 1 };
  };
  const showValue = (v) => {
    if (v && typeof v === 'object' && v.type === 'VARIABLE_ALIAS') return { alias: v.id };
    if (v && typeof v === 'object' && 'r' in v) return toHex(v);
    return v;
  };
  // Accept a raw value or a "VariableID:..." alias string, convert per type.
  const toValue = async (raw, type) => {
    if (typeof raw === 'string' && raw.startsWith('VariableID:')) {
      const other = await figma.variables.getVariableByIdAsync(raw);
      if (!other) throw new Error('Alias target not found: ' + raw);
      return figma.variables.createVariableAlias(other);
    }
    if (type === 'COLOR') return typeof raw === 'string' ? fromHex(raw) : raw;
    if (type === 'FLOAT') { const n = Number(raw); if (Number.isNaN(n)) throw new Error('FLOAT needs a number'); return n; }
    if (type === 'BOOLEAN') return raw === true || raw === 'true';
    return String(raw);
  };
`;

export function registerVariableTools(server: McpServer, bridge: PluginBridge): void {
  const exec = (code: string, timeoutMs?: number) => bridge.send("exec", { code }, timeoutMs);

  server.registerTool(
    "list_variable_collections",
    {
      title: "List variable collections",
      description: "Local variable collections in the open file with their modes and variable counts.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(
          await exec(`
            const cols = await figma.variables.getLocalVariableCollectionsAsync();
            return cols.map(c => ({
              id: c.id, name: c.name, variable_count: c.variableIds.length,
              modes: c.modes.map(m => ({ id: m.modeId, name: m.name, default: m.modeId === c.defaultModeId || undefined })),
            }));
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_variables",
    {
      title: "List variables",
      description: "Local variables with values per mode (colors as hex, aliases as {alias}). Filter by collection and/or type.",
      inputSchema: {
        collection_id: z.string().optional(),
        type: variableType.optional(),
        name_pattern: z.string().optional().describe("Case-insensitive regex on the name."),
        limit: z.number().int().positive().max(1000).optional().default(200),
      },
    },
    async ({ collection_id, type, name_pattern, limit }) => {
      try {
        return ok(
          await exec(`
            ${prelude}
            const re = ${J(name_pattern ?? null)} ? new RegExp(${J(name_pattern ?? "")}, 'i') : null;
            let vars = await figma.variables.getLocalVariablesAsync(${J(type ?? undefined)});
            if (${J(collection_id ?? null)}) vars = vars.filter(v => v.variableCollectionId === ${J(collection_id ?? "")});
            if (re) vars = vars.filter(v => re.test(v.name));
            const cols = {};
            for (const c of await figma.variables.getLocalVariableCollectionsAsync()) cols[c.id] = c;
            const out = vars.slice(0, ${limit}).map(v => {
              const col = cols[v.variableCollectionId];
              const values = {};
              for (const [modeId, val] of Object.entries(v.valuesByMode)) {
                const mode = col ? col.modes.find(m => m.modeId === modeId) : null;
                values[mode ? mode.name : modeId] = showValue(val);
              }
              return { id: v.id, name: v.name, type: v.resolvedType, collection: col ? col.name : v.variableCollectionId,
                       values, scopes: v.scopes && v.scopes.length && v.scopes[0] !== 'ALL_SCOPES' ? v.scopes : undefined };
            });
            return { count: vars.length, shown: out.length, variables: out };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_variable_collection",
    {
      title: "Create a variable collection",
      description: "New local collection. modes renames the default mode and adds the rest (e.g. ['Light', 'Dark']).",
      inputSchema: {
        name: z.string().min(1),
        modes: z.array(z.string().min(1)).optional(),
      },
    },
    async ({ name, modes }) => {
      try {
        return ok(
          await exec(`
            const col = figma.variables.createVariableCollection(${J(name)});
            const modes = ${J(modes ?? [])};
            if (modes.length) {
              col.renameMode(col.defaultModeId, modes[0]);
              for (const m of modes.slice(1)) col.addMode(m);
            }
            return { id: col.id, name: col.name, modes: col.modes.map(m => ({ id: m.modeId, name: m.name })) };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_variable",
    {
      title: "Create a variable",
      description:
        "New local variable in a collection. value applies to every mode unless values_by_mode is given (mode name -> value). Colors as hex; aliases as 'VariableID:...'.",
      inputSchema: {
        collection_id: z.string().min(1),
        name: z.string().min(1).describe("Use slashes for groups: 'color/brand/primary'."),
        type: variableType,
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
        values_by_mode: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        scopes: z
          .array(z.string())
          .optional()
          .describe("COLOR: FRAME_FILL, SHAPE_FILL, TEXT_FILL, STROKE_COLOR, EFFECT_COLOR, ALL_FILLS. FLOAT: GAP, WIDTH_HEIGHT, CORNER_RADIUS, OPACITY, STROKE_FLOAT, EFFECT_FLOAT, FONT_SIZE, LINE_HEIGHT, LETTER_SPACING. Default: sensible per type."),
        description: z.string().optional(),
      },
    },
    async ({ collection_id, name, type, value, values_by_mode, scopes, description }) => {
      try {
        const defaultScopes =
          type === "COLOR" ? ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL", "STROKE_COLOR"] : type === "FLOAT" ? ["GAP", "WIDTH_HEIGHT", "CORNER_RADIUS"] : ["ALL_SCOPES"];
        return ok(
          await exec(`
            ${prelude}
            const col = await figma.variables.getVariableCollectionByIdAsync(${J(collection_id)});
            if (!col) throw new Error('Collection not found: ' + ${J(collection_id)});
            const v = figma.variables.createVariable(${J(name)}, col, ${J(type)});
            const byMode = ${J(values_by_mode ?? null)};
            if (byMode) {
              for (const [modeName, raw] of Object.entries(byMode)) {
                const mode = col.modes.find(m => m.name === modeName || m.modeId === modeName);
                if (!mode) throw new Error('Mode not found: ' + modeName + '. Modes: ' + col.modes.map(m => m.name).join(', '));
                v.setValueForMode(mode.modeId, await toValue(raw, ${J(type)}));
              }
            } else if (${J(value !== undefined)}) {
              const val = await toValue(${J(value ?? null)}, ${J(type)});
              for (const m of col.modes) v.setValueForMode(m.modeId, val);
            }
            v.scopes = ${J(scopes ?? defaultScopes)};
            ${description ? `v.description = ${J(description)};` : ""}
            const values = {};
            for (const [modeId, val] of Object.entries(v.valuesByMode)) {
              const mode = col.modes.find(m => m.modeId === modeId);
              values[mode ? mode.name : modeId] = showValue(val);
            }
            return { id: v.id, name: v.name, type: v.resolvedType, collection: col.name, values, scopes: v.scopes };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_variable_value",
    {
      title: "Set a variable value",
      description: "Set a variable's value for one mode (default mode if omitted). Colors as hex; 'VariableID:...' creates an alias.",
      inputSchema: {
        variable_id: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]),
        mode: z.string().optional().describe("Mode name or id."),
      },
    },
    async ({ variable_id, value, mode }) => {
      try {
        return ok(
          await exec(`
            ${prelude}
            const v = await figma.variables.getVariableByIdAsync(${J(variable_id)});
            if (!v) throw new Error('Variable not found: ' + ${J(variable_id)});
            const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
            const want = ${J(mode ?? null)};
            const m = want ? col.modes.find(x => x.name === want || x.modeId === want) : col.modes.find(x => x.modeId === col.defaultModeId);
            if (!m) throw new Error('Mode not found: ' + want + '. Modes: ' + col.modes.map(x => x.name).join(', '));
            v.setValueForMode(m.modeId, await toValue(${J(value)}, v.resolvedType));
            return { id: v.id, name: v.name, mode: m.name, value: showValue(v.valuesByMode[m.modeId]) };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "bind_variable",
    {
      title: "Bind a variable to a node property",
      description:
        "Bind a variable to fill, stroke, width, height, opacity, cornerRadius (all corners), padding (all sides), itemSpacing, characters, visible, strokeWeight, minWidth/maxWidth/minHeight/maxHeight, or any VariableBindableNodeField.",
      inputSchema: {
        node_id: nodeIdArg,
        field: z.string().min(1),
        variable_id: z.string().min(1),
      },
    },
    async ({ node_id, field, variable_id }) => {
      try {
        return ok(
          await exec(`
            ${resolveNode(node_id)}
            const v = await figma.variables.getVariableByIdAsync(${J(variable_id)});
            if (!v) throw new Error('Variable not found: ' + ${J(variable_id)});
            const field = ${J(field)};
            const bound = [];
            const bindPaint = (prop) => {
              const paints = JSON.parse(JSON.stringify(n[prop] || []));
              const base = paints[0] && paints[0].type === 'SOLID' ? paints[0] : { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
              paints[0] = figma.variables.setBoundVariableForPaint(base, 'color', v);
              n[prop] = paints;
              bound.push(prop + '[0].color');
            };
            if (field === 'fill' || field === 'fills') bindPaint('fills');
            else if (field === 'stroke' || field === 'strokes') bindPaint('strokes');
            else if (field === 'cornerRadius') {
              for (const f of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) { n.setBoundVariable(f, v); bound.push(f); }
            } else if (field === 'padding') {
              for (const f of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) { n.setBoundVariable(f, v); bound.push(f); }
            } else if (field === 'characters') {
              if (n.type !== 'TEXT') throw new Error('characters needs a TEXT node');
              if (n.fontName === figma.mixed) { for (const s of n.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(s.fontName); }
              else await figma.loadFontAsync(n.fontName);
              n.setBoundVariable('characters', v); bound.push('characters');
            } else { n.setBoundVariable(field, v); bound.push(field); }
            return { id: n.id, variable: v.name, bound };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const variableSpec = z.object({
    name: z.string().min(1),
    type: variableType,
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    values_by_mode: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    scopes: z.array(z.string()).optional(),
    description: z.string().optional(),
  });

  server.registerTool(
    "create_variables",
    {
      title: "Create several variables at once",
      description:
        "Batch form of create_variable: one call, many variables in one collection. Continues past individual failures and reports each. Prefer this over repeated create_variable calls.",
      inputSchema: {
        collection_id: z.string().min(1),
        variables: z.array(variableSpec).min(1).max(100),
      },
    },
    async ({ collection_id, variables }) => {
      try {
        return ok(
          await exec(
            `
            ${prelude}
            const col = await figma.variables.getVariableCollectionByIdAsync(${J(collection_id)});
            if (!col) throw new Error('Collection not found: ' + ${J(collection_id)});
            const specs = ${J(variables)};
            const defaultScopes = (t) => t === 'COLOR' ? ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'] : t === 'FLOAT' ? ['GAP', 'WIDTH_HEIGHT', 'CORNER_RADIUS'] : ['ALL_SCOPES'];
            const created = [], errors = [];
            for (const s of specs) {
              try {
                const v = figma.variables.createVariable(s.name, col, s.type);
                if (s.values_by_mode) {
                  for (const [modeName, raw] of Object.entries(s.values_by_mode)) {
                    const mode = col.modes.find(m => m.name === modeName || m.modeId === modeName);
                    if (!mode) throw new Error('Mode not found: ' + modeName);
                    v.setValueForMode(mode.modeId, await toValue(raw, s.type));
                  }
                } else if (s.value !== undefined) {
                  const val = await toValue(s.value, s.type);
                  for (const m of col.modes) v.setValueForMode(m.modeId, val);
                }
                v.scopes = s.scopes || defaultScopes(s.type);
                if (s.description) v.description = s.description;
                created.push({ id: v.id, name: v.name, type: v.resolvedType });
              } catch (e) {
                errors.push({ name: s.name, error: String(e && e.message || e) });
              }
            }
            return { collection: col.name, created_count: created.length, created, errors: errors.length ? errors : undefined };
          `,
            120_000,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "bind_variables",
    {
      title: "Bind several variables at once",
      description:
        "Batch form of bind_variable: a list of { node_id, field, variable_id }. One call for a whole component or screen. Continues past individual failures and reports each.",
      inputSchema: {
        bindings: z
          .array(z.object({ node_id: z.string().min(1), field: z.string().min(1), variable_id: z.string().min(1) }))
          .min(1)
          .max(200),
      },
    },
    async ({ bindings }) => {
      try {
        return ok(
          await exec(
            `
            const items = ${J(bindings)};
            const vars = {};
            const done = [], errors = [];
            const bindPaint = (n, prop, v) => {
              const paints = JSON.parse(JSON.stringify(n[prop] || []));
              const base = paints[0] && paints[0].type === 'SOLID' ? paints[0] : { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
              paints[0] = figma.variables.setBoundVariableForPaint(base, 'color', v);
              n[prop] = paints;
            };
            for (const it of items) {
              try {
                const n = await figma.getNodeByIdAsync(it.node_id);
                if (!n) throw new Error('Node not found');
                let v = vars[it.variable_id];
                if (!v) { v = await figma.variables.getVariableByIdAsync(it.variable_id); if (!v) throw new Error('Variable not found: ' + it.variable_id); vars[it.variable_id] = v; }
                const f = it.field;
                if (f === 'fill' || f === 'fills') bindPaint(n, 'fills', v);
                else if (f === 'stroke' || f === 'strokes') bindPaint(n, 'strokes', v);
                else if (f === 'cornerRadius') { for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) n.setBoundVariable(k, v); }
                else if (f === 'padding') { for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) n.setBoundVariable(k, v); }
                else if (f === 'strokeWeight') { for (const k of ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight']) n.setBoundVariable(k, v); }
                else if (f === 'characters') {
                  if (n.type !== 'TEXT') throw new Error('characters needs a TEXT node');
                  if (n.fontName === figma.mixed) { for (const s of n.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(s.fontName); } else await figma.loadFontAsync(n.fontName);
                  n.setBoundVariable('characters', v);
                } else n.setBoundVariable(f, v);
                done.push(it.node_id + ' ' + f + ' -> ' + v.name);
              } catch (e) {
                errors.push({ node_id: it.node_id, field: it.field, error: String(e && e.message || e) });
              }
            }
            return { bound_count: done.length, bound: done, errors: errors.length ? errors : undefined };
          `,
            120_000,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_variable_defs",
    {
      title: "Variables used by a node",
      description:
        "Every variable bound in a node's subtree (or the selection): which node and property, variable name, collection, resolved value. Also lists style names in use.",
      inputSchema: {
        node_id: z.string().optional(),
        max_nodes: z.number().int().positive().max(5000).optional().default(1000),
      },
    },
    async ({ node_id, max_nodes }) => {
      try {
        return ok(
          await exec(
            `
            ${prelude}
            let roots;
            if (${J(node_id ?? null)}) { const n = await figma.getNodeByIdAsync(${J(node_id ?? "")}); if (!n) throw new Error('Node not found'); roots = [n]; }
            else { roots = figma.currentPage.selection; if (!roots.length) throw new Error('Nothing selected; pass node_id'); }
            const rows = []; const varIds = new Set(); const styles = new Set(); let visited = 0;
            const note = (node, prop, alias) => { if (alias && alias.id) { rows.push({ node: node.id, name: node.name, prop, variable: alias.id }); varIds.add(alias.id); } };
            const walk = (node) => {
              if (visited++ >= ${max_nodes}) return;
              const bv = node.boundVariables || {};
              for (const [prop, val] of Object.entries(bv)) {
                if (Array.isArray(val)) val.forEach((a, i) => note(node, prop + '[' + i + ']', a));
                else if (val && typeof val === 'object' && 'id' in val) note(node, prop, val);
                else if (val && typeof val === 'object') for (const [k, a] of Object.entries(val)) note(node, prop + '.' + k, a);
              }
              for (const s of ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId']) {
                if (typeof node[s] === 'string' && node[s]) styles.add(s + ':' + node[s]);
              }
              if ('children' in node) for (const c of node.children) walk(c);
            };
            for (const r of roots) walk(r);
            const vars = {};
            for (const id of varIds) {
              const v = await figma.variables.getVariableByIdAsync(id);
              if (!v) { vars[id] = { missing: true }; continue; }
              const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
              let resolved; try { resolved = showValue(v.resolveForConsumer(roots[0]).value); } catch (e) { resolved = undefined; }
              vars[id] = { name: v.name, type: v.resolvedType, collection: col ? col.name : undefined, value: resolved };
            }
            const styleNames = [];
            for (const s of styles) { const [, id] = s.split(/:(.+)/); const st = await figma.getStyleByIdAsync(id); if (st) styleNames.push({ type: st.type, name: st.name, id: st.id }); }
            const lines = rows.map(r => r.name + ' (' + r.node + ') ' + r.prop + ' -> ' + (vars[r.variable].name || r.variable) + (vars[r.variable].value !== undefined ? ' = ' + JSON.stringify(vars[r.variable].value) : ''));
            return { bindings: lines, variables: vars, styles: styleNames, nodes_visited: visited };
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
