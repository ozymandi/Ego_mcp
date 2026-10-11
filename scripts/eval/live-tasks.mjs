// Multi-step live eval tasks. Each task has:
//   prompt  — what the user asks
//   setup   — use_figma snippet run before the model starts (optional)
//   check   — use_figma snippet that returns { pass: boolean, reason?: string }
//   profiles — which tool profiles the task applies to (default: all)
//   answer  — regex the final assistant message must match (read tasks)
//
// Checks are read-only and deterministic. Every node a task creates at page
// level is removed afterwards by the runner (snapshot diff), so tasks are
// independent and can run in any order.

export const TASKS = [
  {
    id: "card",
    prompt:
      "Create a card at 100,100 named 'Card', 320 wide, with a vertical auto-layout (padding 16, gap 8), white fill and 12px corner radius. Inside put a bold title 'Welcome' at 18px and a body text 'Thanks for joining us.' at 14px in gray (#666666).",
    check: `
      const card = figma.currentPage.findOne(n => n.name === 'Card' && (n.type === 'FRAME' || n.type === 'COMPONENT'));
      if (!card) return { pass: false, reason: 'no frame named Card' };
      const issues = [];
      if (card.layoutMode !== 'VERTICAL') issues.push('layoutMode=' + card.layoutMode);
      if (Math.round(card.width) !== 320) issues.push('width=' + card.width);
      if (card.paddingLeft !== 16 || card.paddingTop !== 16) issues.push('padding=' + card.paddingLeft + '/' + card.paddingTop);
      if (card.itemSpacing !== 8) issues.push('gap=' + card.itemSpacing);
      if (card.cornerRadius !== 12) issues.push('radius=' + String(card.cornerRadius));
      const fill = card.fills && card.fills[0];
      if (!fill || fill.type !== 'SOLID' || fill.color.r < 0.98 || fill.color.g < 0.98 || fill.color.b < 0.98) issues.push('fill not white');
      const texts = card.findAllWithCriteria({ types: ['TEXT'] });
      const title = texts.find(t => t.characters === 'Welcome');
      const body = texts.find(t => t.characters === 'Thanks for joining us.');
      if (!title) issues.push('no title text'); else {
        if (title.fontSize !== 18) issues.push('title size=' + String(title.fontSize));
        const st = title.fontName === figma.mixed ? '' : title.fontName.style;
        if (!/bold/i.test(st)) issues.push('title style=' + st);
      }
      if (!body) issues.push('no body text'); else {
        if (body.fontSize !== 14) issues.push('body size=' + String(body.fontSize));
        const c = body.fills && body.fills[0] && body.fills[0].color;
        if (!c || Math.abs(c.r - 0.4) > 0.05) issues.push('body color off');
      }
      return { pass: issues.length === 0, reason: issues.join(', ') };
    `,
  },
  {
    id: "recolor",
    setup: `
      for (let i = 1; i <= 3; i++) {
        const r = figma.createRectangle(); r.name = 'Swatch ' + i; r.x = 100 + i * 70; r.y = 700; r.resize(50, 50);
        r.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
        figma.currentPage.appendChild(r);
      }
      const other = figma.createRectangle(); other.name = 'Keep'; other.x = 400; other.y = 700; other.resize(50, 50);
      other.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]; figma.currentPage.appendChild(other);
      return 'ok';
    `,
    prompt: "Make every rectangle whose name starts with 'Swatch' green (#22c55e). Leave other rectangles alone.",
    check: `
      const rects = figma.currentPage.findAllWithCriteria({ types: ['RECTANGLE'] });
      const sw = rects.filter(r => r.name.startsWith('Swatch'));
      const keep = rects.find(r => r.name === 'Keep');
      const isGreen = (r) => { const c = r.fills && r.fills[0] && r.fills[0].color; return c && Math.abs(c.r - 0.133) < 0.03 && Math.abs(c.g - 0.773) < 0.03 && Math.abs(c.b - 0.369) < 0.03; };
      const issues = [];
      if (sw.length !== 3) issues.push('swatches=' + sw.length);
      for (const r of sw) if (!isGreen(r)) issues.push(r.name + ' not green');
      if (!keep) issues.push('Keep missing'); else if (isGreen(keep)) issues.push('Keep was recolored');
      return { pass: issues.length === 0, reason: issues.join(', ') };
    `,
  },
  {
    id: "rename-move",
    setup: `
      const f = figma.createFrame(); f.name = 'Old'; f.x = 50; f.y = 900; f.resize(200, 60); figma.currentPage.appendChild(f); return f.id;
    `,
    prompt: "Rename the frame called 'Old' to 'Header' and move it to x=400, y=40.",
    check: `
      const old = figma.currentPage.findOne(n => n.name === 'Old');
      const h = figma.currentPage.findOne(n => n.name === 'Header' && n.type === 'FRAME');
      if (old) return { pass: false, reason: 'frame still named Old' };
      if (!h) return { pass: false, reason: 'no frame named Header' };
      if (Math.round(h.x) !== 400 || Math.round(h.y) !== 40) return { pass: false, reason: 'position ' + h.x + ',' + h.y };
      return { pass: true };
    `,
  },
  {
    id: "icon-row",
    prompt:
      "Create a horizontal auto-layout frame named 'Actions' at 100,500 with a 24px gap, containing four icons from the Lucide set: heart, message-circle, repeat, send. Each icon 24px, color #333333.",
    check: `
      const f = figma.currentPage.findOne(n => n.name === 'Actions' && n.type === 'FRAME');
      if (!f) return { pass: false, reason: 'no frame Actions' };
      const issues = [];
      if (f.layoutMode !== 'HORIZONTAL') issues.push('layoutMode=' + f.layoutMode);
      if (f.itemSpacing !== 24) issues.push('gap=' + f.itemSpacing);
      const kids = f.children.filter(c => c.type !== 'TEXT');
      if (kids.length !== 4) issues.push('children=' + kids.length);
      const vectors = f.findAllWithCriteria({ types: ['VECTOR', 'BOOLEAN_OPERATION'] });
      if (vectors.length < 4) issues.push('vectors=' + vectors.length + ' (icons must be real vectors, not text)');
      const names = kids.map(k => k.name.toLowerCase()).join(' ');
      for (const want of ['heart', 'message', 'repeat', 'send']) if (!names.includes(want)) issues.push('missing ' + want);
      return { pass: issues.length === 0, reason: issues.join(', ') };
    `,
  },
  {
    id: "component-instance",
    setup: `
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const f = figma.createFrame(); f.name = 'Tile'; f.x = 100; f.y = 1100; f.resize(120, 48);
      f.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.95 } }];
      const t = figma.createText(); t.characters = 'Tile'; f.appendChild(t);
      figma.currentPage.appendChild(f); return f.id;
    `,
    prompt: "Turn the frame named 'Tile' into a component, then place one instance of it at x=500, y=1100.",
    check: `
      const comp = figma.currentPage.findOne(n => n.type === 'COMPONENT' && n.name === 'Tile');
      if (!comp) return { pass: false, reason: 'no component Tile' };
      const insts = figma.currentPage.findAllWithCriteria({ types: ['INSTANCE'] });
      const mine = [];
      for (const i of insts) { const m = await i.getMainComponentAsync(); if (m && m.id === comp.id) mine.push(i); }
      if (mine.length !== 1) return { pass: false, reason: 'instances of Tile=' + mine.length };
      const i = mine[0];
      if (Math.round(i.x) !== 500 || Math.round(i.y) !== 1100) return { pass: false, reason: 'instance at ' + i.x + ',' + i.y };
      return { pass: true };
    `,
  },
  {
    id: "critique-fix",
    setup: `
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const T = (chars, size, color) => { const t = figma.createText(); t.characters = chars; set(t, { fontSize: size, fills: [solid(color)] }); return t; };
      const promo = createAutoLayout('VERTICAL', { name: 'Promo', fill: '#2563eb', padding: 24, itemSpacing: 12, counterAxisSizingMode: 'FIXED', width: 480 });
      promo.x = 100; promo.y = 1500; figma.currentPage.appendChild(promo);
      promo.appendChild(T('Spring offer', 28, '#ffffff'));
      promo.appendChild(T('Save 20% on every plan until the end of April.', 14, '#9a9a9a'));
      promo.appendChild(T('Terms apply. Offer ends April 30.', 9, '#cccccc'));
      const outer = createAutoLayout('VERTICAL', { name: 'Details', fill: '#ffffff', cornerRadius: 12, padding: 16 });
      const inner = createAutoLayout('VERTICAL', { name: 'Details card', fill: '#f3f4f6', cornerRadius: 12, padding: 16, counterAxisSizingMode: 'FIXED', width: 400 });
      inner.appendChild(T('Monthly and yearly plans included.', 14, '#111111'));
      outer.appendChild(inner); promo.appendChild(outer);
      return promo.id;
    `,
    prompt: "Run a design critique on the frame named 'Promo' and fix every primary finding it reports. Keep the content and layout; only fix what the critique flags.",
    check: `
      const promo = figma.currentPage.findOne(n => n.name === 'Promo' && n.type === 'FRAME');
      if (!promo) return { pass: false, reason: 'Promo frame missing' };
      const issues = [];
      const texts = promo.findAllWithCriteria({ types: ['TEXT'] });
      const lum = (c) => { const f = (v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const blue = { r: 0x25 / 255, g: 0x63 / 255, b: 0xeb / 255 };
      for (const t of texts) {
        if (t.fontSize !== figma.mixed && t.fontSize < 11) issues.push(t.characters.slice(0, 20) + ' still ' + t.fontSize + 'px');
        const onBlue = t.parent === promo;
        const c = t.fills && t.fills[0] && t.fills[0].type === 'SOLID' ? t.fills[0].color : null;
        if (onBlue && c) { const l1 = lum(c), l2 = lum(blue); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (ratio < 4.5 && !(t.fontSize >= 24 && ratio >= 3)) issues.push(t.characters.slice(0, 20) + ' contrast ' + ratio.toFixed(1)); }
      }
      const outer = promo.findOne(n => n.name === 'Details');
      const inner = promo.findOne(n => n.name === 'Details card');
      const hasSurface = (n) => n && n.fills && n.fills.some(f => f.visible !== false && f.type === 'SOLID') && (n.cornerRadius > 0 || (n.strokes && n.strokes.length));
      if (outer && inner && hasSurface(outer) && hasSurface(inner) && inner.parent === outer) issues.push('still a card inside a card');
      return { pass: issues.length === 0, reason: issues.join(', ') };
    `,
  },
  {
    id: "read-text",
    setup: `
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const f = figma.createFrame(); f.name = 'Info'; f.x = 100; f.y = 1300; f.resize(260, 40);
      const t = figma.createText(); t.characters = 'Order #4521 shipped'; f.appendChild(t);
      figma.currentPage.appendChild(f); return f.id;
    `,
    prompt: "What text is inside the frame named 'Info' on the current page? Reply with the text only.",
    answer: /Order #4521 shipped/,
    check: `return { pass: true };`,
  },
];
