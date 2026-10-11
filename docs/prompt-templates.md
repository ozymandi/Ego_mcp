# Prompt templates for the agent

How to phrase a request so a local model (Qwen3.8 27B, Gemma 4 31B through
Hermes) does the right thing on the first try. Hosted models tolerate loose
prompts; a 27B model builds exactly what the message says and invents the
rest, and every correction afterwards costs a 15–20 s turn. The templates
below are in English because the models follow English tool instructions
more reliably; the designer's notes around them can be in any language.

Workflows these belong to: [docs/workflows/](workflows/README.md).
Verdict from the live run that motivated this page:
[hermes-step-by-step.md §10](workflows/examples/hermes-step-by-step.md#10-what-the-live-run-showed).

## 1. The shape of every canvas message

| Part | What it carries | Example |
|------|-----------------|---------|
| **Target** | root node id and page; never only a name | `Page/Home-mobile (3:758) on "Site"` |
| **Scope** | what may change and what must stay | `change only the FOOTER (3:830); keep everything else as is` |
| **Spec** | numbers and names: width, sizes, gaps, components, tokens, text styles | `390 wide, gap space/24, Nav/Link instances, Display/M 56` |
| **Verification** | how to check, how many times | `critique_design to 0 primary, then one screenshot` |
| **Reply** | the format of the answer | `reply with node ids only` |

A message missing the target gets built on whatever page is current.
A message missing the scope gets a rebuild instead of an edit. A message
missing numbers gets the model's defaults (desktop type on mobile, 2 cards
instead of 3). The verification line stops the screenshot-after-every-call
loop. The reply line stops tables and questions.

### Loose vs. precise

| Loose (what happened) | Precise |
|-----------------------|---------|
| `finish the mobile pages` | `Keep Page/Home-mobile (3:758). Build Work, Services, About, Contact mobile pages on "Site" below it, 390 wide, from their desktop pages (3:259, 3:471, 3:583, 3:692). Type scale: display 56, h2 32, body 16. Same components and tokens. Critique each to 0 primary, one screenshot per page, reply with ids.` |
| `make it brutalist` | a reference screenshot + [workflow 04](workflows/04-build-from-reference.md) step 2 |
| `fix the footer` | `In 3:758, replace the five plain text links in FOOTER (3:830) with Nav/Link instances (set 1:108, default variant, same labels), vertical auto-layout, gap space/8. Delete the old text nodes. Nothing else changes.` |
| `create the tokens` | `Create collection "Brutal" with one mode "Default" and these variables in one create_variables call: color/blue #0000FF, color/white #FFFFFF, color/lime #CCFF00, color/black #000000, space/8 8, space/16 16, … radius/0 0. Reply with the collection id and the variable ids.` |

## 2. Templates

Replace `<…>`. One message per block; wait for the final reply before the
next one.

### A. Session opener (once per session)

```
Work with the figma-mcp skill. File "<name>" is open in Figma, page "<page>"
is current. Ids I will refer to: <id: what it is>, <id: what it is>.
Do not rebuild existing frames; edit them by id. One screenshot per step,
at the end of the step. Reply with node ids, no tables, no questions
unless something is missing.
```

Repeat the id list after a context compaction notice.

### B. Build a page from a reference (workflow 04)

Step 1, describe:

```
Describe <ref id> as a build spec. No tool calls except one screenshot of
it. Numbered list, top to bottom: for each section its name, height as a
fraction of the viewport, columns, elements in order; proportions as
fractions of the width; type scale as multiples of body; spacing rhythm;
where the accent color goes; what stays empty. No colors, fonts or copy.
Do not build.
```

Step 2, build (after corrections to the spec):

```
Build "Page/<Name>" <width> wide on page "<page>" at <x>,<y> from the
approved spec. Layout from the reference; colors, text styles, components
and copy from our system (<collection>, <text styles>, <component sets with
ids>). Vertical auto-layout, sections fill the width. One screenshot at the
end, then stop. Reply with the page id and the section ids.
```

### C. Replicate a page to other pages

```
Use Page/<Name> (<id>) as the reference for Page/<Other>: same nav
(<Nav/Bar id>), footer (<Footer id>), grid, spacing and type scale. Middle
sections, top to bottom: <1: … >, <2: … >, <3: … >. Same components and
tokens. Place it at <x>,<y> on "<page>". Critique to 0 primary, one
screenshot, reply with ids.
```

### D. Mobile version of a desktop page

```
Build Page/<Name>-mobile at <x>,<y> on "<page>", 390 wide, from
Page/<Name> (<desktop id>): same content and order, single column.
Type scale for 390: display 56, h2 32, body 16, label 12. Content width
342 (padding space/24). Buttons stack full width. Reuse the desktop
instances by cloning them (keeps text overrides) and resize to 342; keep
the same variants as on desktop. Critique to 0 primary, one screenshot,
reply with ids.
```

### E. Fix one section (workflow 02)

```
In <root id>, change only <section id> (<section name>): <what>. Keep its
siblings and the page size as they are. Do not rebuild the page. One
screenshot of <section id> at the end; reply with the ids you changed.
```

With a proposal first:

```
Analyse <section id>. Do not change anything. Numbered proposal: node id,
change, reason, tool. Say what you will not touch.
```

then `Apply 1, 2 and 4.`

### F. Tokens

```
Create a variable collection "<name>" with mode "<mode>" and these
variables in one create_variables call:
color/<n> #<hex>, … ; space/<n> <px>, … ; radius/<n> <px>, … ;
border/<n> <px>.
Then bind_variables: <node id> fill → color/<n>, <node id> padding →
space/<n>, … (one call). Reply with the collection id and a line per
variable: name → id.
```

### G. A component family (one page per family)

```
On page "Components / <Family>" (create it if missing, switch to it) build
the <Family> components: one COMPONENT per variant, named exactly
"<Prop>=<Value>, <Prop>=<Value>": <list of variants with their differences>.
Size <w>x<h> (or hug), padding <…>, gap <…>, text style <…>, fills and
strokes bound to <variables>. When all variants exist, combine_as_variants
into the set "<Family>". Reply with the set id and one id per variant.
```

### H. An organism from atoms

```
On page "Components / Organisms" build the component "<Name>", <width>
wide, <layout>: <children in order, each as an instance of <set id>
variant <…> or a text with style <…>>. Gap <…>, padding <…>. Instances,
not copies. Reply with the component id and its direct children ids.
```

### I. Critique and fix

```
critique_design on <root id>. Fix every primary with the tool named in
the finding; leave advisories unless they are about <…>. Run the critique
once more, then one screenshot. Reply with the fixed node ids and the
remaining advisory count.
```

### J. Hand-off package (workflow 03)

```
For <root id>: write the spec (get_node_spec), the variables
(list_variables) and the text styles to the workspace "<ws>" as
spec.md, tokens.json, text-styles.md; export <root id> as PNG at 2x.
Reply with the file paths.
```

### K. One-line corrections (send as soon as you see the drift)

| You see | Send |
|---------|------|
| `delete_nodes` or a second `create_frame` named like the page | `Edit <id>, do not rebuild.` |
| a proposal in prose without ids | `Ids and tools per item.` |
| reference colors or fonts in the build | `Layout from the reference only; colors and type from our system.` |
| a screenshot after every call | `One screenshot at the end of the step.` |
| desktop type on mobile | `Mobile type scale: display 56, h2 32, body 16.` |
| plain frames where an organism exists | `Use instances of <set id>.` |
| plain text where Nav/Link exists | `Nav/Link instances (1:108), not text.` |
| `bridge_status` before every action | `Act directly; do not check the bridge first.` |
| the same error twice | `Stop and tell me the error.` |
| building on the wrong page | `Page "<name>" (<id>) only; move <id> there.` |

## 3. Hermes vs. LM Studio chat

**Hermes** loads `figma-mcp` when the task mentions Figma, so the templates
above go in as they are. One MCP call per turn: a template that lists ten
items is ten turns; that is expected, do not split it further.

**LM Studio chat** has no skill. Paste the system prompt from
[workflows/README.md](workflows/README.md#hermes-vs-lm-studio-chat) once per
chat, then use the same templates one tool per message for a 27B model
("Call list_components." / "Now create the frame …"). Gemma 4 31B handles
two or three tools per message.

## 4. What not to put in a prompt

- Style adjectives without a reference ("brutalist", "clean", "modern"):
  a local model turns each into one element. Give an image.
- "Make it better" or "finish": no scope, no target.
- Names only ("the hero", "the footer"): names repeat across pages; ids do not.
- Several unrelated tasks in one message: the model does the first and
  summarises the rest.
- Reminders of the skill rules in every message: once per session is
  enough; the skill is in context.
