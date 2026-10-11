# Workflow 2 — Edit a part of a design (analyse → propose → apply → compare)

Goal: change one region of an existing design without the agent touching
anything else, with a written proposal first and a before/after at the end.

Profile: `core` (+ `critique_design`, already included). Skill loaded.

## 1. Scope the region

Select the region in Figma, or name it. The agent reads it three ways
before saying anything:

```
you:    Analyse the selected "Checkout / Payment" section. Do not change
        anything yet.

agent:  get_selection
        get_node_spec {node_id: "12:34"}          → structure, sizes, type, colors with {variable} names
        get_variable_defs {node_id: "12:34"}      → which tokens it already uses
        critique_design {node_id: "12:34"}        → deterministic findings
        get_screenshot {node_ids: ["12:34"]}      → the judgement pass
```

Everything else on the page stays out of scope; if the agent needs context
(the header, the sibling section) it reads it with `get_node_spec` but does
not edit it.

## 2. Proposal (no edits)

The agent writes a short list, each item with the node id, what changes,
why, and which tool. The skill's rubric (hierarchy, clarity, rhythm, voice,
restraint, states) frames the "why". Example output:

```
Proposed changes to "Checkout / Payment" (12:34):
1. 12:41 "Card number" label: #9AA0A6 on #FFFFFF is 2.6:1 → text/secondary token (set_fill / bind_variable). [critique: low-contrast]
2. 12:52 "Pay now" button: only 32px high, sits flush with the field above → 44px, 16px gap (resize_node, set_auto_layout). [critique: small-tap-target; rubric: hierarchy]
3. 12:60 helper text "Your payment is 100% secure and seamless" → "Encrypted with your bank's 3-D Secure" (set_text). [critique: marketing-buzzword; rubric: voice]
4. 12:48 inner card inside the section card → remove the inner surface, keep spacing (use_figma). [critique: nested-cards]
Not proposed: the section width and the field order (match the rest of the flow).
```

This is the designer's decision point. Approve all, some, or redirect.

## 3. Apply, with a "before" copy

```
you:    Apply 1, 2 and 4. Keep a copy of the original next to it for comparison.

agent:  clone_node {node_id: "12:34"} → rename_node {…, name: "Checkout / Payment — before"} → move_node (to the right)
        set_fill / bind_variable {node_id: "12:41", …}
        resize_node {node_id: "12:52", height: 44} → set_auto_layout {node_id: "12:50", item_spacing: 16}
        use_figma (remove fill/radius on 12:48)
        critique_design {node_id: "12:34", min_severity: "primary"} → 0
        get_screenshot {node_ids: ["12:34", "<before-id>"]}
```

Rules the agent follows here (from the skill): ids from the analysis, no
re-finding; only the approved items; one critique and one screenshot at the
end; the "before" copy is deleted only when the designer says so.

## 4. Variants of a change

When the change is a design question rather than a defect, ask for two
versions of the region instead of one:

```
you:    Propose two treatments for the order summary: one compact (single
        line per item) and one spacious (item rows with thumbnails). Build
        both to the right of the original; do not touch the original.
```

The agent clones the region twice (`clone_node`), applies each treatment,
critiques both, and returns one screenshot with the three side by side.

## Typical asks and their traces

| Ask | Trace |
|-----|-------|
| "Make this section accessible" | `critique_design {rules: ["low-contrast", "gray-on-color", "tiny-text", "small-tap-target"]}` → fixes → re-run |
| "Align this card with the design system" | `get_variable_defs` → `list_variables` → `bind_variable` per hardcoded value → `critique_design {rules: ["design-system-color", "design-system-number", "design-system-font"]}` |
| "Tighten the copy in the hero" | `get_node_spec` → proposal with new strings → `set_text` per node |
| "Swap all secondary buttons here for the ghost variant" | `find_nodes {type: "INSTANCE"}` → `get_instance_properties` → `set_instance_properties {Kind: "Ghost"}` per instance |
| "Why does this feel heavy?" | `get_node_spec` + `critique_design` + screenshot → an answer with node ids, no edits |

## Checklist

- [ ] analysis read spec, variables, critique and screenshot before proposing
- [ ] proposal lists node ids, reason, tool; says what it does not touch
- [ ] designer approved explicitly; only approved items applied
- [ ] "before" copy kept until the designer closes the comparison
- [ ] critique on the region reports 0 primary after the change

## Running it in Hermes

Profile `core` is enough. Three messages:

```
1  Analyse the selected section "Checkout / Payment". Do not change anything;
   give me a numbered proposal with node ids, reason and tool per item, and
   say what you will not touch.
2  Apply 1, 2 and 4. Keep a "before" copy to the right. Critique to 0 primary
   and send one screenshot of both.
3  Delete the "before" copy.
```

Hermes reads spec, variables, critique and the screenshot before proposing
because the skill's workflow says "inspect first". If the proposal comes
back as prose without ids, answer "ids and tools per item" once; the skill
then holds for the session.

## Running it in LM Studio chat

System prompt from the workflows index, plus:

```
For this chat: never change the canvas before I approve a numbered proposal.
Proposals list node id, the change, the reason and the tool for each item.
```

Then:

```
1a Call get_selection, then get_node_spec and critique_design on the
   selected frame, and get_screenshot. Summarise what you see in 5 lines.
1b Propose changes as a numbered list: node id, change, reason, tool.
2a Clone the frame, rename the clone "… — before", move it 1200px to the right.
2b Apply item 1 only.   (one message per item for a 27B model; Gemma 4 31B handles "apply 1, 2 and 4")
2c Run critique_design with min_severity primary on the original frame.
2d Take one screenshot of the original and the "before" copy.
3  Delete the "before" copy.
```

Without a skill the model will sometimes apply before you approve; the
system-prompt line above is what prevents it, so keep it in every chat.
