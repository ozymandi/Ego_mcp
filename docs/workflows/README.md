# Workflows

Three end-to-end ways of working with this server. The client pages in
[../pipelines/](../pipelines/README.md) tell you how to connect; these pages
tell you what to ask for, in what order, and what "done" means.

| Workflow | When | Page |
|----------|------|------|
| **Create from scratch** — brief → tokens → components → one or more screen variants → critique → pick | a new product surface, a landing page, an app screen | [01-create-from-scratch.md](01-create-from-scratch.md) |
| **Edit a part** — analyse a region, propose changes with reasons, apply after approval, show before/after | an existing design needs a change in one area | [02-edit-and-propose.md](02-edit-and-propose.md) |
| **Atomize for hand-off** — turn a finished design into tokens, components with variants and a clean spec for frontend | the prototype is final and goes to Framer, Webflow or code | [03-atomize-for-handoff.md](03-atomize-for-handoff.md) |

Worked example: [examples/agency-brutalist-hermes.md](examples/agency-brutalist-hermes.md) — a design agency site (six pages, pure blue / white / acid lime, brutalism, blackletter headings) as a Hermes session, message by message.

Conventions shared by all three:

- **Names mean something.** `Section/Hero`, `Card/Pricing`, `Button/Primary`;
  variant components as `State=Default, Size=md`. The critique's
  `unnamed-layers` rule flags leftovers.
- **Tokens before pixels.** Colors, spacing, radii and type come from
  variables and text styles; `critique_design` reports hardcoded values once
  a collection exists.
- **One critique per screen.** Build, `critique_design`, fix every primary,
  critique again, one screenshot. Two rounds, not more.
- **Ids, not names, after the first lookup.** Every tool returns ids; the
  agent should reuse them.
- **Work on a scratch page** (`set_current_page`) until the designer
  promotes the result.

Profiles: workflow 1 and 3 need `design` (components, variables); workflow
2 runs on `core` plus `critique_design`.

## Hermes vs LM Studio chat

Each workflow page ends with two sections, one per client. The difference
in one paragraph: **Hermes** loads `skills/figma-mcp/SKILL.md` on demand, so
the prompts can be short and the agent already knows the rules (act
directly, ids not names, one critique per screen, fix recipes). **LM Studio
chat** has no skills and sends all 90 tools every turn, so the rules go into
the chat's system prompt, each step is its own message, and the model gets
reminded which tool to use. Both run the same server; the tool traces are
the same.

System prompt for LM Studio chat (paste once per chat; the per-workflow
sections add one or two lines to it):

```
You control Figma through the figma MCP tools. The plugin is connected and a
design file is open. Act on requests directly; do not call bridge_status
first. Prefer structured tools (create_frame, create_text, set_fill,
set_auto_layout, create_instance, insert_icon, bind_variable) over use_figma;
in use_figma colors are 0-1, load fonts before editing text, return a small
object with ids. Reuse node ids from earlier results instead of searching
again. After building or changing a screen: critique_design on its root, fix
every P finding with the tool named in the line, critique_design once more,
then one get_screenshot. Never run the critique more than twice per screen.
Name layers by role (Section/Hero, Button/Primary). Reply in one or two
sentences with the node ids you created or changed.
```

Load the model with a 32k context or more; the tool list alone is ~12k
tokens for Qwen3.8 and ~10k for Gemma 4.
