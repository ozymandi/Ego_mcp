# Codex

OpenAI's Codex CLI / IDE agent. Codex sends the whole tool list with each
request, so prefer a project where only this server is enabled, or accept
the ~10k-token cost of 88 tools.

## Setup

`~/.codex/config.toml`:

```toml
[mcp_servers.figma]
command = "node"
args = ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
# env = { FIGMA_TOKEN = "..." }   # optional; the server reads its own .env
```

Codex reads `AGENTS.md` from the project root. Point it at the skill so the
`use_figma` rules are part of every session:

```markdown
# AGENTS.md
## Figma
This project uses the `figma` MCP server (gemma-figma-mcp). Before any Figma
work read `E:/Projects/gemma 4 figma mcp/skills/figma-mcp/SKILL.md` and
follow its rules: act directly (no connectivity check first), prefer
structured tools over `use_figma`, one screenshot per batch, keep node ids.
```

Newer Codex versions also discover `SKILL.md` folders; if yours does, copy
`skills/figma-mcp` into its skills directory instead of the `AGENTS.md`
pointer. Check `codex --help` for the current location.

## Example

```
> Read the selected frame in Figma and generate the matching HTML/CSS.
  figma.get_selection → figma.get_node_spec → figma.get_screenshot → writes index.html + styles.css

> The designer renamed the primary color token. Show me every layer that uses
  brand/primary on the page.
  figma.list_variables {name_pattern: "brand/primary"}
  figma.get_variable_defs {node_id: <page frame>}

> Draw the request flow from docs/flow.md as a flowchart on the current page.
  figma.mermaid_to_canvas {mermaid: "flowchart TD ..."}
```

## Notes

- Tool names are `figma.<tool>` or `figma__<tool>` depending on the Codex
  version; the model sees the descriptions either way.
- For long sessions use the `core`/`design` tool lists as a mental guide:
  the model does not need Code Connect or filesystem tools for canvas work,
  and you can disable the server for non-Figma tasks to save context.
