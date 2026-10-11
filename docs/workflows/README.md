# Workflows

Three end-to-end ways of working with this server. The client pages in
[../pipelines/](../pipelines/README.md) tell you how to connect; these pages
tell you what to ask for, in what order, and what "done" means.

| Workflow | When | Page |
|----------|------|------|
| **Create from scratch** — brief → tokens → components → one or more screen variants → critique → pick | a new product surface, a landing page, an app screen | [01-create-from-scratch.md](01-create-from-scratch.md) |
| **Edit a part** — analyse a region, propose changes with reasons, apply after approval, show before/after | an existing design needs a change in one area | [02-edit-and-propose.md](02-edit-and-propose.md) |
| **Atomize for hand-off** — turn a finished design into tokens, components with variants and a clean spec for frontend | the prototype is final and goes to Framer, Webflow or code | [03-atomize-for-handoff.md](03-atomize-for-handoff.md) |

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
