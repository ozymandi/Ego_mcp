import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TOPICS = [
  "overview",
  "canvas",
  "rest",
  "code-connect",
  "design-system",
  "diagrams",
  "figjam",
  "examples",
  "troubleshoot",
] as const;
type Topic = (typeof TOPICS)[number];

const INDEX = `# Gemma 4 ↔ Figma MCP — help

Call \`help\` with one of these topics:

- \`help("overview")\` — what this server is and how the pieces fit together
- \`help("canvas")\` — create/edit nodes on the canvas
- \`help("rest")\` — read files via the Figma REST API
- \`help("code-connect")\` — map Figma components to your code
- \`help("design-system")\` — index and search a team's published library
- \`help("diagrams")\` — flowcharts and Mermaid rendering
- \`help("figjam")\` — sticky notes and connectors
- \`help("examples")\` — copy-paste prompts you can try
- \`help("troubleshoot")\` — fix common problems

Without an argument you get this index.
`;

const OVERVIEW = `# Overview

This MCP server connects a local language model (Gemma 4 running in LM Studio)
to Figma. It exposes **31 tools** spread across four groups:

1. **REST tools** — read public Figma data through the official API. Needs a
   personal access token; works without the plugin.
2. **Plugin bridge** — connect to the live canvas of your Figma desktop app.
3. **Canvas helpers** — typed wrappers that create and edit nodes without
   writing JavaScript.
4. **Help** — this tool.

## Architecture

\`\`\`
ws://localhost:7575
       │
 ┌─────┴──────┐
 │   daemon   │   long-lived, started with: npm run bridge
 └─┬────────┬─┘
   │        │
 plugin    MCP server (spawned by LM Studio per chat)
\`\`\`

The daemon is the only thing that owns the WebSocket port. The plugin and
the MCP server are both clients of the daemon. Decoupling lifecycles is
what keeps the Figma plugin connection stable across LM Studio restarts.

## Quick check

Call \`bridge_status\`. You want \`mcp_to_daemon: "connected"\` and the Figma
plugin window showing a green dot.
`;

const CANVAS = `# Canvas helpers

Structured tools that create or modify Figma nodes. All run inside the
plugin sandbox via \`use_figma\`, but you don't have to write JavaScript —
you pass parameters.

## Create
- \`create_frame(x, y, width, height, name?, parent_id?)\`
- \`create_rectangle(x, y, width, height, fill?, name?, parent_id?)\`
- \`create_ellipse(x, y, width, height, fill?, name?, parent_id?)\`
- \`create_text(x, y, content, font_size?, font_family?, font_style?, color?, name?, parent_id?)\`
- \`create_line(x1, y1, x2, y2, stroke?, stroke_weight?, name?, parent_id?)\`
- \`clone_node(node_id)\`

## Modify
- \`move_node(node_id, x, y)\`
- \`resize_node(node_id, width, height)\`
- \`set_fill(node_id, color, opacity?)\`
- \`set_stroke(node_id, color, weight?)\`
- \`set_text(node_id, content)\`
- \`rename_node(node_id, name)\`

## Tree & utility
- \`delete_nodes(node_ids[])\`
- \`set_selection(node_ids[])\`
- \`find_nodes(name_pattern?, type?, limit?)\` — regex on names, optional node type
- \`group_nodes(node_ids[], name?)\`
- \`set_auto_layout(node_id, direction, item_spacing?, padding?)\` — direction is \`HORIZONTAL\`, \`VERTICAL\`, or \`NONE\`

## Conventions

- **Colors** accept hex with optional alpha: \`#0d99ff\`, \`#0d99ffcc\`, \`#abc\`.
- **node_id** values come from \`get_selection\`, \`get_current_page\`, or
  \`find_nodes\`. Format is like \`12:345\`.
- **parent_id** is optional; without it, new nodes go on the current page.
- **Coordinates** are in absolute page space.
- **Fonts** auto-load before \`create_text\` / \`set_text\`. Missing fonts
  fall back to Inter Regular.

For anything not covered, drop down to \`use_figma\` with a raw JS snippet:
\`figma\`, \`selection\`, \`currentPage\` are in scope and you can \`await\` /
\`return\` like in a normal async function.
`;

const REST = `# REST tools

Read data from any Figma file you have access to via the official API.
These don't need the Figma desktop plugin — only a personal access token
in \`.env\` (\`FIGMA_TOKEN\`).

## File-level tools
- \`whoami\` — confirm the token works
- \`get_file(file_key)\` — full document tree (can be huge)
- \`get_metadata(file_key)\` — top-level only, depth=1 (cheap)
- \`get_node(file_key, node_ids[])\` — specific subtrees
- \`get_components(file_key)\` — components defined in the file
- \`get_file_component_sets(file_key)\` — variant groups in the file
- \`get_styles(file_key)\` — paint/text/effect/grid styles
- \`get_comments(file_key, as_md?)\` — read comments
- \`post_comment(file_key, message, comment_id?)\` — add or reply
- \`get_image(file_key, node_ids[], format?, scale?)\` — Figma-rendered PNG/JPG/SVG/PDF URLs

## Variables (Enterprise plan required)
- \`get_local_variables(file_key)\` — local variables and collections
- \`get_published_variables(file_key)\` — variables this file publishes as a library

Without Enterprise these return 403; the error message says so.

## Lookup by global key
- \`get_component_by_key(key)\`
- \`get_component_set_by_key(key)\`
- \`get_style_by_key(key)\`

Use these when you have a key from a library reference (e.g. componentKey
on an INSTANCE node).

## Team libraries (paginated)
- \`get_team_components(team_id, page_size?, after?)\`
- \`get_team_component_sets(team_id, page_size?, after?)\`
- \`get_team_styles(team_id, page_size?, after?)\`

Find \`team_id\` in the team URL:
\`https://www.figma.com/files/team/<TEAM_ID>/...\`. Use \`page_size\` up to 30
and the cursor in the response's \`meta.cursor.after\` to paginate.

## file_key

Accepts either a raw key (\`a1B2c3D4\`) or a full Figma URL — both work:

- \`https://www.figma.com/design/a1B2c3D4/My-Project\`
- \`a1B2c3D4\`

Set \`FIGMA_DEFAULT_FILE_KEY\` in \`.env\` to omit it from every call.

## Tips

- Start with \`get_metadata\` to see pages, then \`get_node\` for a specific
  subtree. \`get_file\` returns the entire document — easy to blow your
  context window.
- \`get_image\` returns S3 URLs valid for ~30 days. For inline images of
  the live canvas, use \`get_screenshot\` (plugin) instead.
`;

const EXAMPLES = `# Example prompts

Copy these into the chat — Gemma will pick the right tool.

## Sanity checks
> Use \`bridge_status\` and tell me if everything's connected.

> Use \`whoami\` — what Figma user am I?

## Reading the canvas
> What's on the active Figma page? Use \`get_current_page\`.

> List all TEXT nodes on the current page. Use \`find_nodes\` with type "TEXT".

> Take a PNG screenshot of my current selection at scale 2.

## Creating things
> Create a frame at 0,0 sized 400x300 named "Card". Then put a rectangle
> filling it with #1e293b and a text "Card title" near the top.

> Add a blue (#0d99ff) circle 80x80 at position 100,100.

## Editing
> Find all rectangles on this page and set their fill to #22c55e.

> Select the node named "Submit", then rename it to "Send".

## Auto-layout
> Create a frame "Toolbar" at 0,0 sized 320x48. Enable HORIZONTAL
> auto-layout with item_spacing=8 and padding=12.

## Reading remote files
> Get metadata for this file: https://www.figma.com/design/XXXX/...

> Comment "Looks good — shipping it" on file XXXX.

## Raw JS escape hatch
> Use \`use_figma\` to clone the current selection and shift the copy
> 200px to the right.
`;

const TROUBLESHOOT = `# Troubleshooting

## "Bridge daemon not reachable" / bridge_status shows disconnected

The daemon process isn't running. In a terminal in the project folder:

\`\`\`
npm run bridge
\`\`\`

Leave it open. You should see \`[daemon] listening on ws://:::7575\`.

## Plugin shows red dot "disconnected"

Open the plugin in Figma desktop (Plugins → Development → Gemma 4 MCP
Bridge) while the daemon is running. The plugin auto-reconnects every 2s,
so once the daemon is up the dot turns green within seconds.

## "Plugin not connected" when calling use_figma / canvas tools

The MCP server reached the daemon, but the daemon has no plugin connected.
Run the plugin in Figma. If it's already open, click **Reconnect** in the
plugin window or close and reopen it.

## "Mixed fonts — split the runs manually" from set_text

The target text node uses multiple fonts in its character range. Either
edit the text manually in Figma first, or use \`use_figma\` to set
\`fontName\` for specific character ranges before changing characters.

## Port 7575 already in use

Another process is listening on that port. Either kill it or change the
port in \`.env\`:

\`\`\`
FIGMA_BRIDGE_PORT=7576
\`\`\`

Then restart the daemon. The plugin defaults to 7575 — change its
"WebSocket URL" field in the plugin window to match.

## LM Studio shows the MCP but the model never calls tools

Make sure the model supports tool calling (Gemma 4 Instruct variants do).
Also enable **Allow calling servers from mcp.json** in LM Studio Server
Settings — without it, mcp.json is ignored. The MCP toggle in the Plugins
list must be on.

## Daemon log shows "plugin connected" then immediately disconnects

Two Figma windows are both running the plugin and fighting for the single
plugin slot. Close one — the daemon only accepts one plugin connection.

## Screenshots show as base64 text instead of an image

LM Studio doesn't render MCP image content blocks (yet). The PNG is still
saved to \`./screenshots/\` — open it from there. The model also receives
the file path in the tool response.

## Where are the logs?

- **Daemon**: the terminal running \`npm run bridge\`.
- **MCP server**: LM Studio → Developer panel → output for \`mcp/gemma-figma\`.
- **Plugin**: the gray log area at the bottom of the plugin window.
`;

const CODE_CONNECT = `# Code Connect

Map Figma components to real code components in a repository. The result
is that Figma's Dev Mode shows the actual code snippet (and props) for the
selected component — instead of generic CSS — using \`*.figma.ts(x)\` files
authored by you.

## Typical workflow

1. \`scan_code_connect({ directory })\` — see what's already connected.
2. Pick a Figma component (you can grab its id from \`get_selection\` or
   \`find_nodes\` in the plugin, or from an INSTANCE node's \`componentId\`).
3. \`get_node_props_for_connect({ file_key, node_id })\` to inspect its
   variants / boolean / text properties.
4. \`generate_code_connect({ file_key, node_id, framework, component_name? })\`
   to get a ready-to-edit template (React / Vue / HTML).
5. Tweak the \`example\` block to match how the component is actually used.
6. \`save_code_connect({ file_path, content, overwrite? })\` to write it
   next to the component source.
7. \`publish_code_connect({ directory })\` to upload mappings to Figma via
   the official CLI (it runs \`npx @figma/code-connect connect publish\`).
   Token from \`.env\` is forwarded to the CLI as \`FIGMA_ACCESS_TOKEN\`.

## Tools
- \`scan_code_connect(directory?, max_files?)\`
- \`read_code_connect(file_path)\`
- \`find_node_mapping(file_key, node_id, directory?)\`
- \`get_node_props_for_connect(file_key, node_id)\`
- \`generate_code_connect(file_key, node_id, framework, component_name?, component_import?)\`
- \`save_code_connect(file_path, content, overwrite?)\`
- \`publish_code_connect(directory?, dry_run?)\`

## What this MCP does NOT do

The Figma Code Connect upload step uses an internal API that's only
exposed via Figma's official CLI. We shell out to it through \`npx\` rather
than reimplementing the protocol. If the CLI isn't installed, \`npx\` will
install it on demand the first time you publish.

## File format reminder

A Code Connect file is just TypeScript:

\`\`\`ts
import figma from "@figma/code-connect";
import { Button } from "./Button";

figma.connect(Button, "https://figma.com/design/.../?node-id=12-345", {
  props: {
    label: figma.string("Label"),
    variant: figma.enum("Variant", { Primary: "primary", Ghost: "ghost" }),
  },
  example: ({ label, variant }) => <Button variant={variant}>{label}</Button>,
});
\`\`\`
`;

const DESIGN_SYSTEM = `# Design system search

For exploring a team's published Figma library — components, variant
sets, and styles — by name without typing exact keys.

## Flow

1. \`index_design_system(team_id)\` — paginates through every team library
   endpoint and writes \`.cache/design-system-<team_id>.json\`. Re-run any
   time to refresh.
2. \`search_design_system(query, type?, limit?)\` — fuzzy text search by
   name + description. Scoring prioritises exact name matches, then
   prefixes, then substring matches.
3. \`clear_design_system_cache(team_id?)\` — wipe one team's cache or all.

## Tips

- Find \`team_id\` in the team URL: \`https://www.figma.com/files/team/<TEAM_ID>/...\`.
- Use \`type='component' | 'component_set' | 'style'\` to narrow results.
- Each result row has a \`key\` you can pass to \`get_component_by_key\`,
  \`get_component_set_by_key\`, or \`get_style_by_key\` for full details.
- Caches are small JSON files; safe to inspect by hand.
`;

const DIAGRAMS = `# Diagrams

Two tools draw flowcharts directly onto the Figma canvas via the plugin
bridge.

## \`create_flowchart(nodes, edges, direction?, ...)\`

Structured input → layered layout → real Figma nodes with connectors.

- \`nodes: [{ id, label, shape?: 'box'|'pill'|'circle'|'diamond' }]\`
- \`edges: [{ from, to, label? }]\`
- \`direction\`: \`TD\` (default), \`TB\`, \`LR\`, \`RL\`, \`BT\`
- \`origin: { x, y }\` — diagram center.
- Sizing: \`node_width\`, \`node_height\`, \`level_spacing\`, \`node_spacing\`.
- \`connector_style: 'STRAIGHT' | 'ELBOWED'\` (default ELBOWED).

## \`mermaid_to_canvas(mermaid, ...)\`

Parses a small subset of Mermaid \`flowchart\` syntax and forwards to
\`create_flowchart\`. Supported:

- Header: \`flowchart TD|TB|LR|RL|BT\` or \`graph TD|...\`
- Node shapes: \`A[label]\` (box), \`A(label)\` (pill), \`A((label))\` (circle), \`A{label}\` (diamond)
- Edges: \`A --> B\`, \`A -- text --> B\`, \`A -.-> B\`, \`A ==> B\`

Not supported: subgraphs, \`class\` / \`classDef\`, \`linkStyle\`, click
handlers. The tool throws a clear error if it can't parse the header.

## Example

\`\`\`
mermaid_to_canvas:
flowchart TD
  A[Request received]
  B{Auth ok?}
  C[Process]
  D((Done))
  E[Reject]
  A --> B
  B -- yes --> C
  B -- no --> E
  C --> D
\`\`\`
`;

const FIGJAM = `# FigJam helpers

These work alongside the canvas helpers — but two of them are
FigJam-specific.

## \`create_sticky(x, y, text, color?, parent_id?)\`

FigJam sticky note. Errors clearly if you call it on a Figma Design file.

Colors (string names): \`yellow\` (default), \`green\`, \`blue\`, \`pink\`,
\`red\`, \`orange\`, \`gray\`, \`lightGray\`, \`violet\`, \`teal\`.

## \`create_connector(from_id, to_id, label?, style?, stroke_color?)\`

Connector arrow between two existing nodes. Works in both FigJam and
Figma Design (the plugin uses \`documentAccess: dynamic-page\`, which
unlocks connectors in design files too).

- \`style\`: \`ELBOWED\` (default) or \`STRAIGHT\`.
- \`stroke_color\`: hex like \`#444\`.
- \`label\`: optional caption rendered along the line.

## Pattern: build a quick board

\`\`\`
1. create_sticky(0,0,"Goal: ship v1")
2. create_sticky(280,0,"Open Qs")
3. find_nodes(name_pattern="Goal")  // returns the sticky id
4. find_nodes(name_pattern="Open")
5. create_connector(<goal_id>, <qs_id>, label="depends on")
\`\`\`
`;

const BODIES: Record<Topic, string> = {
  overview: OVERVIEW,
  canvas: CANVAS,
  rest: REST,
  "code-connect": CODE_CONNECT,
  "design-system": DESIGN_SYSTEM,
  diagrams: DIAGRAMS,
  figjam: FIGJAM,
  examples: EXAMPLES,
  troubleshoot: TROUBLESHOOT,
};

export function registerHelpTools(server: McpServer): void {
  server.registerTool(
    "help",
    {
      title: "Help",
      description:
        "Returns a concise guide for this MCP server. Call without args for the index, or pass a topic ('overview', 'canvas', 'rest', 'examples', 'troubleshoot').",
      inputSchema: {
        topic: z
          .enum(TOPICS)
          .optional()
          .describe(
            "Topic to fetch. Omit to get the index of available topics.",
          ),
      },
    },
    async ({ topic }) => {
      const text = topic ? BODIES[topic] : INDEX;
      return { content: [{ type: "text", text }] };
    },
  );

  // MCP prompt — surfaces in clients that show server-side prompts in a
  // menu (e.g. Claude Code, MCP Inspector). Picking it injects a short
  // user message that triggers the `help` tool with the chosen topic.
  server.registerPrompt(
    "figma_help",
    {
      title: "Figma MCP help",
      description:
        "Quick reference for the Gemma 4 ↔ Figma MCP. Pick a topic to load the matching guide.",
      argsSchema: {
        topic: z
          .enum(TOPICS)
          .optional()
          .describe(
            "Which guide to load. Omit for the index of available topics.",
          ),
      },
    },
    ({ topic }) => {
      const phrase = topic
        ? `Please call the \`help\` tool with topic="${topic}" and walk me through what it returns.`
        : "Please call the `help` tool with no arguments and show me the available topics for this Figma MCP server.";
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: phrase },
          },
        ],
      };
    },
  );
}
