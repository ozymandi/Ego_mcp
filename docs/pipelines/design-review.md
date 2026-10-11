# Design review: prototype → critique → fix → hand-off

The flow this server is built for: an agent prototypes in Figma, the
deterministic critique catches what makes a prototype look generated, the
designer finishes by hand, and the result goes to Framer, Webflow or an
AI-to-production tool. This page shows the critique part in Hermes and in
LM Studio's chat, with the prompts, the tool traces to expect and how to read
the report.

## What `critique_design` checks

43 rules, each with a severity. `P` (primary) is something a reader will
notice or that marks the design as AI-made; `A` (advisory) is taste and
hygiene. Full list with meanings: call `list_critique_rules` or read
`skills/figma-mcp/references/critique.md`.

| Group | Rules |
|-------|-------|
| typography | overused-font, flat-type-hierarchy, oversized-h1, extreme-negative-tracking, wide-tracking, tight-leading, line-length, justified-text, tiny-text, heading-rhythm, gradient-text, mixed-fonts-in-text |
| color | low-contrast (WCAG), gray-on-color, ai-color-palette (purple→blue), cream-palette, dark-glow, radial-halo, repeating-stripes-gradient, color-amount |
| composition | nested-cards, monotonous-spacing, edge-flush-cards, icon-tile-stack, hero-eyebrow-chip, numbered-section-labels, text-occlusion, clipped-overflow-container, text-overflow, absolute-in-autolayout, off-grid-spacing, inconsistent-radius, small-tap-target |
| text | em-dash-overuse, marketing-buzzword, aphoristic-cadence, repeated-container-text, lorem-placeholder |
| design-system | design-system-color, design-system-font, design-system-number (hardcoded values while variables/styles exist) |
| figma | unnamed-layers, hidden-layers |

Rule ids follow [Impeccable](https://github.com/pbakaus/impeccable)'s
detector where a counterpart exists; the checks are re-implemented for Figma
nodes. What rules cannot judge (hierarchy, voice, whether the illustration
earns its place) stays with the model and the screenshot; the skill carries
a short rubric for that.

## The report

```
critique: FRAME "Landing" id=12:34 — 3 primary, 4 advisory (43 rules, 412 nodes)
P low-contrast        TEXT "Subtitle" 12:41  #9aa0a6 on #f5f5f5 = 2.6:1 (need 4.5:1)  -> set_fill with a darker/lighter color, or change the background
P nested-cards        FRAME "Card" 12:50  card-like inside card-like "Panel" (12:48), covers 72%  -> flatten: remove the fill/stroke/radius of 12:48 or of this node (set_fill, use_figma)
P text-overflow       TEXT "Headline" 12:36  sticks 140px out of "Hero"  -> layoutSizingHorizontal = 'FILL' + textAutoResize = 'HEIGHT', or resize_node
A monotonous-spacing  FRAME "Landing" 12:34  all gaps/paddings = 16 across 12 containers  -> vary rhythm: tighter inside groups, wider between sections (set_auto_layout)
A marketing-buzzword  TEXT "Tagline" 12:38  “seamless” in “Seamless workflows for…”  -> say what it does: set_text
…
```

Every line names the node to change and the tool to do it with. Parameters:
`node_id` (default: selection), `min_severity: "primary"` for a short list,
`rules: [...]` for a subset, `format: "json"` for programmatic use,
`max_findings`.

## Hermes Agent

Profile `design` or `core` both include `critique_design`. Nothing to
configure beyond the setup in [hermes-local.md](hermes-local.md).

### Example 1 — review and fix an existing frame

```
you:    Review the frame "Pricing" and fix everything the critique marks as primary.

hermes: mcp__gemma_figma__find_nodes {name_pattern: "^Pricing$", type: "FRAME"}
        mcp__gemma_figma__critique_design {node_id: "12:34", min_severity: "primary"}
          → 4 primary: low-contrast ×2, tiny-text, nested-cards
        mcp__gemma_figma__set_fill {node_id: "12:41", color: "#374151"}
        mcp__gemma_figma__set_fill {node_id: "12:44", color: "#374151"}
        mcp__gemma_figma__use_figma  (fontSize 9 → 12 on 12:47)
        mcp__gemma_figma__use_figma  (remove the inner card's fill and radius on 12:50)
        mcp__gemma_figma__critique_design {node_id: "12:34", min_severity: "primary"}
          → 0 primary
        mcp__gemma_figma__get_screenshot {node_ids: ["12:34"]}
        "Fixed 4 primary findings: contrast on two labels, legal text to 12px,
         flattened the nested card. Screenshot attached."
```

### Example 2 — build, then self-review

```
you:    Build a signup screen at 100,100 (360x720): logo, heading, email and
        password fields, a primary button, a link to log in. Then run the
        critique and fix what it flags.

hermes: mcp__gemma_figma__use_figma  (one snippet: createAutoLayout + fields + button)
        mcp__gemma_figma__critique_design {node_id: "15:2"}
          → 1 primary (small-tap-target on the link), 2 advisory
        mcp__gemma_figma__resize_node {node_id: "15:19", width: 120, height: 40}
        mcp__gemma_figma__critique_design {node_id: "15:2", min_severity: "primary"} → 0
        mcp__gemma_figma__get_screenshot {node_ids: ["15:2"]}
```

The skill tells the model to critique once per screen and stop after two
rounds; if it loops, the brief was unclear, not the tool.

### Example 3 — only some rules, as a gate

```
you:    Check the whole page for contrast and text overflow only.

hermes: mcp__gemma_figma__get_current_page
        mcp__gemma_figma__critique_design {node_id: "0:1", rules: ["low-contrast", "gray-on-color", "text-overflow", "text-occlusion"], max_findings: 100}
```

### Example 4 — hand-off after the review

```
you:    The "Pricing" frame is final. Give me its spec and the variables it
        uses so I can rebuild it in Framer.

hermes: mcp__gemma_figma__get_node_spec {node_id: "12:34"}
        mcp__gemma_figma__get_variable_defs {node_id: "12:34"}
        → outline with sizes, auto-layout, hex colors with {variable} names, type
```

Paste the outline into the Framer/Webflow agent, or let the same Hermes
session write the page; `get_node_spec` output is what those steps consume.

### With Impeccable (code stage)

Impeccable installs into Hermes with `npx impeccable install
--providers=hermes --scope=global`. It works on the code, not on Figma, so
the two meet at the hand-off: `critique_design` before the design is final,
`/impeccable audit` / `polish` and `npx impeccable detect` on the generated
code afterwards. Mind the context: Impeccable's command references are
3–62 KB each; use the `core` profile here while an Impeccable command runs,
or load the model with 64k context.

## LM Studio chat

No skills, so put the workflow into the chat's system prompt:

```
You control Figma through the figma MCP tools. Act directly; do not call
bridge_status first. After building or changing a screen, call critique_design
on its root frame, fix every finding marked P with the tool named in the line,
call critique_design once more, then take one screenshot. Use node ids from
the report. Do not run the critique more than twice per screen.
```

Example exchange:

```
user:  Review the selected frame.
model: critique_design {}                      ← selection, all rules
       (report with 2 P and 3 A)
       "Two readability problems and three style notes. Fix them?"
user:  Fix the primary ones.
model: set_fill {node_id: "12:41", color: "#374151"}
       use_figma {code: "...fontSize = 12..."}
       critique_design {min_severity: "primary"}   → 0 primary
       get_screenshot {}
```

LM Studio sends all 90 tools (~12k tokens) each turn; load the model with a
32k context or more. Older builds do not render the screenshot inline; the
PNG path is in the reply.

## Testing the rules without a model

```powershell
npm run smoke:critique          # cliché fixture must fire 26 rules; clean fixture must be silent
npm run eval:live -- --tasks critique-fix --profile design --skill   # a model finds and fixes 3 planted defects
```

The rules are pure functions over a JSON snapshot (`src/critique/rules.ts`),
so new rules can be unit-tested with hand-written snapshots; the smoke script
shows the expected shape.
