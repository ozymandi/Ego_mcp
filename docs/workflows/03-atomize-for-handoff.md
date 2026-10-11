# Workflow 3 — Atomize a finished design for hand-off

Goal: a finished screen (or a set of screens) becomes tokens, components
with variants, instances everywhere, clean names, and a spec the frontend
can build from — in code, Framer or Webflow.

Profile: `design`. Skill loaded. Input: the final frames on a "Screens"
page. Output: a "Components" page, a token collection, specs, optional Code
Connect files.

## 1. Inventory

```
you:    Inventory the "Invoices" screen: list every distinct text style
        (family, size, weight, line-height), every distinct color, every
        distinct radius and spacing value, and every repeated structure
        that appears 2+ times. Do not change anything.

agent:  get_node_spec {node_id: screen, max_depth: 12, max_nodes: 2000}
        get_variable_defs {node_id: screen}
        use_figma (inventory snippet below)
```

Inventory snippet (returns counts, not nodes; safe on big screens):

```js
const root = await figma.getNodeByIdAsync('12:34');
const hex = c => '#' + [c.r,c.g,c.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
const type = {}, colors = {}, radii = {}, gaps = {}, sig = {};
const walk = n => {
  if (n.type === 'TEXT' && n.fontName !== figma.mixed) {
    const k = `${n.fontName.family} ${n.fontName.style} ${n.fontSize}/${n.lineHeight.unit === 'AUTO' ? 'auto' : n.lineHeight.value}`;
    type[k] = (type[k] || 0) + 1;
  }
  for (const p of ('fills' in n && n.fills !== figma.mixed ? n.fills : [])) if (p.type === 'SOLID' && p.visible !== false) colors[hex(p.color)] = (colors[hex(p.color)] || 0) + 1;
  if ('cornerRadius' in n && typeof n.cornerRadius === 'number' && n.cornerRadius) radii[n.cornerRadius] = (radii[n.cornerRadius] || 0) + 1;
  if ('layoutMode' in n && n.layoutMode !== 'NONE') { gaps[n.itemSpacing] = (gaps[n.itemSpacing] || 0) + 1; gaps['p' + n.paddingLeft] = (gaps['p' + n.paddingLeft] || 0) + 1; }
  if ('children' in n && n.children.length) {
    // structural signature: child types + layout; equal signatures = component candidates
    const s = n.layoutMode + ':' + n.children.map(c => c.type + (c.type === 'TEXT' ? '' : ':' + ('children' in c ? c.children.length : 0))).join(',');
    (sig[s] = sig[s] || []).push(n.id + ' ' + n.name);
    for (const c of n.children) walk(c);
  }
};
walk(root);
const candidates = Object.entries(sig).filter(([, ids]) => ids.length >= 2).map(([s, ids]) => ({ structure: s, count: ids.length, examples: ids.slice(0, 3) }));
return { type, colors, radii, gaps, candidates };
```

The designer decides what becomes a token and what stays one-off. Typical
cut: colors used 3+ times → variables; everything else → a direct value on
the one node that uses it.

## 2. Tokens

```
you:    Create the "Theme" collection with Light mode from the inventory:
        color/bg, color/surface, color/text/primary, color/text/secondary,
        color/brand, color/border, color/status/paid, color/status/overdue;
        space/4…32; radius/sm, md, lg. Then bind every matching fill, stroke,
        radius and gap on the screen to them.

agent:  create_variable_collection → create_variable ×N
        bind_variable ×M (fill, stroke, cornerRadius, itemSpacing, padding)   ← one call per node and field
        get_variable_defs {node_id: screen} → every binding listed
        critique_design {node_id: screen, rules: ["design-system-color", "design-system-number"]} → 0
```

Binding is many small calls; a 300-node screen is a few minutes. Text
styles: create them with `use_figma` (`figma.createTextStyle()`), apply with
`textStyleId`; `critique_design` rule `design-system-font` confirms.

## 3. Components with variants

From the candidates list, smallest first (atoms → molecules → organisms):

```
you:    Make "Badge/Status" a component set from the four status badges:
        variant property Status=Paid|Sent|Overdue|Draft, label bound to
        text style Label/sm, colors to the status tokens. Replace every badge
        on the screen with an instance set to the right Status.

agent:  create_component {node_id: badge1, name: "Status=Paid"} … ×4
        combine_as_variants {node_ids: […], name: "Badge/Status"}
        create_instance {component_id: set, properties: {Status: "Overdue"}} ×N at the original positions
        delete_nodes (the originals)
        list_components {name_pattern: "^Badge/"} → 1 set, 4 variants
```

Do the same for buttons, inputs, table rows, cards, headers. Naming:
`Family/Name`, variant props `Prop=Value`. Boolean props for optional parts
(`Show icon=true`), text props for labels (`Label#…` keys appear in
`get_instance_properties`). When a design-system library already exists,
prefer `search_design_system` + `create_instance {component_key}` over new
components, then `swap_instance` the local ones.

## 4. Clean-up pass

```
you:    On the "Invoices" screen: rename default-named layers to what they
        are, delete hidden leftovers, make every absolutely positioned child
        either part of the auto-layout or a named overlay, and put all
        spacing on the 4px grid.

agent:  critique_design {node_id: screen, rules: ["unnamed-layers", "hidden-layers", "absolute-in-autolayout", "off-grid-spacing", "inconsistent-radius"]}
        rename_node ×N, delete_nodes, set_auto_layout ×N
        critique_design {node_id: screen} → 0 primary, advisories reviewed
```

## 5. Spec and hand-off package

```
you:    Produce the hand-off for "Invoices": the screen spec, one spec per
        component set, the variable list with Light values, icon SVGs, and a
        2x PNG of the screen. Save specs to the "handoff" workspace.

agent:  get_node_spec {node_id: screen} → write_text_file handoff/invoices.md
        get_node_spec {node_id: set} per component → handoff/components/*.md
        list_variables {collection_id} → handoff/tokens.json
        get_screenshot {node_ids: [screen], scale: 2} → screenshots/… (copy to handoff)
        use_figma (exportAsync SVG on icon components) or get_image {format: "svg"} → handoff/icons/
```

What each target consumes:

| Target | Takes |
|--------|-------|
| React / Vue code | `get_node_spec` outlines (one per component) + `tokens.json` → CSS variables; `generate_code_connect` → `save_code_connect` → `publish_code_connect` links Figma components to the code components |
| Framer | tokens as Framer color/text styles; components rebuilt from the per-component spec; screen spec as layout guide |
| Webflow | tokens as Webflow variables; the spec's auto-layout lines map 1:1 to flex settings (direction, gap, padding, align) |
| AI-to-production (Claude Code, Codex …) | the whole `handoff/` folder in the prompt; `get_screenshot` for visual reference; Impeccable on the generated code |

`get_node_spec` lines carry what a builder needs per layer: position and
size, auto-layout direction/gap/padding/alignment, sizing (hug/fill), fills
and strokes as hex with `{variable}` names, radius, effects, typography,
instance component + properties.

## Acceptance

- [ ] every color/spacing/radius on the screen is bound to a variable or is a documented one-off (`critique_design` design-system rules silent)
- [ ] every repeated structure is an instance; `list_components` shows the families with variants
- [ ] no default layer names, no hidden layers, no off-grid spacing
- [ ] `critique_design` on the screen: 0 primary
- [ ] `handoff/` has the screen spec, component specs, tokens, icons, 2x PNG
- [ ] optional: Code Connect files published for the code targets

## Gaps and workarounds

- **Repeated-structure detection** is the snippet above, not a tool yet; if
  it proves useful, it becomes `find_repeated_patterns`.
- **Moving nodes between pages** is `use_figma` (clone to target page,
  remove the original); `move_node` is same-page only.
- **Text styles** have no structured tool yet (`use_figma`:
  `figma.createTextStyle()`, `node.textStyleId = style.id`).
