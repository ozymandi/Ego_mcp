# Hermes Agent + LM Studio (local models)

The primary pipeline: Hermes Agent (Nous Research) runs the agent loop, LM
Studio serves a local model, this server exposes Figma. Hermes loads the full
tool list of the server into every request and loads `SKILL.md` on demand,
so the profile choice matters here more than anywhere else.

Tested: Qwen3.8 27B and Gemma 4 31B on an RTX 5090, context 32 768.

## 1. LM Studio

```powershell
lms server start
lms load qwen/qwen3.8-27b --context-length 32768 -y      # or google/gemma-4-31b
lms ps                                                     # CONTEXT must say 32768
```

- **Context length.** Load with `--context-length 32768` (or set it in the
  model's defaults). If LM Studio reloads the model itself (JIT loading after
  a server restart) it falls back to 8192 and the `full` profile fails with
  `exceed_context_size_error`.
- **Auth.** Newer LM Studio versions require an API token on the local server
  (HTTP 401). Either create one under Developer → Server settings → API tokens
  and give it to Hermes as `LM_API_KEY`, or turn the requirement off.
- Only one 27–31B model fits in 32 GB of VRAM; unload the other first
  (`lms unload --all`).

## 2. Hermes config

`~/.hermes/config.yaml` (secrets go to `~/.hermes/.env`):

```yaml
model:
  provider: lmstudio            # OpenAI-compatible; LM_BASE_URL defaults to http://localhost:1234/v1
  name: qwen/qwen3.8-27b

mcp_servers:
  figma:                        # keep this name: tools become mcp_figma_<tool>,
    command: node               # and the skill is gated on the mcp-figma toolset
    args: ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
    lazy: true                  # start on first use
    timeout: 120
    tools:
      include: [ ...profile list... ]     # see below

skills:
  external_dirs:
    - "E:/Projects/gemma 4 figma mcp/skills"
```

Set `LM_API_KEY` in `~/.hermes/.env` if the LM Studio server requires a token.
Check the exact provider keys with `hermes --help` / `hermes model`; they
have changed between releases.

### Profile per model

From the eval (`docs/eval-2026-10-11.md`):

| Model | Profile | Why |
|-------|---------|-----|
| Qwen3.8 27B | `design` | 6/6 live tasks, 100% first-call; `full` works but costs 12k tokens per turn |
| Gemma 4 31B | `design` or `full` | 6/6 on every profile and about half of Qwen's tokens |

Copy the array from `scripts/eval/profiles.json` into `tools.include`. The
`core` list is short enough to inline:

```yaml
    tools:
      include: [bridge_status, get_current_page, get_selection, find_nodes, get_screenshot,
                use_figma, create_frame, create_rectangle, create_ellipse, create_text, create_line,
                clone_node, move_node, resize_node, set_fill, set_stroke, set_text, rename_node,
                delete_nodes, set_selection, group_nodes, set_auto_layout,
                get_node_spec, create_instance, insert_icon, list_pages, set_current_page]
```

Do not set `supports_parallel_tool_calls`: canvas writes must run one at a
time. Leave `help` out of the include list; the skill replaces it.

### The skill

`skills/figma-mcp/SKILL.md` appears in Hermes's skill index (name +
description only, ~100 tokens) and is loaded in full (~2.7k tokens) when a
task is about Figma. It tells the model to act directly instead of checking
connectivity first, which tools to prefer, the `use_figma` rules and the
helpers, and how to recover from errors. Hermes may extend it with its own
learned skills (`/learn`); keep `skills.write_approval: true` if you want to
review those.

## 3. Example session

```
you:    Is Figma connected?
hermes: mcp_figma_bridge_status → "Untitled", page "Page 1", plugin build 2026-10-11 …

you:    Create a card at 100,100 named Card, 320 wide, vertical auto-layout with
        padding 16 and gap 8, white, 12px radius. Inside: bold 18px title "Welcome"
        and 14px gray body "Thanks for joining us."
hermes: mcp_figma_use_figma (one snippet: createAutoLayout + two texts) → ids
        mcp_figma_get_screenshot → image
        "Done: Card (12:34) with title and body."

you:    Add a row of four icons under the title: heart, message-circle, repeat, send,
        24px, #333333, gap 24.
hermes: mcp_figma_create_frame → mcp_figma_set_auto_layout → mcp_figma_insert_icon ×4

you:    Turn the card into a component and put an instance at 500,100.
hermes: mcp_figma_create_component → mcp_figma_create_instance

you:    Give me the spec of the card so I can build it in React.
hermes: mcp_figma_get_node_spec → writes the component from the outline
```

Prompts that need a `design` or `full` profile: anything about variables,
components in a team library (`search_design_system`), importing an image
from disk, Mermaid/flowcharts, Code Connect.

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| every tool call fails with `Bridge daemon not reachable` | daemon died and autostart could not bring it back | call `bridge_status` (it restarts the daemon); then check `daemon.log`; `start-bridge.bat` as a last resort |
| `Figma plugin not connected to bridge daemon` | plugin window closed or stale | run the plugin in Figma desktop, press Reconnect |
| `exceed_context_size_error` on the first message | model loaded with 8192 context | `lms unload --all` then `lms load … --context-length 32768` |
| HTTP 401 from LM Studio | API token required | token into `LM_API_KEY`, or disable the requirement |
| the model calls `bridge_status` before every action | old skill text | pull the repo; the skill now says "act directly" |
| the model answers in prose instead of calling a tool | output token cap too low for a thinking model | raise Hermes's max output tokens; Qwen/Gemma reason first |
| screenshots are missing from the reply | model is not multimodal or Hermes vision is off | Qwen3.8 and Gemma 4 are multimodal; check `vision` settings |
| plugin error about `documentchange` / `loadAllPagesAsync` | an old plugin build | rebuild (`npm run build`) and re-run the plugin; `bridge_status` shows the build stamp |

Logs: daemon window (or `daemon.log` with the autostart task), the gray log
area in the plugin window, Hermes's own tool log.
