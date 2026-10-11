# Workflow 4 — build from a reference

The composition already exists: a screenshot of a site you like, a page the
designer built by hand, a photo of a whiteboard sketch. The agent describes
it as a structural spec, you correct the spec in words, the agent builds the
screen from the spec with this file's tokens and components, then compares
its build with the reference.

This is the workflow for local models. In
[workflow 1](01-create-from-scratch.md) the judgement has to come from the
model and a 27B model has none to give (see the
[live run](examples/hermes-step-by-step.md#10-what-the-live-run-showed));
here the judgement is in the image, and the model only has to read and
execute. Qwen3.8 and Gemma 4 are multimodal, so the image goes straight to
them.

## Inputs

- **One reference image per screen.** PNG or JPG, longest side at most
  2000 px, one screen per image. A collage or a full-page capture of three
  screens produces a merged spec. Crop first.
- **The system already in the file**: a variables collection, text styles,
  the atoms and organisms (workflow 1 steps 1–2, or an existing library).
  Without them the model copies the reference's colors and fonts.
- **Target width** (1440, 1200, 390) and the page to build on.

## 1. Put the reference on the canvas

```
Import <workspace>/refs/home-ref.png onto the page "WIP / Refs" at 0,0 and
tell me its node id and size.
```

Expected: `list_workspaces` → `import_image_to_figma` → one id. Why on the
canvas and not only in the chat: the agent can later `get_screenshot` the
reference and the build in one call and compare them, and you see both side
by side in Figma.

## 2. Describe, do not build

```
Describe the reference <ref id> as a build spec. No tool calls except a
screenshot of it. Numbered list, top to bottom:
- for each section: name, height as a fraction of the viewport, columns,
  the elements inside and their order;
- proportions as fractions of the width (hero text 2/3, image 1/3);
- the type scale relative to the body size (display = 6x, h2 = 2.5x);
- the spacing rhythm (section gap, element gap, one number each);
- how many colors are used and where the accent goes;
- what is deliberately empty.
Do not describe colors, fonts or copy beyond that; we use our own.
```

Expected: a list, nothing on the canvas. Read it against the image and
correct in plain words:

```
Section 2: the cards are 3 per row, not 2, and they have no border.
Section 4 is 100vh, not half. Hero headline sits on the baseline of the
section, not centered. Keep everything else. Reprint the spec.
```

This step is where the half day of the live run went missing: a model
that builds without a spec invents proportions and the corrections come
one per turn afterwards. Two rounds on the spec cost two turns.

## 3. Map the spec to the system

```
For every element in the spec name the component, text style or variable
from this file that will be used (list_components, list_variables, the text
styles). List what is missing.
```

Expected: `list_components` → `list_variables` → a table. Add what is
missing yourself or let it create the atom (workflow 1 step 2), then
continue.

## 4. Build from the spec

```
Build "Page/Home" at 1440 wide on the page "Site" at 0,0 from the approved
spec, with the mapping above. Layout from the reference; colors, type and
copy from our system. Vertical auto-layout, every section fills the width.
One screenshot at the end, then stop.
```

Expected: `set_current_page` → `create_frame` → `set_auto_layout` → per
section `create_frame` + `create_instance` / `create_text` / `insert_icon`,
or one `use_figma` snippet per section → `get_screenshot`. On a 27B model
expect one call per turn; a seven-section page is 25–40 turns. If a
section comes out wrong, fix that section by id (workflow 2), do not
rebuild the page.

## 5. Compare and correct

```
Screenshot <ref id> and <page id> together. List the five largest
differences in composition: section heights, column counts, the size of
the headline relative to the width, alignment, empty space. Ignore colors,
fonts and copy. Fix the ones that are layout; then critique_design on
<page id>, fix primaries, one screenshot.
```

Expected: `get_screenshot(node_ids:[ref, page])` → a short list → `resize_node` /
`move_node` / `set_auto_layout` / `use_figma` per item → `critique_design` →
fixes → `critique_design` → `get_screenshot`.

Done when the proportions match the reference by eye, `critique_design`
reports 0 primary, and the designer picks it up for the manual finish.

## Replicating your own page

The strongest reference is a page the designer made by hand in the same
file. Then the spec step is shorter ("same nav, footer, grid and type scale
as Page/Home <id>; the middle sections are: …") and the agent builds Work,
Services, About from it with the same components. For mobile, give the
desktop build as the reference plus a per-breakpoint type scale in the
message: "display 56, h2 32, body 16 at 390 wide". Without that line the
model keeps the desktop display size and a headline wraps into nine lines.

Two details that save rework on a mobile replica: clone the desktop
instances (`clone()` keeps every text override; re-instancing means
re-typing them), and match buttons by main component, not by label, so the
mobile CTA uses the same variant as the desktop one.

## Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| the build uses the reference's colors or font | the spec step was skipped or the message did not say "our system" | step 2, and "layout from the reference, colors and type from our system" in the build message |
| two screens merged into one page | collage or long capture | one image per screen |
| sizes invented, sections missing | built without an approved spec | step 2 and 3 before step 4 |
| the page is rebuilt on each correction | correction message without ids | "change only section <id>", workflow 2 |
| the model describes the image in prose with no numbers | spec request too loose | ask for fractions and multiples, as in step 2 |
| the headline fills the mobile screen | desktop type scale reused | per-breakpoint type scale in the message |

## Running it in Hermes

Profile `design` (needs `import_image_to_figma`, `list_components`,
`list_variables`). Attach the image to message 2 or point at the imported
node; both reach the model. Five messages, one per step above:

```
1  Import refs/home-ref.png from the "project" workspace onto "WIP / Refs"
   at 0,0; give me the id.
2  Describe <ref id> as a build spec: numbered, sections top to bottom with
   height fractions, columns, elements; proportions as fractions of the
   width; type scale as multiples of body; spacing rhythm; where the accent
   goes; what stays empty. No colors, fonts or copy. Do not build.
   → corrections in plain words, "reprint the spec"
3  Map every element of the spec to our components, text styles and
   variables; list what is missing.
4  Build Page/Home at 1440 on "Site" at 0,0 from the spec and the mapping.
   Layout from the reference, colors/type/copy from our system. One
   screenshot at the end.
5  Screenshot <ref id> and <page id> together, list the five largest layout
   differences, fix the layout ones, critique_design to 0 primary, one
   screenshot.
```

Expected tool traces: 1 `mcp__gemma_figma__import_image_to_figma`; 2 one
`mcp__gemma_figma__get_screenshot` at most; 3 `mcp__gemma_figma__list_components`,
`mcp__gemma_figma__list_variables`; 4 `set_current_page`, `create_frame`,
`set_auto_layout`, then `create_instance` / `create_text` / `use_figma` per
section, `get_screenshot` once; 5 `get_screenshot` with two ids, a few
edits, `critique_design` twice, `get_screenshot`.

If step 4 starts with `delete_nodes` or a second `create_frame` named like
the page, stop it and answer "edit <page id>, do not rebuild". Start a new
session per page: the spec and the mapping fit in the first message, and
the session stays under the compaction threshold.

## Running it in LM Studio chat

System prompt from the [workflows index](README.md), plus:

```
For this chat: a reference image means describe first. Return a numbered
structural spec with fractions and multiples and wait for my corrections
before any create_* call. Use layout from the reference and colors, text
styles and components from this file.
```

Attach the image to the message that asks for the spec (LM Studio sends it
to multimodal models). Then the same five steps, one tool per message for a
27B model:

```
1  Call list_workspaces, then import_image_to_figma for refs/home-ref.png at 0,0.
2  Describe the attached image as a build spec (format as above). Do not build.
   → corrections, "reprint the spec"
3a Call list_components.   3b Call list_variables.   3c Map the spec to them.
4a Create the frame Page/Home 1440 wide at 0,0 with vertical auto-layout.
4b Build section 1 of the spec inside it.   (one section per message)
4c …
5a Call get_screenshot with the reference id and the page id.
5b List the five largest layout differences and fix the first.  (one per message)
5c Call critique_design on the page; fix the primaries; critique again; screenshot.
```

Without a skill the model will try to build in step 2; the system-prompt
line is what holds it, so keep it in every chat.
