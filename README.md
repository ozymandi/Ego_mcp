# gemma-figma-mcp

MCP server for **Figma**, built so that **local models** can use it well:
compact tool schemas and responses, an agent skill, and an eval harness that
measures how a model actually does. Works with any MCP client. Tested, in
priority order: **Hermes Agent** with Qwen3.8 27B / Gemma 4 31B via LM Studio,
**Claude Code** and **Codex** with hosted models, and LM Studio's own chat.

## Quick start

```powershell
npm install && cd plugin && npm install && cd ..
npm run build                     # server (dist/) + Figma plugin (plugin/dist/)
copy .env.example .env            # paste a Figma personal access token (REST tools only)
```

1. Figma desktop → Plugins → Development → Import plugin from manifest… → `plugin/manifest.json`.
2. Run the plugin (Plugins → Development → Gemma 4 MCP Bridge). Green dot = connected.
3. Register `node <repo>/dist/server.js` in your client and install the skill
   from `skills/figma-mcp/` — per-client steps in [docs/pipelines/](docs/pipelines/README.md).
4. What to ask for, step by step: [docs/workflows/](docs/workflows/README.md)
   (create from scratch with variants and critique, edit a region with a
   proposal first, atomize a finished design for hand-off).

The bridge daemon between plugin and server starts itself with the first MCP
server; nothing else to run. 88 tools; local models should use a profile
(`core` 27 tools, `design` 62) — see [Profiles](docs/pipelines/README.md#profiles).
Measured accuracy per model: [docs/eval-2026-10-11.md](docs/eval-2026-10-11.md).

- Phase 1 — REST read tools + posting comments. ✅
- Phase 2 — Variables and library REST tools. ✅
- Phase 3 — Figma plugin + WebSocket bridge, `use_figma` and live canvas tools. ✅
- Phase 4 — Canvas write helpers. ✅
- Phase 5 — Code Connect tools. ✅
- Phase 6 — Design system search, diagrams, FigJam. ✅
- Phase 7 — Sandboxed filesystem workspaces + image import. ✅
- Phase 8 — Design spec, pages, components/instances, variables, icons (plugin). ✅
- Phase 9 — `critique_design`: deterministic design review (43 rules). ✅
- Agent skill (`skills/figma-mcp/`) for Hermes Agent / Claude Code / Codex. ✅
- Token diet for local models (outline reads, response cap, compact schemas), `use_figma` helpers + error hints. ✅
- Eval harness: first-call accuracy and multi-step live tasks (`npm run eval`, `npm run eval:live`). ✅
- Bridge daemon autostart from the MCP server. ✅

## Tools

### REST (phase 1)
| Tool | Purpose |
|------|---------|
| `whoami` | Current Figma user |
| `get_file` | Whole document as a compact outline (`format=raw` for JSON) |
| `get_metadata` | Pages + top-level frames outline (depth=2) |
| `get_node` | Subtree outline for specific node IDs (`format=raw` for JSON) |
| `get_components` | All components in a file |
| `get_styles` | All styles in a file |
| `get_comments` | Read comments |
| `post_comment` | Add a comment (or reply) |
| `get_image` | Export nodes as PNG/JPG/SVG/PDF (via Figma render service) |

### Plugin bridge (phase 3)
| Tool | Purpose |
|------|---------|
| `bridge_status` | Whether the companion plugin is connected |
| `use_figma` | Execute a JS snippet inside the plugin; `figma`, `selection`, `currentPage` plus helpers `query`, `set`, `createAutoLayout`, `loadFontsFor`, `hex`, `solid` in scope (a snippet may redeclare those names). Returns `created_ids`/`changed_ids`; `screenshot: true` adds a PNG; errors carry a hint and `safe_to_retry`; on error the nodes the snippet created are removed (`rollback_on_error`, default on) |
| `get_selection` | Summary of selected nodes |
| `get_current_page` | Current page + selection |
| `get_screenshot` | Saves PNG/JPG/SVG to `./screenshots/` and embeds the image; longest side capped by `max_px` (1024); unchanged pixels return a note instead of a second image |

### Variables & libraries (phase 2)
| Tool | Purpose |
|------|---------|
| `get_local_variables` | Variables & collections in a file (REST, Enterprise plan; on other plans use the plugin-side `list_variables` below) |
| `get_published_variables` | Variables a file publishes as a library (REST, Enterprise) |
| `get_file_component_sets` | Component sets (variants) in a file |
| `get_component_by_key` | Single component by global key |
| `get_component_set_by_key` | Single component set by global key |
| `get_style_by_key` | Single style by global key |
| `get_team_components` | Paginated team library components |
| `get_team_component_sets` | Paginated team library component sets |
| `get_team_styles` | Paginated team library styles |

### Filesystem workspaces (phase 7)
| Tool | Purpose |
|------|---------|
| `register_workspace` | Add a directory as a named workspace |
| `unregister_workspace` | Remove a workspace (files untouched) |
| `list_workspaces` | Show all registered workspaces + their state |
| `list_dir` | List contents under workspace/path |
| `read_text_file` | Read a text file |
| `read_binary_file` | Read a binary file as base64 |
| `write_text_file` | Write a text file (auto-creates parent dirs) |
| `make_dir` | Create directory (with parents) |
| `move_path` | Rename or move within the same workspace |
| `delete_path` | Delete file or directory (recursive opt-in) |
| `import_image_to_figma` | Read an image from disk and place it on the Figma canvas |

All filesystem operations are sandboxed to registered workspaces. Workspace
registry is stored locally in `.workspaces.json` (gitignored).

### Design system search, diagrams, FigJam (phase 6)
| Tool | Purpose |
|------|---------|
| `index_design_system` | Fetch a team's published library and write `.cache/design-system-<team>.json` |
| `search_design_system` | Fuzzy search the local cache by name/description |
| `clear_design_system_cache` | Wipe one team's cache (or all) |
| `create_flowchart` | Draw a flowchart from `nodes[]` + `edges[]` (layered layout) |
| `mermaid_to_canvas` | Parse a small Mermaid `flowchart TD/LR` and render it |
| `create_sticky` | FigJam sticky note (10 stock colors) |
| `create_connector` | Connector between two nodes (FigJam + Figma Design) |

### Code Connect (phase 5)
| Tool | Purpose |
|------|---------|
| `scan_code_connect` | Walk a directory, find `*.figma.ts(x)` files, parse `figma.connect()` calls |
| `read_code_connect` | Read one file + its parsed connections |
| `find_node_mapping` | For a given Figma node, find local files that map to it |
| `get_node_props_for_connect` | Simplified `componentPropertyDefinitions` for templating |
| `generate_code_connect` | Generate a React / Vue / HTML template for a Figma component |
| `save_code_connect` | Write a `*.figma.ts(x)` file (refuses to overwrite unless asked) |
| `publish_code_connect` | Shell out to `npx @figma/code-connect connect publish` |

### Design spec, pages, components, variables, icons (phase 8)

All through the plugin, so variables work on every Figma plan.

| Tool | Purpose |
|------|---------|
| `get_node_spec` | One line per layer: position/size, auto-layout, sizing, fills/strokes as hex with `{variable}` names, radius, effects, typography, instances with component + props |
| `list_pages`, `set_current_page`, `zoom_to` | Page navigation and viewport |
| `list_components` | Components / component sets on the page (or whole file) with keys and variants |
| `create_instance` | Place an instance by library `component_key` or local `component_id`, optionally with `properties` |
| `get_instance_properties`, `set_instance_properties`, `swap_instance`, `detach_instance` | Work with instances |
| `create_component`, `combine_as_variants` | Build components and variant sets; the set gets auto-layout (variants in a row) and is moved clear of overlapping siblings |
| `list_variable_collections`, `list_variables`, `create_variable_collection`, `create_variable`, `create_variables`, `set_variable_value` | Local variables (colors as hex, aliases as `VariableID:...`); `create_variables` makes many in one call |
| `bind_variable`, `bind_variables` | Bind a variable to fill, stroke, width/height, padding, cornerRadius, strokeWeight, itemSpacing, characters, opacity, …; the plural form takes a list |
| `get_variable_defs` | Every variable and style bound in a subtree, with resolved values |
| `search_icons`, `insert_icon` | Lucide icon set (2000+) placed as vectors |
| `create_from_svg` | Import any SVG string |

### Design critique (phase 9)

| Tool | Purpose |
|------|---------|
| `critique_design` | Deterministic review of a subtree: 43 rules for contrast, type scale, tracking/leading, gradients and glows, nested cards, spacing rhythm, text overflow/occlusion, buzzwords and placeholder copy, hardcoded values vs variables, Figma hygiene. Each finding names the node and the tool that fixes it. Rule ids follow [Impeccable](https://github.com/pbakaus/impeccable)'s detector where a counterpart exists; the checks are re-implemented for Figma nodes (`src/critique/`), with the plugin supplying one snapshot per call |
| `list_critique_rules` | The rule catalogue with severity and group |

`npm run smoke:critique` builds a frame full of deliberate clichés and a clean one on the current page, expects the rules to fire on the first and stay silent on the second, and removes both.

### Canvas helpers (phase 4)

Structured wrappers around `use_figma` — the model passes parameters instead of writing JavaScript. Colors accept `#RRGGBB` or `#RRGGBBAA`.

**Create:** `create_frame`, `create_rectangle`, `create_ellipse`, `create_text`, `create_line`, `clone_node`

**Modify:** `move_node`, `resize_node`, `set_fill`, `set_stroke`, `set_text`, `rename_node`

**Tree / utility:** `delete_nodes`, `set_selection`, `find_nodes`, `group_nodes`, `set_auto_layout`

REST tools accept either a raw `file_key` or a full Figma URL.

## Setup

### 1. Install

```powershell
npm install
cd plugin
npm install
cd ..
npm run build
```

`npm run build` builds both the MCP server (`dist/`) and the Figma plugin bundles (`plugin/dist/`).

### 2. Configure token

1. Open https://www.figma.com/settings → **Security** → **Personal access tokens** → **Generate new token**.
2. Scopes needed for phase 1:
   - `current_user:read`
   - `file_content:read`
   - `file_comments:write`
   - `library_assets:read`
   - `library_content:read`
3. Copy `.env.example` to `.env` and paste the token:

```powershell
copy .env.example .env
```

Then edit `.env`:

```env
FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxxxxx
FIGMA_DEFAULT_FILE_KEY=          # optional
FIGMA_BRIDGE_PORT=7575           # optional, WebSocket port for the plugin bridge
```

> `.env` is in `.gitignore`.

### 3. The bridge daemon (starts by itself)

The Figma plugin and the MCP server both connect to a small bridge daemon
that owns WebSocket port 7575 and routes messages between them. **You do not
need to start it**: the first MCP server any client launches checks the port
and, if nothing is listening, starts `dist/daemon.js` as a detached process
that keeps running after the client stops. Output goes to `daemon.log` in the
project root. The plugin retries the connection every two seconds, so the
order does not matter: open Figma and run the plugin whenever you like.

So the day-to-day flow is: Figma desktop → Plugins → Development → Gemma 4
MCP Bridge → use any client. `bridge_status` reports the daemon, the plugin
and its build; if the daemon ever dies, calling `bridge_status` restarts it.

Options, all optional:

| Want | Do |
|------|----|
| Turn autostart off | `FIGMA_BRIDGE_AUTOSTART=0` in `.env` |
| A visible daemon window | double-click `start-bridge.bat` (autostart then finds it running and does nothing) |
| Daemon up before any client, at logon | `pwsh -File scripts\install-autostart.ps1` (Scheduled Task, per-user, restarts on crash; remove with `scripts\uninstall-autostart.ps1`) |
| Another port | `FIGMA_BRIDGE_PORT=7576` in `.env` and the same port in the plugin window |
| Daemon on another machine | `FIGMA_BRIDGE_URL=ws://host:7575` (autostart only acts for localhost) |

Manual start for debugging: `npm run bridge` prints `[daemon] listening on ws://:::7575`.

### 4. Agent skill (recommended for every client)

Per-client walkthroughs with config, profile advice, example sessions and
troubleshooting live in [docs/pipelines/](docs/pipelines/README.md): Hermes
Agent + LM Studio, Claude Code, Codex, LM Studio chat, your own agent loop.

`skills/figma-mcp/SKILL.md` teaches the model how to use this server: when to
call which tool, the `use_figma` rules, error recovery, and worked snippets.
It follows the common `SKILL.md` format (YAML frontmatter with `name` +
`description`), so the same folder works in Hermes Agent, Claude Code and
Codex. The full tool reference in `references/tools.md` is generated from the
code — regenerate it after adding or changing tools:

```powershell
npm run build:server
npm run docs:tools
```

#### Hermes Agent

Add the server and the skill folder to `~/.hermes/config.yaml`. Name the server
`figma` — the skill is gated on the `mcp-figma` toolset, and tool names become
`mcp_figma_<tool>`.

```yaml
mcp_servers:
  figma:
    command: node
    args: ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
    lazy: true
    tools:
      include: [bridge_status, get_current_page, get_selection, find_nodes, get_screenshot,
                use_figma, create_frame, create_rectangle, create_ellipse, create_text, create_line,
                clone_node, move_node, resize_node, set_fill, set_stroke, set_text, rename_node,
                delete_nodes, set_selection, group_nodes, set_auto_layout,
                get_node_spec, create_instance, insert_icon, list_pages, set_current_page]

skills:
  external_dirs:
    - "E:/Projects/gemma 4 figma mcp/skills"
```

Hermes puts every tool schema into the model's context, so pick a profile that
matches the job. Local 27B-class models work best with `core`.

| Profile | `tools.include` |
|---------|-----------------|
| `core` (canvas, ~27 tools) | the list above plus `get_node_spec, create_instance, insert_icon, list_pages, set_current_page` |
| `design` (core + file reads, components, variables, icons, design system, images, diagrams; ~62 tools) | see `scripts/eval/profiles.json` — copy its `design` array |
| `full` (88 tools) | omit the `tools:` block |

Leave `supports_parallel_tool_calls` unset: canvas writes must run one at a time.
Keep `help` out of the include list — the skill replaces it.

#### Claude Code

Register the server in `.mcp.json` (project) or `~/.claude.json` (user):

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
    }
  }
}
```

Copy or symlink `skills/figma-mcp` to `.claude/skills/figma-mcp` (project) or
`~/.claude/skills/figma-mcp` (user). Claude Code defers large MCP tool lists and
loads schemas on demand, so the `full` tool set is fine here.

#### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.figma]
command = "node"
args = ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
```

Point the project's `AGENTS.md` at `skills/figma-mcp/SKILL.md` (or copy the
folder into Codex's skills directory if your version supports skills).

### 5. Wire up LM Studio (chat)

LM Studio supports MCP servers via `mcp.json` (Program → **Integrations** → **Edit mcp.json**).

Add this entry (adjust the absolute path to this folder):

```json
{
  "mcpServers": {
    "gemma-figma": {
      "command": "node",
      "args": ["E:/Projects/gemma 4 figma mcp/dist/server.js"],
      "env": {}
    }
  }
}
```

The server reads `FIGMA_TOKEN` from the `.env` file next to itself, so you don't need to put the token in `mcp.json`.

Reload LM Studio. Pick a model that supports tool calling (Gemma 4 instruct variants do), open chat, and you should see the `gemma-figma` tools available.

### 6. Install the Figma plugin

The plugin connects to the bridge daemon over WebSocket.

1. Open **Figma desktop** (the plugin runtime requires desktop, not the browser).
2. Top menu → **Plugins → Development → Import plugin from manifest…**
3. Select `plugin/manifest.json` in this repo.
4. Run the plugin: **Plugins → Development → Gemma 4 MCP Bridge**.
5. The plugin window shows a green dot when it's connected to the daemon at `ws://localhost:7575`.

Once connected, every canvas tool works (`bridge_status` shows the open file,
page and the plugin's build stamp). After `npm run build` changes the plugin,
re-run it in Figma to load the new bundle; the daemon and the server do not
need a restart for that.

#### `use_figma` example

```js
// Snippet body passed to use_figma. `figma`, `selection`, `currentPage` are in scope.
const rect = figma.createRectangle();
rect.x = 100;
rect.y = 100;
rect.resize(200, 120);
rect.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.6, b: 0.95 } }];
figma.currentPage.appendChild(rect);
return { created: rect.id };
```

### 7. Check it without a model

With the plugin running in Figma (on a scratch file: both scripts create and
delete test nodes):

```powershell
npm run smoke:plugin     # 11 checks of use_figma helpers, id tracking, error hints
npm run smoke:tools      # 34 checks of the structured tools through the real MCP server
npm run measure:tools    # size of the tools/list payload per tool
```

`npm run dev` runs the server from `src/` with tsx; it autostarts the daemon
like the built server does.

## Scripts

| Script | Does |
|--------|------|
| `npm run build` | compile server to `dist/` and bundle the plugin to `plugin/dist/` (stamps the build) |
| `npm run typecheck` | TypeScript check for server and plugin |
| `npm run bridge` | start the daemon by hand (normally automatic) |
| `npm run docs:tools` | regenerate `skills/figma-mcp/references/tools.md` from the registered tools |
| `npm run measure:tools` | bytes/tokens of the tool list a client receives |
| `npm run smoke:plugin`, `npm run smoke:tools` | live checks against the open Figma file |
| `npm run eval -- --profile core` | first-tool-call accuracy against an OpenAI-compatible model server |
| `npm run eval:live -- --profile design --skill` | multi-step tasks on the live canvas |

## Evaluating local models

`scripts/eval/` scores how well a model picks tools from this server. Each
prompt in `cases.json` is sent to an OpenAI-compatible endpoint (LM Studio's
local server by default) with the real tool list, and the first tool call is
checked for the expected tool and arguments. Figma is never touched.

```powershell
npm run eval -- --profile core                 # 22 tools, first loaded model
npm run eval -- --profile full --skill         # all tools, SKILL.md as system prompt
npm run eval -- --model gemma-4-26b --runs 3   # average over repeated runs
```

Profiles live in `scripts/eval/profiles.json` (the same lists as the Hermes
`tools.include` examples above). Results go to `.eval/*.json` with the
average prompt-token count, which shows what each profile costs in context.

**Live, multi-step.** `npm run eval:live` lets the model drive the real
server, daemon and plugin on the file open in Figma desktop: six tasks
(`scripts/eval/live-tasks.mjs` — build a card, recolor by name, rename and
move, an icon row, component + instance, read a text) in an agent loop, each
followed by a deterministic canvas check. Screenshots the model requests are
fed back as images. Everything a task creates at page level is removed
afterwards, but run it on a scratch file.

```powershell
npm run eval:live -- --profile design --skill
npm run eval:live -- --model google/gemma-4-31b --tasks card,icon-row --max-turns 8
```

Both scripts set `max_tokens` high because thinking models (Qwen3.8, Gemma 4)
reason before emitting the tool call; a low cap looks like "no tool call".
Load models with `--context-length 32768` or larger: the `full` profile alone
is 10–12k prompt tokens. Results and findings so far: `docs/eval-2026-10-11.md`.

## Architecture

```
              ws://localhost:7575
                       │
                ┌──────┴───────┐
                │ bridge daemon│  ← started by the first MCP server (or start-bridge.bat / task)
                └──┬─────────┬─┘
       role=plugin │         │ role=mcp (any number)
                   ▼         ▼
          ┌────────────┐  ┌──────────────┐
          │ Figma      │  │ MCP server   │  ← spawned by the client: Hermes, Claude Code,
          │ plugin     │  │ (stdio)      │     Codex, LM Studio …
          └────────────┘  └──────────────┘
```

The daemon is the long-lived owner of the WebSocket port. Clients stop and
restart MCP servers freely; because the daemon outlives them, the plugin
stays connected and several clients can share one plugin. The daemon is a
detached process that the server starts when the port is closed.

## Notes

- REST reads return a compact outline by default (one line per node: type, name, id, bounds, layout, fills, text). Pass `format: "raw"` for the full JSON. Every text result is capped at `FIGMA_MCP_MAX_RESULT_CHARS` (20 000) with a `…[truncated]` marker.
- Prefer `get_metadata` first, then `get_node` for specific subtrees, rather than `get_file` on every call.
- `get_image` (REST) returns S3 URLs that expire ~30 days after generation. `get_screenshot` (plugin) returns inline base64.
- The daemon allows only one connected plugin. If you open the plugin in two Figma windows, only the newest connection is kept.
- The Variables REST endpoints (`get_local_variables`, `get_published_variables`) need an Enterprise plan; the plugin-side variable tools (`list_variables`, `create_variable`, `bind_variable`, `get_variable_defs`, …) work on every plan.
- `use_figma` snippets get helpers (`query`, `set`, `createAutoLayout`, `loadFontsFor`, `hex`, `solid`), automatic `created_ids`/`changed_ids`, and error hints with `safe_to_retry`; the rules are in `skills/figma-mcp/SKILL.md`.
- Thinking models (Qwen3.8, Gemma 4) reason before emitting a tool call; give them a high output-token limit or they return "no tool call".
