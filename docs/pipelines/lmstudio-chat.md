# LM Studio chat

LM Studio's own chat window as the MCP host. Good for a quick manual check
of a model or a tool; not the main pipeline, because LM Studio has no skills,
no tool filtering and no deferred loading: all 88 tools (~12k tokens for
Qwen, ~10k for Gemma) sit in every request.

## Setup

Program → Integrations → Edit `mcp.json`:

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["E:/Projects/gemma 4 figma mcp/dist/server.js"],
      "env": {}
    }
  }
}
```

Then in Server/Chat settings enable "Allow calling servers from mcp.json",
toggle the `figma` server on in the Plugins list, and load a model with
tool calling and a context of 32k or more (the default 8192 is too small
for the tool list alone). The server reads `FIGMA_TOKEN` from its own `.env`.

Because there is no skill, put the essentials into the model's system prompt
(LM Studio: the "System Prompt" field of the chat):

```
You control Figma through the figma MCP tools. Act directly on requests; do
not call bridge_status first. Prefer structured tools (create_frame,
create_text, set_fill, set_auto_layout, create_instance, insert_icon) over
use_figma. In use_figma: colors are 0-1, load fonts before editing text,
return a small object with ids. Take one screenshot after a batch of changes.
```

## Example

```
user:  Take a screenshot of my selection.
model: get_screenshot → image shown in the chat (LM Studio renders image blocks
       from tools in recent versions; otherwise open the path under screenshots/)

user:  Make a 3x2 grid of 80x80 squares at 100,100 with 16px gaps, colors from
       #ef4444 to #3b82f6.
model: use_figma (one snippet with a loop) → created_ids

user:  Group them and call the group "Palette".
model: group_nodes {node_ids: [...], name: "Palette"}
```

## Limits

- No tool profiles: every call carries all 88 schemas. Expect slower first
  tokens than in Hermes with `core`/`design`.
- Prompts and resources exposed by the server (`figma_help`) may not be
  shown; call the `help` tool instead (`help("canvas")`, `help("troubleshoot")`).
- Image content from tools is rendered only in newer LM Studio builds; the
  PNG is always saved under `screenshots/` and the path is in the reply.
