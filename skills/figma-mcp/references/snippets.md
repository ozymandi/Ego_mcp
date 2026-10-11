# `use_figma` snippets

Paste as the `code` argument. Each snippet is a complete async function body: `figma`, `selection`, `currentPage` are in scope; `return` sends data back. Replace ids and names as needed.

## 1. Inspect the page compactly

```js
const kids = figma.currentPage.children.map(n => ({
  id: n.id, name: n.name, type: n.type,
  x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width), h: Math.round(n.height),
}));
return { page: figma.currentPage.name, count: kids.length, nodes: kids.slice(0, 50) };
```

## 2. Outline of one frame (structure + texts)

```js
const root = await figma.getNodeByIdAsync('12:34');
if (!root) throw new Error('not found');
const out = [];
const walk = (n, depth) => {
  if (out.length > 200) return;
  const row = { d: depth, id: n.id, type: n.type, name: n.name };
  if (n.type === 'TEXT') row.text = n.characters.slice(0, 80);
  if ('layoutMode' in n && n.layoutMode !== 'NONE') row.layout = n.layoutMode;
  out.push(row);
  if ('children' in n) for (const c of n.children) walk(c, depth + 1);
};
walk(root, 0);
return out;
```

## 3. Find a clear spot on the page

```js
let maxX = 0;
for (const n of figma.currentPage.children) maxX = Math.max(maxX, n.x + n.width);
return { x: Math.round(maxX + 100), y: 0 };
```

## 4a. Card with the helpers (shortest form)

```js
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

const card = createAutoLayout('VERTICAL', {
  name: 'Card', itemSpacing: 8, padding: 16, cornerRadius: 12,
  fill: '#ffffff', stroke: '#e5e7eb', counterAxisSizingMode: 'FIXED', width: 320,
});
card.x = 100; card.y = 100;
figma.currentPage.appendChild(card);

const title = figma.createText();
title.fontName = { family: 'Inter', style: 'Bold' };
title.characters = 'Card title';
set(title, { fontSize: 18, fills: [solid('#111111')] });
card.appendChild(title);
title.layoutSizingHorizontal = 'FILL';

const body = figma.createText();
body.characters = 'Supporting copy that wraps.';
set(body, { fontSize: 14, fills: [solid('#666a73')], textAutoResize: 'HEIGHT' });
card.appendChild(body);
body.layoutSizingHorizontal = 'FILL';

return { card: card.id };   // created_ids are added automatically
```

## 4b. Card with the raw API (same result)

```js
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

const card = figma.createFrame();
card.name = 'Card';
card.x = 100; card.y = 100;
card.layoutMode = 'VERTICAL';
card.primaryAxisSizingMode = 'AUTO';
card.counterAxisSizingMode = 'FIXED';
card.resize(320, 10);
card.itemSpacing = 8;
card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = 16;
card.cornerRadius = 12;
card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
card.strokes = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
card.strokeWeight = 1;
figma.currentPage.appendChild(card);

const title = figma.createText();
title.fontName = { family: 'Inter', style: 'Bold' };
title.characters = 'Card title';
title.fontSize = 18;
card.appendChild(title);
title.layoutSizingHorizontal = 'FILL';

const body = figma.createText();
body.fontName = { family: 'Inter', style: 'Regular' };
body.characters = 'Supporting copy that wraps to several lines when it is long enough.';
body.fontSize = 14;
body.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.45 } }];
body.textAutoResize = 'HEIGHT';
card.appendChild(body);
body.layoutSizingHorizontal = 'FILL';

return { created: [card.id, title.id, body.id], size: [card.width, card.height] };
```

## 5. Horizontal row of items (e.g. avatar + name)

```js
await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
const row = figma.createFrame();
row.name = 'Row';
row.layoutMode = 'HORIZONTAL';
row.primaryAxisSizingMode = 'AUTO';
row.counterAxisSizingMode = 'AUTO';
row.counterAxisAlignItems = 'CENTER';
row.itemSpacing = 12;
figma.currentPage.appendChild(row);

const avatar = figma.createEllipse();
avatar.resize(40, 40);
avatar.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.45, b: 0.3 } }];
row.appendChild(avatar);

const name = figma.createText();
name.fontName = { family: 'Inter', style: 'Medium' };
name.characters = 'Alex Rivera';
name.fontSize = 15;
row.appendChild(name);

return { created: [row.id, avatar.id, name.id] };
```

## 6. Bulk edit: recolor every rectangle under a frame

```js
const root = await figma.getNodeByIdAsync('12:34');
const rects = root.findAllWithCriteria({ types: ['RECTANGLE'] });
for (const r of rects) {
  r.fills = [{ type: 'SOLID', color: { r: 0.13, g: 0.77, b: 0.37 } }];
}
return { changed: rects.map(r => r.id) };
```

## 7. Replace text everywhere (safe font handling)

```js
const texts = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })
  .filter(t => t.characters.includes('Lorem'));
for (const t of texts) {
  if (t.fontName === figma.mixed) {
    for (const seg of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(seg.fontName);
  } else {
    await figma.loadFontAsync(t.fontName);
  }
  t.characters = t.characters.replace(/Lorem ipsum/g, 'Real copy');
}
return { changed: texts.map(t => t.id) };
```

## 8. Icon from an SVG string

```js
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const icon = figma.createNodeFromSvg(svg);
icon.name = 'icon/heart';
icon.x = 200; icon.y = 200;
figma.currentPage.appendChild(icon);
return { created: [icon.id] };
```

## 9. Component + instance

```js
const frame = await figma.getNodeByIdAsync('12:34');          // a FRAME to turn into a component
const comp = figma.createComponentFromNode(frame);
comp.name = 'Button/Primary';
const inst = comp.createInstance();
inst.x = comp.x + comp.width + 40; inst.y = comp.y;
figma.currentPage.appendChild(inst);
return { component: comp.id, instance: inst.id };
```

## 10. Local variables (works on any plan via the plugin)

```js
const collections = await figma.variables.getLocalVariableCollectionsAsync();
let col = collections.find(c => c.name === 'Colors');
if (!col) col = figma.variables.createVariableCollection('Colors');
const v = figma.variables.createVariable('brand/primary', col, 'COLOR');
v.setValueForMode(col.defaultModeId, { r: 0.05, g: 0.6, b: 0.95, a: 1 });
v.scopes = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'];

// bind it to a node's fill
const node = await figma.getNodeByIdAsync('12:34');
const paint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', v);
node.fills = [paint];
return { collection: col.id, variable: v.id, bound: node.id };
```

## 11. Switch page, then read

```js
const page = figma.root.children.find(p => p.name === 'Components');
if (!page) return { pages: figma.root.children.map(p => p.name) };
await figma.setCurrentPageAsync(page);
const comps = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
return comps.map(c => ({ id: c.id, name: c.name, key: c.key }));
```

## 12. Delete by name pattern, with a dry run

```js
const re = /^tmp-/i;
const hits = figma.currentPage.findAll(n => re.test(n.name));
const dryRun = true;                           // flip to false after checking the list
if (!dryRun) for (const n of hits) n.remove();
return { matched: hits.map(n => ({ id: n.id, name: n.name })), deleted: !dryRun };
```
