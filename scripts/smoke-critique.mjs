#!/usr/bin/env node
// Live test for critique_design: builds a frame full of deliberate design
// clichés and a clean one on the current page, runs the critique on both,
// checks the expected rules fire (and don't), then removes both frames.
//
// Usage: node scripts/smoke-critique.mjs   (daemon + plugin connected)

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
let captured = null;
const origConnect = McpServer.prototype.connect;
McpServer.prototype.connect = async function () { captured = this; };
StdioServerTransport.prototype.start = async function () {};
await import(pathToFileURL(path.join(root, "dist", "server.js")).href);
const [ct, st] = InMemoryTransport.createLinkedPair();
await origConnect.call(captured, st);
const client = new Client({ name: "smoke-critique", version: "0" });
await client.connect(ct);

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${String(detail).slice(0, 400)}` : ""}`);
  if (!cond) failures++;
};
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: !res.isError, text, data };
}
for (let i = 0; i < 25; i++) {
  const s = await call("bridge_status");
  if (s.data?.plugin === "connected") break;
  await new Promise((r) => setTimeout(r, 200));
}

// ---- bad fixture -----------------------------------------------------------
const bad = await call("use_figma", {
  code: `
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  const T = (chars, props = {}) => { const t = figma.createText(); t.fontName = { family: 'Inter', style: props.bold ? 'Bold' : 'Regular' }; t.characters = chars; set(t, { fontSize: props.size ?? 14, fills: [solid(props.color ?? '#9a9a9a')] }); if (props.lh) t.lineHeight = { unit: 'PERCENT', value: props.lh }; if (props.ls !== undefined) t.letterSpacing = { unit: 'PERCENT', value: props.ls }; if (props.align) t.textAlignHorizontal = props.align; if (props.w) { t.textAutoResize = 'HEIGHT'; t.resize(props.w, 10); } return t; };

  const rootF = createAutoLayout('VERTICAL', { name: 'smoke-critique-bad', fill: '#f3ead8', itemSpacing: 13, padding: 7, counterAxisSizingMode: 'FIXED', width: 800 });
  rootF.x = 20; rootF.y = 2000; figma.currentPage.appendChild(rootF);

  // eyebrow chip + oversized crushed heading + gradient text + buzzwords
  const chip = createAutoLayout('HORIZONTAL', { name: 'Chip', fill: '#e0e7ff', padding: 6, cornerRadius: 999 }); chip.appendChild(T('NEW', { size: 12, color: '#4f46e5' })); rootF.appendChild(chip);
  rootF.appendChild(T('Unlock seamless, effortless workflows', { size: 120, bold: true, color: '#111111', ls: -8 }));
  const grad = T('Supercharge everything', { size: 32, bold: true }); grad.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1,0,0],[0,1,0]], gradientStops: [{ position: 0, color: { r: 0.55, g: 0.2, b: 0.9, a: 1 } }, { position: 1, color: { r: 0.2, g: 0.5, b: 1, a: 1 } }] }]; rootF.appendChild(grad);
  rootF.appendChild(T('Simple. Fast. Done.', { size: 14, color: '#111111' }));
  rootF.appendChild(T('Design — build — ship — repeat — again', { size: 14, color: '#111111' }));
  rootF.appendChild(T('One — two', { size: 14, color: '#111111' }));
  rootF.appendChild(T('Three — four', { size: 14, color: '#111111' }));
  rootF.appendChild(T('01', { size: 14, color: '#111111' })); rootF.appendChild(T('02', { size: 14, color: '#111111' }));

  // purple-blue hero with colored glow
  const hero = figma.createRectangle(); hero.name = 'Hero'; hero.resize(760, 200);
  hero.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1,0,0],[0,1,0]], gradientStops: [{ position: 0, color: { r: 0.5, g: 0.2, b: 0.9, a: 1 } }, { position: 1, color: { r: 0.1, g: 0.5, b: 1, a: 1 } }] }];
  hero.effects = [{ type: 'DROP_SHADOW', color: { r: 0.5, g: 0.2, b: 0.9, a: 0.6 }, offset: { x: 0, y: 0 }, radius: 40, visible: true, blendMode: 'NORMAL' }];
  rootF.appendChild(hero);

  // gray text on a colored panel, tiny, tight leading, justified, long line
  const panel = createAutoLayout('VERTICAL', { name: 'Frame 101', fill: '#2563eb', padding: 22, itemSpacing: 7, counterAxisSizingMode: 'FIXED', width: 760 });
  panel.appendChild(T('This is gray body copy sitting on a saturated blue panel, which is hard to read and a classic mistake that keeps showing up in generated designs everywhere.', { size: 14, color: '#9a9a9a', lh: 100, w: 740 }));
  panel.appendChild(T('tiny legal text', { size: 9, color: '#dddddd' }));
  panel.appendChild(T('Justified paragraph text that goes on and on so that it wraps to several lines and shows rivers of white space in between the words of the paragraph here.', { size: 14, color: '#ffffff', align: 'JUSTIFIED', w: 740 }));
  rootF.appendChild(panel);

  // nested cards + repeated text + inconsistent radius + small button
  const outer = createAutoLayout('HORIZONTAL', { name: 'Frame 102', fill: '#ffffff', stroke: '#dddddd', cornerRadius: 16, padding: 16, itemSpacing: 16 });
  const radii = [8, 12, 20];
  for (let i = 0; i < 3; i++) {
    const card = createAutoLayout('VERTICAL', { name: 'Frame 10' + (3 + i), fill: '#fafafa', cornerRadius: radii[i], padding: 16, itemSpacing: 8 });
    card.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 2 }, radius: 8, visible: true, blendMode: 'NORMAL' }];
    card.appendChild(T('Lorem ipsum dolor sit amet, consectetur', { size: 14, color: '#111111' }));
    const btn = createAutoLayout('HORIZONTAL', { name: 'Button', fill: '#2563eb', padding: 4, cornerRadius: 4 }); btn.appendChild(T('Go', { size: 12, color: '#ffffff' })); card.appendChild(btn);
    outer.appendChild(card);
  }
  rootF.appendChild(outer);
  const single = createAutoLayout('VERTICAL', { name: 'Frame 106', fill: '#ffffff', stroke: '#dddddd', cornerRadius: 16, padding: 16 });
  const inner = createAutoLayout('VERTICAL', { name: 'Frame 107', fill: '#f5f5f5', cornerRadius: 12, padding: 16, counterAxisSizingMode: 'FIXED', width: 700 }); inner.appendChild(T('Nested card content', { size: 14, color: '#111111' })); single.appendChild(inner);
  rootF.appendChild(single);

  // many hues
  const row = createAutoLayout('HORIZONTAL', { name: 'Swatches', itemSpacing: 8 });
  for (const h of ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6']) { const r = figma.createRectangle(); set(r, { width: 40, height: 40, fill: h }); row.appendChild(r); }
  rootF.appendChild(row);

  // hidden layer + absolute child
  const hidden = figma.createRectangle(); hidden.name = 'Old banner'; hidden.visible = false; rootF.appendChild(hidden);
  const abs = figma.createRectangle(); abs.name = 'Badge'; set(abs, { width: 20, height: 20, fill: '#ef4444' }); rootF.appendChild(abs); abs.layoutPositioning = 'ABSOLUTE';
  return rootF.id;
  `,
});
check("bad fixture built", bad.ok, bad.text.slice(0, 200));
const badId = bad.ok ? bad.data.result : null;

// ---- clean fixture ---------------------------------------------------------
const clean = await call("use_figma", {
  code: `
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
  const T = (chars, size, style, color) => { const t = figma.createText(); t.fontName = { family: 'Inter', style }; t.characters = chars; set(t, { fontSize: size, fills: [solid(color)] }); t.lineHeight = { unit: 'PERCENT', value: 150 }; return t; };
  const rootF = createAutoLayout('VERTICAL', { name: 'smoke-critique-clean', fill: '#ffffff', itemSpacing: 24, padding: 32, counterAxisSizingMode: 'FIXED', width: 720 });
  rootF.x = 900; rootF.y = 2000; figma.currentPage.appendChild(rootF);
  rootF.appendChild(T('Invoices', 32, 'Semi Bold', '#111111'));
  rootF.appendChild(T('Track what was sent, what was paid, and what is overdue.', 16, 'Regular', '#444444'));
  const card = createAutoLayout('VERTICAL', { name: 'Summary card', fill: '#f6f7f9', cornerRadius: 12, padding: 20, itemSpacing: 8 });
  card.appendChild(T('Outstanding', 14, 'Regular', '#555555'));
  card.appendChild(T('€12,480', 28, 'Semi Bold', '#111111'));
  rootF.appendChild(card);
  const actions = createAutoLayout('HORIZONTAL', { name: 'Actions', itemSpacing: 12 });
  const btn = createAutoLayout('HORIZONTAL', { name: 'Primary button', fill: '#1d4ed8', cornerRadius: 8, padding: 12, itemSpacing: 8 });
  btn.appendChild(T('New invoice', 14, 'Semi Bold', '#ffffff')); actions.appendChild(btn);
  rootF.appendChild(actions);
  return rootF.id;
  `,
});
check("clean fixture built", clean.ok, clean.text.slice(0, 200));
const cleanId = clean.ok ? clean.data.result : null;

// ---- run critique ----------------------------------------------------------
if (badId) {
  const r = await call("critique_design", { node_id: badId, format: "json", max_findings: 200 });
  check("critique bad: runs", r.ok, r.text.slice(0, 200));
  const rules = new Set((r.data?.findings ?? []).map((x) => x.rule));
  const expect = ["low-contrast", "gray-on-color", "tiny-text", "tight-leading", "justified-text", "extreme-negative-tracking", "oversized-h1", "gradient-text", "ai-color-palette", "cream-palette", "dark-glow", "nested-cards", "inconsistent-radius", "repeated-container-text", "lorem-placeholder", "marketing-buzzword", "aphoristic-cadence", "em-dash-overuse", "numbered-section-labels", "hero-eyebrow-chip", "color-amount", "off-grid-spacing", "small-tap-target", "unnamed-layers", "hidden-layers", "absolute-in-autolayout"];
  const missing = expect.filter((e) => !rules.has(e));
  check(`critique bad: ${expect.length - missing.length}/${expect.length} expected rules fired`, missing.length <= 3, missing.length ? `missing: ${missing.join(", ")}` : "");
  const text = await call("critique_design", { node_id: badId, min_severity: "primary" });
  check("critique bad: text report", text.ok && /^critique: /.test(text.text) && /\nP /.test(text.text), text.text.split("\n").slice(0, 4).join(" | "));
  console.log("\n--- bad report (first 12 lines) ---\n" + text.text.split("\n").slice(0, 12).join("\n") + "\n---");
}
if (cleanId) {
  const r = await call("critique_design", { node_id: cleanId, format: "json" });
  const primary = (r.data?.findings ?? []).filter((x) => x.severity === "primary");
  check("critique clean: no primary findings", r.ok && primary.length === 0, primary.map((x) => `${x.rule}: ${x.detail}`).join(" | "));
  const adv = (r.data?.findings ?? []).filter((x) => x.severity === "advisory");
  console.log(`      clean advisories: ${adv.map((x) => x.rule).join(", ") || "none"}`);
}
const lr = await call("list_critique_rules", {});
check("list_critique_rules", lr.ok && /rules/.test(lr.text), lr.text.split("\n")[0]);

// cleanup
const del = await call("use_figma", { code: `for (const n of query(figma.currentPage, "[name^=smoke-critique]")) n.remove(); return 'cleaned';` });
check("cleanup", del.ok, del.text.slice(0, 100));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
