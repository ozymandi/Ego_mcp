# Design critique — how to review and fix a prototype

Two layers. The deterministic layer is the `critique_design` tool: ~40 rules
over the live nodes, no model involved, each finding names the node and the
tool that fixes it. The judgement layer is you, looking at `get_screenshot`
and `get_node_spec` with the rubric below. Rule ids follow Impeccable's
detector (github.com/pbakaus/impeccable) where a counterpart exists.

## Workflow

1. Build the screen. Do not critique half-built work.
2. `critique_design(node_id)` once. Fix every **primary** finding with the
   tool named in the line (`set_fill`, `set_text`, `set_auto_layout`,
   `resize_node`, `bind_variable`, `use_figma`). Use the node ids from the
   report; do not re-find them.
3. Decide on **advisory** findings; most are worth fixing, some are intended
   (an all-caps label with wide tracking, a pill that is really a status).
4. `critique_design` again. Primary must be 0. Then one `get_screenshot` for
   the judgement pass.
5. Stop. Two critique rounds are enough; a third means the brief is unclear.

## Reading the report

```
critique: FRAME "Landing" id=12:34 — 3 primary, 5 advisory (43 rules, 412 nodes)
P low-contrast     TEXT "Subtitle" 12:41  #9aa0a6 on #f5f5f5 = 2.6:1 (need 4.5:1)  -> set_fill …
A monotonous-spacing  FRAME "Landing" 12:34  all gaps/paddings = 16 across 12 containers  -> …
```

`P` = primary (readability, overflow, clichés that mark the design as
generated), `A` = advisory (taste and hygiene). The node after the rule is
the one to change; subtree-level findings point at the root.

## Fix recipes

| Finding | Fix |
|---------|-----|
| `low-contrast`, `gray-on-color` | darken the text (`set_fill` #111–#444 on light, #fff/#e5e5e5 on dark) or lighten the surface; never gray on a saturated color |
| `tiny-text`, `tight-leading`, `line-length` | 14–16px body, line-height 150%, text box width ≈ 60–75 characters (`use_figma`: `fontSize`, `lineHeight = {unit:'PERCENT', value:150}`, `resize`) |
| `flat-type-hierarchy`, `heading-rhythm` | a scale: 14 / 16 / 20 / 24 / 32 / 48; headings ≥ 1.5× body |
| `oversized-h1`, `extreme-negative-tracking` | heading ≤ 12% of frame width; tracking between −2% and 0 |
| `gradient-text`, `ai-color-palette`, `dark-glow`, `radial-halo` | one brand hue, solid fills, neutral low-alpha shadows; delete decorative blobs |
| `nested-cards` | keep one surface: remove the inner card's fill/radius/shadow, or the outer's |
| `monotonous-spacing`, `off-grid-spacing` | 8 inside groups, 16–24 between groups, 32–64 between sections, all multiples of 4 (`set_auto_layout`) |
| `icon-tile-stack`, `hero-eyebrow-chip`, `numbered-section-labels` | remove the decoration; let the heading carry the message |
| `text-overflow`, `text-occlusion`, `clipped-overflow-container` | `layoutSizingHorizontal = 'FILL'` + `textAutoResize = 'HEIGHT'`, or widen the container; reorder layers |
| `marketing-buzzword`, `aphoristic-cadence`, `em-dash-overuse`, `repeated-container-text`, `lorem-placeholder` | `set_text` with concrete copy: what it does, for whom, with a verb |
| `design-system-color`, `design-system-font`, `design-system-number` | `bind_variable` / apply the text style; the file already has tokens |
| `unnamed-layers`, `hidden-layers`, `absolute-in-autolayout`, `inconsistent-radius`, `small-tap-target` | `rename_node`, `delete_nodes`, one radius token, ≥ 40px tap height |

## Judgement rubric (the part rules cannot do)

Look at the screenshot and answer each in one sentence; fix what fails.

- **Hierarchy**: can you name the single most important element in 2 seconds? Is there exactly one primary action per screen?
- **Clarity**: does every text say something a user needs? Would the screen work with the illustration removed?
- **Rhythm**: are related things closer than unrelated things? Does spacing grow from element → group → section?
- **Voice**: is the copy specific to this product (names, numbers, verbs) rather than any product?
- **Restraint**: one typeface pair, one brand hue plus one accent, one radius, one shadow. Everything else is noise.
- **States**: empty, loading, error, and the longest realistic string all fit.

Report what you changed with node ids and one screenshot; do not restate the rules.
