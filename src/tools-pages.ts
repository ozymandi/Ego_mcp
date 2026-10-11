import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import { J } from "./canvas-helpers.js";
import { ok, fail } from "./result.js";

// Page navigation inside the file open in Figma desktop.
export function registerPageTools(server: McpServer, bridge: PluginBridge): void {
  const exec = (code: string, timeoutMs?: number) => bridge.send("exec", { code }, timeoutMs);

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description: "Pages of the open file with ids; marks the current one.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(
          await exec(`
            return figma.root.children.map(p => ({
              id: p.id, name: p.name,
              current: p.id === figma.currentPage.id || undefined,
            }));
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_current_page",
    {
      title: "Switch page",
      description: "Make a page current by id or exact name. Canvas tools then act on it.",
      inputSchema: {
        page_id: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async ({ page_id, name }) => {
      try {
        if (!page_id && !name) throw new Error("Pass page_id or name.");
        return ok(
          await exec(`
            const id = ${J(page_id ?? null)}, name = ${J(name ?? null)};
            const page = figma.root.children.find(p => (id && p.id === id) || (name && p.name === name));
            if (!page) throw new Error('Page not found. Pages: ' + figma.root.children.map(p => p.name + ' (' + p.id + ')').join(', '));
            await figma.setCurrentPageAsync(page);
            return { id: page.id, name: page.name, children_count: page.children.length };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "zoom_to",
    {
      title: "Zoom viewport to nodes",
      description: "Scroll and zoom the Figma viewport to the given nodes (or the selection).",
      inputSchema: { node_ids: z.array(z.string().min(1)).optional() },
    },
    async ({ node_ids }) => {
      try {
        return ok(
          await exec(`
            const ids = ${J(node_ids ?? null)};
            let nodes;
            if (ids) {
              nodes = [];
              for (const id of ids) { const n = await figma.getNodeByIdAsync(id); if (n) nodes.push(n); }
              if (!nodes.length) throw new Error('None of the node_ids exist on this file');
            } else {
              nodes = figma.currentPage.selection;
              if (!nodes.length) throw new Error('Nothing selected; pass node_ids');
            }
            figma.viewport.scrollAndZoomIntoView(nodes);
            return { zoomed_to: nodes.map(n => n.id), zoom: Math.round(figma.viewport.zoom * 100) / 100 };
          `),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}
