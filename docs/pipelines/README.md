# Pipelines

One MCP server, several ways to drive it. Pick the page that matches your
client. All of them need the same two things on the machine with Figma
desktop:

1. the Figma plugin (Plugins → Development → Gemma 4 MCP Bridge, green dot),
2. `.env` with `FIGMA_TOKEN` (REST tools only; canvas tools work without it).

The bridge daemon that connects plugin and server starts automatically
with the first MCP server any client launches, and stays up afterwards
(`daemon.log` in the project root). `start-bridge.bat` and the autostart
task are optional extras.

| Pipeline | Models | Tool list in context | Skill | Page |
|----------|--------|----------------------|-------|------|
| [Hermes Agent + LM Studio](hermes-local.md) | local: Qwen3.8 27B, Gemma 4 31B | all of the chosen profile, every turn | `skills.external_dirs` | recommended for local models |
| [Claude Code](claude-code.md) | Claude | deferred, loaded on demand | `.claude/skills/` | recommended for hosted models |
| [Codex](codex.md) | OpenAI | all tools | `AGENTS.md` pointer | |
| [LM Studio chat](lmstudio-chat.md) | local | all 88 tools (~12k tokens) | none | quick manual checks |
| [Your own agent loop](custom-agent.md) | any OpenAI-compatible | whatever you pass | you decide | automation, evals |

Cross-cutting: [Design review](design-review.md) — the prototype → `critique_design` → fix → hand-off loop, with examples for Hermes and LM Studio chat and how Impeccable fits at the code stage.

## Profiles

The server always registers all 88 tools. Clients that can filter choose a
profile; `scripts/eval/profiles.json` is the source of truth.

| Profile | Tools | Prompt cost per turn (Qwen / Gemma) | Use for |
|---------|-------|-------------------------------------|---------|
| `core` | 27 | ~4k / ~3k tokens | drawing and editing on the open page, icons, instances |
| `design` | 62 | ~8k / ~6k | + reading files, components, variables, design-system search, images, diagrams |
| `full` | 88 | ~12k / ~10k | + Code Connect, filesystem, team libraries, FigJam |

Measured accuracy per profile and model: [../eval-2026-10-11.md](../eval-2026-10-11.md).

## What a typical session looks like

Prompts the models handle reliably (traces from the live eval):

| Ask | Tools the model calls |
|-----|-----------------------|
| "Make every rectangle named Swatch green (#22c55e)." | `find_nodes` → `set_fill` ×3 |
| "Rename the frame 'Old' to 'Header' and move it to 400,40." | `find_nodes` → `rename_node` → `move_node` |
| "Create a card at 100,100, 320 wide, vertical auto-layout, padding 16, gap 8, white, radius 12, with a bold 18px title 'Welcome' and 14px gray body." | one `use_figma` snippet, or `create_frame` → `set_auto_layout` → `create_text` ×2 → `get_screenshot` |
| "A horizontal frame 'Actions' with the icons heart, message-circle, repeat, send at 24px #333." | `create_frame` → `set_auto_layout` → `insert_icon` ×4 → `get_screenshot` |
| "Turn 'Tile' into a component and place an instance at 500,1100." | `find_nodes` → `create_component` → `create_instance` |
| "What text is inside the frame 'Info'?" | `find_nodes` → `get_node_spec` |
| "Give me the spec of the selected screen so I can implement it." | `get_node_spec` (→ the model writes code) |
| "Review the landing page and fix what makes it look generated." | `critique_design` → `set_fill` / `set_text` / `use_figma` per finding → `critique_design` → `get_screenshot` |
| "Create a Light/Dark collection with brand/primary #0d99ff / #80c8ff and bind it to the card background." | `create_variable_collection` → `create_variable` → `bind_variable` |

Wording that helps every model: name the target ("the frame named X", a
node id like `12:34`), give sizes and colors explicitly, and ask for one
screenshot at the end rather than after every step.
