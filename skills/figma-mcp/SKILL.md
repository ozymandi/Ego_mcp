---
name: figma-mcp
description: Read and edit Figma files through the gemma-figma-mcp server (REST tools + a live-canvas plugin bridge). Use for any Figma task — inspect a file or page, create or edit frames, text, shapes and auto-layout, take screenshots, run Plugin API JavaScript with use_figma, draw flowcharts, add FigJam stickies, or work with Code Connect.
version: 0.1.0
metadata:
  hermes:
    tags: [figma, design, mcp, canvas]
    category: design
    requires_toolsets: [mcp-figma]
---

# Figma via gemma-figma-mcp

Tool names below are bare (`get_screenshot`). Your client may prefix them (`mcp_figma_get_screenshot` in Hermes, `mcp__figma__get_screenshot` in Claude Code).

## 1. Before you start

1. **Act directly.** When the user asks for something concrete ("create a frame", "move node 12:34", "what is selected"), call that tool right away. Do not check connectivity first: every canvas tool reports a clear error if the daemon or plugin is missing.
2. Call `bridge_status` only **once at the start of a session**, when the user asks whether Figma is connected, or **after a canvas tool fails** with "not reachable" / "not connected". It reports the open file, editor type, current page and plugin build.
3. Canvas tools act on **the file and page currently open in Figma desktop**, not on a `file_key`. REST tools take `file_key` or a full Figma URL and work without the plugin (`get_metadata`, `get_node`, `get_components`, `get_styles`, `get_image`, comments, libraries, Code Connect scan).
4. If the plugin is disconnected, tell the user to open Plugins → Development → Gemma 4 MCP Bridge and press Reconnect. Do not retry in a loop.

## 2. Workflow

1. **Inspect first.** `get_current_page` for page + selection, `find_nodes` (regex on name, optional type) to locate things, `get_screenshot` to see them. Never create on top of unknown content.
2. **Prefer structured tools** (`create_frame`, `create_text`, `set_fill`, `set_auto_layout`, `create_instance`, `insert_icon`, `bind_variable`, …) over `use_figma`. They validate inputs and load fonts for you. Use `use_figma` only when no structured tool covers the need (constraints, effects, bulk edits, unusual node types).
2a. **Icons are never drawn from lines or text.** Use `insert_icon` (Lucide) or `create_from_svg`. If a design system has icon components, `create_instance` them instead.
2b. **Reuse the design system.** Before building a button, card, input or nav from scratch, check `list_components` (this file) or `search_design_system` (team library) and place `create_instance`; set its `properties`.
3. **Build top-down.** Create the container frame, then children with `parent_id`. Apply `set_auto_layout` on the container **before** adding many children when the layout is a stack or row.
4. **Verify once per batch.** After a group of related writes, take **one** `get_screenshot` of the container. Do not screenshot after every call, and do not repeat a screenshot when nothing changed.
5. **Fix, don't rebuild.** If the screenshot shows a problem, change the specific node (`move_node`, `resize_node`, `set_text`) rather than deleting and recreating.
6. **Keep ids.** Every write returns `{ id, name, type }`. Reuse those ids for later calls; do not guess ids and do not re-find by name if you already have the id.
7. **Stop when done.** Report what was created with node ids and one final screenshot path.

## 3. Tool map by task

| Task | Tools |
|------|-------|
| What is open / selected | `get_current_page`, `get_selection`, `bridge_status` |
| Find nodes on the page | `find_nodes(name_pattern?, type?, limit?)` |
| See it | `get_screenshot(node_ids?, format?, scale?)` — omit `node_ids` for the selection |
| Create | `create_frame`, `create_rectangle`, `create_ellipse`, `create_text`, `create_line`, `clone_node` |
| Edit | `move_node`, `resize_node`, `set_fill`, `set_stroke`, `set_text`, `rename_node`, `set_auto_layout`, `group_nodes`, `delete_nodes`, `set_selection` |
| Understand a design before coding or editing it | `get_node_spec(node_id?)` — one line per layer: layout, sizing, fills with `{variable}` names, typography, instances + props |
| Pages | `list_pages`, `set_current_page(page_id \| name)`, `zoom_to(node_ids)` |
| Design-system components | `list_components(scope?)`, `create_instance(component_key \| component_id, x, y, properties?)`, `get_instance_properties`, `set_instance_properties`, `swap_instance`, `create_component`, `combine_as_variants`, `detach_instance` |
| Variables / tokens (any plan) | `list_variable_collections`, `list_variables`, `create_variable_collection(name, modes)`, `create_variable`, `set_variable_value`, `bind_variable(node_id, field, variable_id)`, `get_variable_defs(node_id)` |
| Icons and vectors | `search_icons(query)` → `insert_icon(name, x, y, size, color)` (Lucide, 2000+ icons); `create_from_svg(svg, x, y)` |
| Anything else on canvas | `use_figma(code)` — see §4 and `references/snippets.md` |
| Read a file without the plugin | `get_metadata` → `get_node(node_ids)`; `get_file` only with `depth` |
| Export images | `get_screenshot` (plugin, saved to disk + inline) or `get_image` (REST, URLs) |
| Images from disk onto canvas | `list_workspaces` → `import_image_to_figma(workspace, path, x, y)` |
| Diagrams | `create_flowchart(nodes, edges)`, `mermaid_to_canvas(mermaid)` |
| FigJam | `create_sticky`, `create_connector` |
| Design system | `index_design_system(team_id)` once, then `search_design_system(query)` |
| Code Connect | `scan_code_connect(dir)`, `find_node_mapping`, `generate_code_connect`, `save_code_connect` |

Full parameter list: `references/tools.md`.

## 4. Rules for `use_figma`

The snippet is the body of an async function. `figma`, `selection`, `currentPage` are in scope. Only the value you `return` comes back; `console.log` is lost. The response is `{ result, created_ids?, changed_ids?, deleted_ids? }` — ids are collected for you (best effort), and `screenshot: true` adds a PNG of what you created.

**Helpers in scope** (plain functions, use them instead of the verbose API):

| Helper | Does |
|--------|------|
| `createAutoLayout('VERTICAL' \| 'HORIZONTAL', props?)` | frame with auto-layout on, hugging both axes; `props` go through `set` |
| `set(node, { name, width, height, fill: '#hex', stroke: '#hex', padding: 16, itemSpacing: 8, cornerRadius: 8, ... })` | assigns many properties at once; `width`/`height` use `resize()`; `layoutMode` applied first |
| `query(figma.currentPage, 'FRAME[name^=Card] > TEXT')` | CSS-like search under a node: type, `[name=…]`, `[name*=…]`, `[name^=…]`, `[name$=…]`, `[visible=false]`, `#id`, `*`, descendant, `>`, `,`. For a known id use `await figma.getNodeByIdAsync('12:34')` instead |
| `await loadFontsFor(node)` | loads every font used in a text node or subtree before you edit it |
| `hex('#0d99ff')` → `{r,g,b}`; `solid('#0d99ff80')` → SOLID paint with opacity | colors without 0–1 arithmetic |

On an error the response carries `Hint:` and `safe_to_retry:`. `true` means fix the snippet and resend. `false` means re-read the canvas first.

1. **`return` a small object** with the ids you created or changed: `return { created: [f.id], changed: [t.id] }`. Returning a node returns only its summary.
2. **Colors are 0–1**, never 0–255. Paint `color` is `{r, g, b}` only; opacity goes on the paint: `{ type: 'SOLID', color: {r:0.05,g:0.6,b:0.95}, opacity: 0.5 }`.
3. **Fills and strokes are read-only arrays**: build a new array and assign it. Never `node.fills[0].color = …`.
4. **Load the font before touching text**: `await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })` before `characters`, `fontSize`, `fontName`. For existing text, load its current font: `await figma.loadFontAsync(node.fontName)`. Style names are exact (`'Semi Bold'`, not `'SemiBold'`); check with `figma.listAvailableFontsAsync()` if unsure.
5. **`await` every async call**: `getNodeByIdAsync`, `loadFontAsync`, `setCurrentPageAsync`, `importComponentByKeyAsync`, variables APIs.
6. **Pages**: switch with `await figma.setCurrentPageAsync(page)`. Assigning `figma.currentPage = page` throws. Switch at most once per call.
7. **Auto-layout order**: create frame → `layoutMode = 'VERTICAL' | 'HORIZONTAL'` → `appendChild(child)` → only then `child.layoutSizingHorizontal = 'FILL' | 'HUG' | 'FIXED'`. `HUG`/`FILL` fail on nodes that are not yet inside an auto-layout parent. `resize()` resets sizing to FIXED, so resize before setting `layoutSizing*`.
8. **Wrapping text**: `textAutoResize = 'HEIGHT'` plus `resize(width, 1)`; `WIDTH_AND_HEIGHT` (default) ignores FILL.
9. **Place page-level nodes away from (0,0)**; nodes inside a parent are positioned by the parent.
10. **Type-check before type-specific properties**: `if (n.type === 'TEXT')` or `'characters' in n`. Optional chaining does not help.
11. **Never call `figma.closePlugin()`, `figma.notify()`, or `figma.ui.*`** inside a snippet.
12. **No `while(true)`, no sleeping.** Snippets have a 30 s timeout (`timeout_ms` up to 120 s).

Worked examples: `references/snippets.md`. Wrong/right pairs: `references/gotchas.md`.

## 5. Error recovery

| Error contains | Cause | Fix |
|----------------|-------|-----|
| `Bridge daemon not reachable` | daemon not running | ask the user to run `start-bridge.bat` or `npm run bridge` |
| `Figma plugin not connected` / `disconnected before response` | plugin window closed | ask the user to reopen the plugin and press Reconnect |
| `Node not found` / `does not exist` | wrong id, other page, node was deleted | `find_nodes` again; do not reuse ids from a failed call |
| `unloaded font` | text edited without `loadFontAsync` | load the font (rule 4) and retry |
| `layoutSizing` / `must be an auto-layout frame` | HUG/FILL before parenting | append to an auto-layout parent first (rule 7) |
| `Expected 'FIXED' \| 'AUTO'` | mixed up `primaryAxisSizingMode` (frame) with `layoutSizing*` (child) | use `'AUTO'`/`'FIXED'` on the frame |
| `Property value out of range` | color channel > 1 | divide by 255 |
| `timed out` | snippet too big or looping | split the work; check for unresolved promises |
| `Figma API error 403` | token lacks scope, or Variables REST on a non-Enterprise plan | use plugin-side `use_figma` with `figma.variables.*` instead |

If the same error happens twice, stop and report it to the user instead of retrying a third time.
