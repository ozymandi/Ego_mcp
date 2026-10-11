# Workflow 1 — Create from scratch (brief → variants → critique → pick)

Goal: from a short brief to one or more reviewed screen variants in Figma,
built on tokens and components so the winner can go straight to workflow 3.

Profile: `design`. Skill: `figma-mcp` loaded. Page: a scratch page.

## 0. Brief

Give the agent the facts it cannot invent. Five lines are enough:

```
Product: invoicing app for freelancers. Screen: Invoices list (desktop, 1440).
Audience: non-accountants; tone: calm, precise. Must have: list of invoices
with status, totals, "New invoice" action, filter by status. Brand: #1D4ED8
primary, Inter. Avoid: dashboard clichés, purple gradients, icon tiles.
```

Weak briefs produce the clichés the critique then flags; the agent cannot
know your audience from the canvas.

## 1. Scratch page and tokens

```
you:    Create a page "WIP / Invoices" and switch to it. Then set up tokens:
        a "Theme" collection with Light and Dark modes; colors bg/surface,
        bg/canvas, text/primary, text/secondary, brand/primary, border/default,
        status/paid, status/overdue; number variables space/4, 8, 12, 16, 24, 32
        and radius/sm=6, md=10, lg=16.

agent:  use_figma (figma.createPage) → set_current_page
        create_variable_collection {name: "Theme", modes: ["Light", "Dark"]}
        create_variable ×8 (COLOR, values_by_mode) and ×9 (FLOAT)
        list_variables {collection_id} → confirms
```

If the file already has a design system, replace this step with
`list_variable_collections` / `list_components` (or `search_design_system`
for a team library) and reuse what exists.

## 2. Atoms and molecules as components

Build the smallest pieces first, as components with variants, bound to the
tokens. One prompt per family keeps each `use_figma` call retry-safe:

```
you:    Build a Button component set: variants Kind=Primary|Secondary|Ghost ×
        State=Default|Hover|Disabled, auto-layout, padding space/12 × space/16,
        radius radius/md, label bound to text style "Label/md", colors bound to
        the Theme variables. Place it at 0,0 on this page.

agent:  create_component / use_figma per variant → combine_as_variants {name: "Button"}
        bind_variable (fill, padding, cornerRadius) on each variant
        get_instance_properties on a test instance → Kind/State visible
```

Repeat for `Input`, `Badge/Status`, `Table/Row`, `Icon` (via `insert_icon`
inside a 24×24 component). Then molecules: `Table/Header`, `Filter/Chip row`,
`Page/Header` composed from instances (`create_instance` + `set_instance_properties`).

Acceptance for this step: `list_components` shows every family;
`critique_design` on the components page reports no `design-system-*`
findings; a `get_variable_defs` on any component lists only Theme variables.

## 3. Screen variants

Ask for variants that differ in a decision, not in decoration:

```
you:    Build two variants of the Invoices screen side by side at 1440×1024,
        named "Invoices / A — table first" and "Invoices / B — cards first".
        A: dense table with status badges, filters above, totals in the
        header. B: summary cards (outstanding, paid this month, overdue) above
        a lighter table. Both use only the components on this page and the
        Theme tokens. Position B 1600px to the right of A.

agent:  create_frame ×2 → set_auto_layout
        create_instance ×N with properties (Page/Header, Filter row, Table/Row …)
        create_text for real-looking content (invoice numbers, client names, amounts)
        get_screenshot {node_ids: [A, B]}
```

A third variant is cheap once components exist: `clone_node` the closest
one and ask for the one change ("C — same as A but with a left sidebar").

## 4. Critique and fix

```
you:    Critique both variants and fix every primary finding. List the
        advisories you chose not to fix and why.

agent:  critique_design {node_id: A} → fixes → critique_design {node_id: A, min_severity: "primary"} → 0
        critique_design {node_id: B} → …
        get_screenshot {node_ids: [A, B]}
```

Expected findings on first builds: `low-contrast` on secondary text,
`small-tap-target` on table actions, `repeated-container-text` when the
agent duplicated placeholder rows, `design-system-color` when it typed a
hex instead of binding. All have one-tool fixes named in the report.

## 5. Pick, promote, record

The designer picks on the screenshot (and in Figma). Then:

```
you:    A is the direction. Move the "Invoices / A" frame to the "Screens"
        page, rename it "Invoices", delete B. Write a DESIGN note: tokens,
        components used, and the two decisions that differ from the brief.

agent:  use_figma (move between pages: clone to target page, remove original)
        rename_node, delete_nodes
        get_node_spec {node_id: A} → the note's component list comes from the spec
```

The spec and the variable list are the inputs for workflow 3; a losing
variant's good pieces are already components, so nothing is lost.

## Checklist

- [ ] brief has audience, must-haves, brand, and an "avoid" line
- [ ] tokens exist before the first screen; no hex typed into screens
- [ ] every repeated element is an instance, not a copy
- [ ] variants differ in a decision; each critiqued to 0 primary
- [ ] winner moved to the Screens page, named, spec saved
