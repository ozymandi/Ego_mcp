# gemma-figma-mcp

MCP server that connects **Gemma 4** running in **LM Studio** to **Figma**.

- Phase 1 — REST read tools + posting comments. ✅
- Phase 3 — Figma plugin + WebSocket bridge, `use_figma` and live canvas tools. ✅
- Phases 2, 4–6 (planned): Variables/Libraries, Code Connect, design-system search, diagrams.

## Tools

### REST (phase 1)
| Tool | Purpose |
|------|---------|
| `whoami` | Current Figma user |
| `get_file` | Full file tree |
| `get_metadata` | Top-level structure (depth=1) |
| `get_node` | Subtree for specific node IDs |
| `get_components` | All components in a file |
| `get_styles` | All styles in a file |
| `get_comments` | Read comments |
| `post_comment` | Add a comment (or reply) |
| `get_image` | Export nodes as PNG/JPG/SVG/PDF (via Figma render service) |

### Plugin bridge (phase 3)
| Tool | Purpose |
|------|---------|
| `bridge_status` | Whether the companion plugin is connected |
| `use_figma` | Execute a JS snippet inside the plugin; `figma`, `selection`, `currentPage` in scope |
| `get_selection` | Summary of selected nodes |
| `get_current_page` | Current page + selection |
| `get_screenshot` | Saves PNG/JPG/SVG to `./screenshots/` and embeds an image content block |

### Variables & libraries (phase 2)
| Tool | Purpose |
|------|---------|
| `get_local_variables` | Variables & collections in a file (Enterprise) |
| `get_published_variables` | Variables a file publishes as a library (Enterprise) |
| `get_file_component_sets` | Component sets (variants) in a file |
| `get_component_by_key` | Single component by global key |
| `get_component_set_by_key` | Single component set by global key |
| `get_style_by_key` | Single style by global key |
| `get_team_components` | Paginated team library components |
| `get_team_component_sets` | Paginated team library component sets |
| `get_team_styles` | Paginated team library styles |

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

### 3. Start the bridge daemon

The Figma plugin and the MCP server both connect to a long-lived bridge
daemon. The daemon owns the WebSocket port and routes wire messages
between them. **Without the daemon running, the canvas tools won't work.**

In a terminal that stays open:

```powershell
npm run bridge
```

You should see:

```
[daemon] listening on ws://:::7575
```

Leave it running. The MCP server (spawned by LM Studio) and the Figma
plugin will both connect to it.

### 4. Wire up LM Studio

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

### 5. Install the Figma plugin

The plugin connects to the bridge daemon over WebSocket.

1. Open **Figma desktop** (the plugin runtime requires desktop, not the browser).
2. Top menu → **Plugins → Development → Import plugin from manifest…**
3. Select `plugin/manifest.json` in this repo.
4. Run the plugin: **Plugins → Development → Gemma 4 MCP Bridge**.
5. The plugin window shows a green dot when it's connected to the daemon at `ws://localhost:7575`.

Once connected, the `use_figma`, `get_selection`, `get_current_page`, and `get_screenshot` tools start working.

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

### 6. Sanity check (without LM Studio)

In one terminal:

```powershell
npm run bridge
```

In another:

```powershell
npm run dev
```

The MCP server prints `[bridge-client] connected to ws://localhost:7575` and `[gemma-figma-mcp] ready on stdio`. Press Ctrl+C in either terminal to stop. (Stdio servers are usually exercised by an MCP client, not directly.)

## Architecture

```
              ws://localhost:7575
                       │
                ┌──────┴───────┐
                │ bridge daemon│  ← `npm run bridge`
                └──┬─────────┬─┘
       role=plugin │         │ role=mcp
                   ▼         ▼
          ┌────────────┐  ┌──────────────┐
          │ Figma      │  │ MCP server   │  ← spawned by LM Studio
          │ plugin     │  │ (stdio)      │
          └────────────┘  └──────────────┘
```

The daemon is the long-lived owner of the WebSocket port. Decoupling it
from the MCP server's lifecycle is important because LM Studio may stop
and restart MCP servers freely — without a separate daemon, the plugin
would see constant reconnect cycles.

## Notes

- Figma REST responses can be large. Prefer `get_metadata` first, then `get_node` for specific subtrees, rather than `get_file` on every call.
- `get_image` (REST) returns S3 URLs that expire ~30 days after generation. `get_screenshot` (plugin) returns inline base64.
- The daemon allows only one connected plugin. If you open the plugin in two Figma windows, only the newest connection is kept.
- Variables and Libraries (phase 2) require Enterprise-tier plan for full coverage.
