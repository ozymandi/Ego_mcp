import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import { J, appendToParent, resolveNode } from "./canvas-helpers.js";
import { ok, fail } from "./result.js";

// Components and instances on the live canvas. Lets a model assemble screens
// from a design system instead of drawing rectangles.

const nodeIdArg = z.string().min(1).describe("Node id, e.g. 12:345.");

// JS that resolves `comp` to a COMPONENT from a library key or a node id.
function resolveComponent(key?: string, id?: string): string {
  return `
    const key = ${J(key ?? null)}, cid = ${J(id ?? null)};
    if (!key && !cid) throw new Error('Pass component_key (library) or component_id (node in this file).');
    let comp;
    if (key) {
      try { comp = await figma.importComponentByKeyAsync(key); }
      catch (e) {
        try { comp = await figma.importComponentSetByKeyAsync(key); }
        catch (e2) { throw new Error('No published component or component set with key ' + key + ': ' + (e2 && e2.message || e2)); }
      }
    } else {
      comp = await figma.getNodeByIdAsync(cid);
      if (!comp) throw new Error('Node not found: ' + cid);
    }
    if (comp.type === 'COMPONENT_SET') comp = comp.defaultVariant;
    if (comp.type === 'INSTANCE') comp = await comp.getMainComponentAsync();
    if (!comp || comp.type !== 'COMPONENT') throw new Error('Not a component: ' + (comp && comp.type));
  `;
}

const propSummary = `
  const summarizeProps = (props) => {
    const out = {};
    for (const [k, v] of Object.entries(props || {})) out[k] = { type: v.type, value: v.value };
    return out;
  };
  const summarizeDefs = (defs) => {
    const out = {};
    for (const [k, v] of Object.entries(defs || {})) {
      out[k] = { type: v.type, default: v.defaultValue };
      if (v.variantOptions) out[k].options = v.variantOptions;
    }
    return out;
  };
`;

export function registerComponentTools(server: McpServer, bridge: PluginBridge): void {
  const exec = (code: string, timeoutMs?: number) => bridge.send("exec", { code }, timeoutMs);

  server.registerTool(
    "list_components",
    {
      title: "List components on the canvas",
      description:
        "Components and component sets in the open file (current page by default; scope=file loads every page). Returns id, name, key, variants.",
      inputSchema: {
        scope: z.enum(["page", "file"]).optional().default("page"),
        name_pattern: z.string().optional().describe("Case-insensitive regex on the name."),
        limit: z.number().int().positive().max(500).optional().default(100),
      },
    },
    async ({ scope, name_pattern, limit }) => {
      try {
        return ok(
          await exec(
            `
            const re = ${J(name_pattern ?? null)} ? new RegExp(${J(name_pattern ?? "")}, 'i') : null;
            let roots;
            if (${J(scope)} === 'file') { await figma.loadAllPagesAsync(); roots = figma.root.children; }
            else roots = [figma.currentPage];
            const out = [];
            for (const page of roots) {
              const found = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
              for (const n of found) {
                if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') continue; // listed under its set
                if (re && !re.test(n.name)) continue;
                const row = { id: n.id, name: n.name, type: n.type, key: n.key, page: page.name };
                if (n.type === 'COMPONENT_SET') row.variants = n.children.map(c => c.name);
                out.push(row);
                if (out.length >= ${limit}) break;
              }
              if (out.length >= ${limit}) break;
            }
            return { count: out.length, components: out };
          `,
            60_000,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_instance",
    {
      title: "Create a component instance",
      description:
        "Place an instance of a component: by library key (component_key from get_components / search_design_system) or by node id of a component/component set in this file.",
      inputSchema: {
        component_key: z.string().optional(),
        component_id: z.string().optional(),
        x: z.number(),
        y: z.number(),
        name: z.string().optional(),
        parent_id: z.string().optional().describe("Parent node id; default: current page."),
        properties: z
          .record(z.union([z.string(), z.boolean()]))
          .optional()
          .describe("Component properties to set, e.g. { State: 'Hover', Label: 'Send' }."),
      },
    },
    async ({ component_key, component_id, x, y, name, parent_id, properties }) => {
      try {
        return ok(
          await exec(`
            ${resolveComponent(component_key, component_id)}
            const inst = comp.createInstance();
            inst.x = ${x}; inst.y = ${y};
            ${name ? `inst.name = ${J(name)};` : ""}
            ${appendToParent("inst", parent_id)}
            ${properties ? `inst.setProperties(${J(properties)});` : ""}
            ${propSummary}
            return { id: inst.id, name: inst.name, type: inst.type, width: inst.width, height: inst.height,
                     main_component: { id: comp.id, name: comp.name, key: comp.key },
                     properties: summarizeProps(inst.componentProperties) };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_instance_properties",
    {
      title: "Inspect an instance",
      description:
        "Main component, current component properties and the definitions (variant options, defaults) an instance accepts.",
      inputSchema: { node_id: nodeIdArg },
    },
    async ({ node_id }) => {
      try {
        return ok(
          await exec(`
            ${resolveNode(node_id, "inst")}
            if (inst.type !== 'INSTANCE') throw new Error('Not an instance: ' + inst.type);
            const main = await inst.getMainComponentAsync();
            const owner = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
            ${propSummary}
            let defs = {};
            try { defs = summarizeDefs(owner.componentPropertyDefinitions); } catch (e) { defs = { error: String(e && e.message || e) }; }
            return {
              id: inst.id, name: inst.name,
              main_component: main ? { id: main.id, name: main.name, key: main.key, set: owner !== main ? owner.name : undefined } : null,
              properties: summarizeProps(inst.componentProperties),
              definitions: defs,
            };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_instance_properties",
    {
      title: "Set instance properties",
      description:
        "Set variant / boolean / text / instance-swap properties on an instance. Use the keys from get_instance_properties (text and boolean keys end with #id).",
      inputSchema: {
        node_id: nodeIdArg,
        properties: z.record(z.union([z.string(), z.boolean()])),
      },
    },
    async ({ node_id, properties }) => {
      try {
        return ok(
          await exec(`
            ${resolveNode(node_id, "inst")}
            if (inst.type !== 'INSTANCE') throw new Error('Not an instance: ' + inst.type);
            const wanted = ${J(properties)};
            const have = inst.componentProperties || {};
            // Accept bare keys for text/boolean props ("Label" -> "Label#12:3").
            const mapped = {};
            for (const [k, v] of Object.entries(wanted)) {
              const full = k in have ? k : Object.keys(have).find(h => h.split('#')[0] === k);
              if (!full) throw new Error('Unknown property "' + k + '". Available: ' + Object.keys(have).join(', '));
              mapped[full] = v;
            }
            inst.setProperties(mapped);
            ${propSummary}
            return { id: inst.id, properties: summarizeProps(inst.componentProperties) };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "swap_instance",
    {
      title: "Swap an instance's component",
      description: "Point an instance at another component (library key or node id). Overrides are kept where names match.",
      inputSchema: {
        node_id: nodeIdArg,
        component_key: z.string().optional(),
        component_id: z.string().optional(),
      },
    },
    async ({ node_id, component_key, component_id }) => {
      try {
        return ok(
          await exec(`
            ${resolveNode(node_id, "inst")}
            if (inst.type !== 'INSTANCE') throw new Error('Not an instance: ' + inst.type);
            ${resolveComponent(component_key, component_id)}
            inst.swapComponent(comp);
            return { id: inst.id, name: inst.name, main_component: { id: comp.id, name: comp.name, key: comp.key } };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_component",
    {
      title: "Create a component from a node",
      description: "Turn a frame/group into a COMPONENT (in place). Optional name and description.",
      inputSchema: {
        node_id: nodeIdArg,
        name: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async ({ node_id, name, description }) => {
      try {
        return ok(
          await exec(`
            ${resolveNode(node_id)}
            const comp = figma.createComponentFromNode(n);
            ${name ? `comp.name = ${J(name)};` : ""}
            ${description ? `comp.description = ${J(description)};` : ""}
            return { id: comp.id, name: comp.name, type: comp.type, key: comp.key };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "combine_as_variants",
    {
      title: "Combine components into a variant set",
      description:
        "Combine COMPONENT nodes into one COMPONENT_SET. Name each component 'Prop=Value, Prop2=Value' first so variants get properties.",
      inputSchema: {
        node_ids: z.array(z.string().min(1)).min(2),
        name: z.string().optional(),
      },
    },
    async ({ node_ids, name }) => {
      try {
        return ok(
          await exec(`
            const comps = [];
            for (const id of ${J(node_ids)}) {
              const c = await figma.getNodeByIdAsync(id);
              if (!c) throw new Error('Node not found: ' + id);
              if (c.type !== 'COMPONENT') throw new Error(id + ' is ' + c.type + ', expected COMPONENT (use create_component first)');
              comps.push(c);
            }
            const parent = comps[0].parent || figma.currentPage;
            const vset = figma.combineAsVariants(comps, parent);
            ${name ? `vset.name = ${J(name)};` : ""}
            ${propSummary}
            let defs = {}; try { defs = summarizeDefs(vset.componentPropertyDefinitions); } catch (e) {}
            return { id: vset.id, name: vset.name, key: vset.key, variants: vset.children.map(c => ({ id: c.id, name: c.name })), definitions: defs };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "detach_instance",
    {
      title: "Detach an instance",
      description: "Detach an instance into a plain frame (keeps its look, loses the link).",
      inputSchema: { node_id: nodeIdArg },
    },
    async ({ node_id }) => {
      try {
        return ok(
          await exec(`
            ${resolveNode(node_id, "inst")}
            if (inst.type !== 'INSTANCE') throw new Error('Not an instance: ' + inst.type);
            const f = inst.detachInstance();
            return { id: f.id, name: f.name, type: f.type };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}
