# gemma-figma-mcp

MCP server that connects **Gemma 4** running in **LM Studio** to **Figma**.

Phase 1 (current): read-only REST tools + posting comments.
Phases 2–6 (planned): Figma Variables/Libraries, in-canvas execution via a companion plugin, Code Connect, design-system search, diagrams.

## Tools (phase 1)

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
| `get_image` | Export nodes as PNG/JPG/SVG/PDF |

All tools accept either a raw `file_key` or a full Figma URL — both work.

## Setup

### 1. Install

```powershell
npm install
npm run build
```

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
```

> Never paste the token into the chat or commit it to git. `.env` is in `.gitignore`.

### 3. Wire up LM Studio

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

### 4. Sanity check (without LM Studio)

```powershell
npm run dev
```

The server starts on stdio and prints `[gemma-figma-mcp] ready on stdio` to stderr. Press Ctrl+C to stop. (Stdio servers are usually exercised by the MCP client, not directly.)

## Notes

- Figma REST responses can be large. Prefer `get_metadata` first, then `get_node` for specific subtrees, rather than `get_file` on every call.
- `get_image` returns S3 URLs that expire ~30 days after generation.
- Variables and Libraries (phase 2) require Enterprise-tier plan for full coverage.
