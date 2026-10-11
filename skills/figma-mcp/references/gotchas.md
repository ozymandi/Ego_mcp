# `use_figma` gotchas — wrong vs. right

Each pair shows the mistake models make most often and the version that works in this server's plugin sandbox.

## Colors

```js
// WRONG — 0–255 and alpha inside color
r.fills = [{ type: 'SOLID', color: { r: 13, g: 153, b: 255, a: 0.5 } }];

// RIGHT — 0–1, opacity on the paint
r.fills = [{ type: 'SOLID', color: { r: 13/255, g: 153/255, b: 1 }, opacity: 0.5 }];
```

## Fills are read-only arrays

```js
// WRONG — mutating in place is silently ignored
node.fills[0].color = { r: 1, g: 0, b: 0 };

// RIGHT — clone, modify, reassign
const fills = JSON.parse(JSON.stringify(node.fills));
fills[0].color = { r: 1, g: 0, b: 0 };
node.fills = fills;
```

## Text needs its font loaded

```js
// WRONG
const t = figma.createText();
t.characters = 'Hello';           // throws: unloaded font

// RIGHT — new text
const t = figma.createText();
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
t.characters = 'Hello';
t.fontSize = 16;

// RIGHT — existing text (load what it already uses)
const node = await figma.getNodeByIdAsync('12:34');
if (node.type === 'TEXT') {
  await figma.loadFontAsync(node.fontName);
  node.characters = 'New copy';
}
```

Mixed-font text has `fontName === figma.mixed`; then load every segment:

```js
for (const seg of node.getStyledTextSegments(['fontName'])) {
  await figma.loadFontAsync(seg.fontName);
}
```

Font style strings are exact. `'Semi Bold'` and `'SemiBold'` are different fonts; when unsure:

```js
const fonts = await figma.listAvailableFontsAsync();
return fonts.filter(f => f.fontName.family === 'Inter').map(f => f.fontName.style);
```

## Auto-layout: parent first, sizing second

```js
// WRONG — FILL before the node has an auto-layout parent
const child = figma.createRectangle();
child.layoutSizingHorizontal = 'FILL';   // throws
frame.appendChild(child);

// RIGHT
const frame = figma.createFrame();
frame.layoutMode = 'VERTICAL';
frame.primaryAxisSizingMode = 'AUTO';    // frame hugs content vertically
frame.counterAxisSizingMode = 'FIXED';
frame.resize(320, 100);
frame.itemSpacing = 12;
frame.paddingTop = frame.paddingBottom = frame.paddingLeft = frame.paddingRight = 16;
figma.currentPage.appendChild(frame);

const child = figma.createRectangle();
child.resize(100, 40);                   // resize BEFORE layoutSizing*
frame.appendChild(child);
child.layoutSizingHorizontal = 'FILL';   // now valid
child.layoutSizingVertical = 'FIXED';
```

Two different enums, do not cross them:

| Set on | Property | Values |
|--------|----------|--------|
| the auto-layout **frame** | `primaryAxisSizingMode`, `counterAxisSizingMode` | `'FIXED'`, `'AUTO'` |
| a **child** of an auto-layout frame | `layoutSizingHorizontal`, `layoutSizingVertical` | `'FIXED'`, `'HUG'`, `'FILL'` |

## Wrapping text

```js
// WRONG — FILL on a text node in default WIDTH_AND_HEIGHT mode collapses it
t.layoutSizingHorizontal = 'FILL';

// RIGHT
t.textAutoResize = 'HEIGHT';
t.resize(280, 1);                        // fixed width, height follows
frame.appendChild(t);
```

## Pages

```js
// WRONG
figma.currentPage = page;                // throws

// RIGHT — at most once per snippet
const page = figma.root.children.find(p => p.name === 'Components');
await figma.setCurrentPageAsync(page);
```

## Node lookup

```js
// WRONG — sync API is unavailable with dynamic-page access
const n = figma.getNodeById('12:34');

// RIGHT
const n = await figma.getNodeByIdAsync('12:34');
if (!n) throw new Error('not found');
```

## Type narrowing

```js
// WRONG — crashes on non-text nodes
return selection.map(n => n.characters);

// RIGHT
return selection
  .filter(n => n.type === 'TEXT')
  .map(n => ({ id: n.id, text: n.characters }));
```

## Fast search

```js
// SLOW — walks everything with a callback
const texts = figma.currentPage.findAll(n => n.type === 'TEXT');

// FAST — indexed lookup by type
const texts = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });
```

## Returning results

```js
// WRONG — nothing comes back, console is not forwarded
console.log(frame.id);

// WRONG — whole node graphs are huge and get summarized anyway
return frame;

// RIGHT
return { created: [frame.id, title.id], width: frame.width };
```

## Instances from a library component

```js
// needs the component KEY (from get_components / search_design_system), not a node id
const comp = await figma.importComponentByKeyAsync('abc123…');
const inst = comp.createInstance();
inst.x = 100; inst.y = 100;
figma.currentPage.appendChild(inst);
return { created: [inst.id] };
```

## Helpers: functions, not methods

This server provides `query`, `set`, `createAutoLayout`, `loadFontsFor`, `hex`, `solid` as **plain functions** in the snippet scope. Figma's own MCP exposes similar names as node methods; those forms do not exist here.

```js
// WRONG — method forms from Figma's hosted MCP
frame.query('TEXT');
frame.set({ opacity: 0.5 });
figma.createAutoLayout('VERTICAL');
await frame.screenshot();

// RIGHT — function forms in this server
query(frame, 'TEXT');
set(frame, { opacity: 0.5 });
createAutoLayout('VERTICAL');
// screenshots: pass screenshot: true to use_figma, or call the get_screenshot tool
```

## One call, many items

Clients such as Hermes allow one MCP tool call per turn. Thirteen variables as thirteen `create_variable` calls is thirteen turns; use `create_variables` with the list, and `bind_variables` for a component's bindings. Do not fall back to raw `figma.variables` JavaScript for this — the argument order (`createVariable(name, collection, type)`) is the most common failure in logs.

## Things that do not exist in this sandbox

- `figma.notify`, `figma.closePlugin`, `figma.ui.*`, `figma.showUI` — not for snippets.
- `node.query`, `node.set`, `node.screenshot()`, `node.placeholder` — see above.
- `require`, `import`, `fetch` to arbitrary hosts, `setTimeout` loops.
