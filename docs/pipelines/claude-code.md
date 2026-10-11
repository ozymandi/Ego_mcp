# Claude Code

Hosted Claude models with the Claude Code harness. Claude Code defers MCP
tool schemas and loads them on demand, so the `full` tool set costs nothing
until a tool is used; no profile is needed.

## Setup

Register the server in the project's `.mcp.json` (shared with the repo) or
in `~/.claude.json` (user-wide):

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

Install the skill so Claude reads the rules before touching the canvas:

```powershell
# project-local
New-Item -ItemType Directory -Force .claude\skills | Out-Null
Copy-Item -Recurse "E:\Projects\gemma 4 figma mcp\skills\figma-mcp" .claude\skills\figma-mcp
# or user-wide
Copy-Item -Recurse "E:\Projects\gemma 4 figma mcp\skills\figma-mcp" "$HOME\.claude\skills\figma-mcp"
```

Claude Code ignores the `metadata.hermes` block in the frontmatter; `name`
and `description` are enough for it to list the skill. Tool names appear as
`mcp__figma__<tool>`.

If the official Figma MCP is also connected, both expose `use_figma`,
`get_screenshot`, `get_metadata`. Address this one explicitly ("use the
local figma server") or disable the other for the session.

## Example

```
> Use the local figma server. What is on the current page?
  mcp__figma__get_current_page → 3 top-level frames, nothing selected
  mcp__figma__find_nodes {type: FRAME}

> Implement the frame "Checkout" as a React component with Tailwind.
  mcp__figma__find_nodes {name_pattern: "^Checkout$"}
  mcp__figma__get_node_spec {node_id: "12:34"}
  mcp__figma__get_variable_defs {node_id: "12:34"}
  mcp__figma__get_screenshot {node_ids: ["12:34"]}
  → writes Checkout.tsx from the outline, variables become CSS custom properties

> Push the Button component from src/components/Button.tsx into Figma as a
  component set with Primary/Secondary and Default/Hover variants.
  mcp__figma__list_variable_collections → reuse existing color tokens
  mcp__figma__use_figma ×N (one per variant, then combine)
  mcp__figma__combine_as_variants
  mcp__figma__get_screenshot

> Map the Figma Button to the code component.
  mcp__figma__scan_code_connect {directory: "src"}
  mcp__figma__get_node_props_for_connect → mcp__figma__generate_code_connect → mcp__figma__save_code_connect
```

Claude handles the `full` profile and multi-page work well; the main things
to watch are the same as for any client: one screenshot per batch, ids from
previous calls, `use_figma` only when no structured tool fits.

## Notes

- `get_image` (REST) returns URLs; `get_screenshot` (plugin) returns the
  image inline and saves it under `screenshots/`.
- REST tools need `FIGMA_TOKEN` in the server's `.env`; canvas tools do not.
- The server's responses are capped at 20 000 characters; ask for
  `format: "raw"` or a smaller `max_depth` when an outline is cut.
