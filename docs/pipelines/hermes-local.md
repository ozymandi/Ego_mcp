# Hermes Agent + LM Studio (local models)

The primary pipeline: Hermes Agent (Nous Research) runs the agent loop, LM
Studio (or Hermes's bundled llama-server) serves a local model, this server
exposes Figma. Hermes keeps the tool index in context, fetches a tool's full
schema when the model picks it, loads `SKILL.md` on demand, and executes
**one MCP call per model turn**: a plan of twelve edits is twelve round
trips of 15-20 s each on a 27B model. That turn cost, not the tool list,
is what shapes the work below.

Tested: Qwen3.8 27B and Gemma 4 31B on an RTX 5090. **Hermes requires a model
context of at least 64k**, so load models with `--context-length 65536` for
Hermes (the eval scripts in this repo are fine with 32k). Step-by-step setup:
[../workflows/examples/hermes-step-by-step.md](../workflows/examples/hermes-step-by-step.md).

## 1. LM Studio

```powershell
lms server start
lms load qwen/qwen3.8-27b --context-length 65536 -y      # or google/gemma-4-31b; Hermes needs >= 64k
lms ps                                                     # CONTEXT must say 65536
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

`config.yaml` in Hermes's home (`~/.hermes/` for the CLI install, `%LOCALAPPDATA%\hermes\` for Hermes Desktop on Windows; secrets go to `.env` next to it):

```yaml
model:
  provider: lmstudio            # OpenAI-compatible; LM_BASE_URL defaults to http://localhost:1234/v1
  name: qwen/qwen3.8-27b

mcp_servers:
  gemma_figma:                  # any name works; tools become mcp__<name>__<tool>
    command: node
    args: ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
    lazy: true                  # start on first use
    timeout: 120
    tools:
      include: [ ...profile list... ]     # see below

skills:
  external_dirs:
    - "E:/Projects/gemma 4 figma mcp/skills"    # required, see "The skill" below
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

Two things that silently disable it:

- `skills.external_dirs` does not list the repo's `skills` folder. Hermes
  then has no Figma skill, the model works from the raw tool descriptions,
  and after the first long session Hermes writes its own skill
  (`figma-bridge` in the live run) with whatever the model concluded,
  including wrong API usage. Check with "Which skills do you have?" and
  delete a self-written Figma skill if `figma-mcp` is present.
- An older copy of `SKILL.md` carried `requires_toolsets: [mcp-figma]`,
  which hides the skill unless the server is registered as `figma`. The
  gating is gone; pull the repo if your copy still has it.

## 3. What to give a local model

From the live run of the agency example (2026-10-11, Qwen3.8 27B, half a
day, verdict from the designer: not accepted; details in
[../workflows/examples/hermes-step-by-step.md](../workflows/examples/hermes-step-by-step.md#10-what-the-live-run-showed)):

| Workflow | Local model through Hermes | Why |
|----------|----------------------------|-----|
| [01 create from scratch](../workflows/01-create-from-scratch.md) from a text brief | **no** | the model turns "brutalism, blackletter, acid lime" into one element per word; no composition, no rhythm; the critique passes it because the rules check contrast and spacing, not intent |
| [04 build from a reference](../workflows/04-build-from-reference.md) | yes | the judgement is in the screenshot; the model describes, you correct, it executes |
| [02 edit a region](../workflows/02-edit-and-propose.md) | yes | bounded scope, ids known, one or two tool calls per change |
| [03 atomize for hand-off](../workflows/03-atomize-for-handoff.md) | yes | mechanical: tokens, variant sets, renames, spec files; use the batch tools |
| replicate a finished page to other pages or to mobile | yes, with a per-breakpoint type scale in the prompt | the first page is the reference |

Creation from a brief belongs to [Claude Code](claude-code.md) or
[Codex](codex.md) with a hosted model, or to the designer by hand for one
page that the local model then replicates. Same server, same skill, no config
change.

Costs to expect with a 27B model at 64k context: 15-20 s per step, a
75-90 s context compaction every one or two steps once the session passes
~55k tokens (Hermes compacts at 50% of the window and the model writes the
summary itself), plugin restarts after a long session. A fresh session per
page, with the ids you need repeated in the first message, is cheaper than
one long session. If VRAM allows, load the model with 98304 context to make
compaction rare.

## 4. Example session

```
you:    Is Figma connected?
hermes: mcp__gemma_figma__bridge_status → "Untitled", page "Page 1", plugin build 2026-10-11 …

you:    Create a card at 100,100 named Card, 320 wide, vertical auto-layout with
        padding 16 and gap 8, white, 12px radius. Inside: bold 18px title "Welcome"
        and 14px gray body "Thanks for joining us."
hermes: mcp__gemma_figma__use_figma (one snippet: createAutoLayout + two texts) → ids
        mcp__gemma_figma__get_screenshot → image
        "Done: Card (12:34) with title and body."

you:    Add a row of four icons under the title: heart, message-circle, repeat, send,
        24px, #333333, gap 24.
hermes: mcp__gemma_figma__create_frame → mcp__gemma_figma__set_auto_layout → mcp__gemma_figma__insert_icon ×4

you:    Turn the card into a component and put an instance at 500,100.
hermes: mcp__gemma_figma__create_component → mcp__gemma_figma__create_instance

you:    Review the card and fix anything the critique marks as primary.
hermes: mcp__gemma_figma__critique_design {node_id: "12:34"} → 1 primary (low-contrast on the body text)
        mcp__gemma_figma__set_fill {node_id: "12:36", color: "#4b5563"}
        mcp__gemma_figma__critique_design {node_id: "12:34", min_severity: "primary"} → 0

you:    Give me the spec of the card so I can build it in React.
hermes: mcp__gemma_figma__get_node_spec → writes the component from the outline
```

More review examples, the rule list and the Impeccable combination:
[design-review.md](design-review.md).

Prompts that need a `design` or `full` profile: anything about variables,
components in a team library (`search_design_system`), importing an image
from disk, Mermaid/flowcharts, Code Connect.

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| every tool call fails with `Bridge daemon not reachable` | daemon died and autostart could not bring it back | call `bridge_status` (it restarts the daemon); then check `daemon.log`; `start-bridge.bat` as a last resort |
| `Figma plugin not connected to bridge daemon` | plugin window closed or stale | run the plugin in Figma desktop, press Reconnect |
| `exceed_context_size_error` on the first message | model loaded with 8192 context | `lms unload --all` then `lms load … --context-length 32768` |
| HTTP 401 from LM Studio | API token required | token into `LM_API_KEY`, or disable the requirement |
| the model calls `bridge_status` before every action | old skill text | pull the repo; the skill now says "act directly" |
| "Which skills do you have?" does not list `figma-mcp` | `skills.external_dirs` missing the repo folder, or an old `requires_toolsets` line | fix the config, restart Hermes; delete a self-written `figma-bridge` skill |
| Hermes freezes for a minute after a tool result, Figma idle | context compaction (log: `conversation_compression`) | wait; start a new session per page; load the model with more context |
| the model rebuilds a page instead of editing it | prompt without ids and scope | give the root id and "change only these nodes"; see workflow 02 |
| the model answers in prose instead of calling a tool | output token cap too low for a thinking model | raise Hermes's max output tokens; Qwen/Gemma reason first |
| screenshots are missing from the reply | model is not multimodal or Hermes vision is off | Qwen3.8 and Gemma 4 are multimodal; check `vision` settings |
| plugin error about `documentchange` / `loadAllPagesAsync` | an old plugin build | rebuild (`npm run build`) and re-run the plugin; `bridge_status` shows the build stamp |

Logs: daemon window (or `daemon.log` with the autostart task), the gray log
area in the plugin window, Hermes's own tool log.
