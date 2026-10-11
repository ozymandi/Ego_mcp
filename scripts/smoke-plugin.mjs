#!/usr/bin/env node
// Live smoke test for the plugin bridge: connects to the daemon as an MCP
// client and exercises the use_figma helpers and error diagnostics against
// the file currently open in Figma. Creates a frame named "smoke-test" on the
// current page and deletes it at the end.
//
// Usage: node scripts/smoke-plugin.mjs   (daemon running, plugin connected)

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
const url = process.env.FIGMA_BRIDGE_URL ?? `ws://localhost:${process.env.FIGMA_BRIDGE_PORT ?? 7575}`;

const ws = new WebSocket(url);
const pending = new Map();
await new Promise((res, rej) => {
  ws.on("open", res);
  ws.on("error", rej);
});
ws.send(JSON.stringify({ role: "mcp" }));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  p(msg);
});

function send(type, payload, timeout = 20000) {
  const id = randomUUID();
  ws.send(JSON.stringify({ id, type, payload }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout: ${type}`)), timeout);
    pending.set(id, (m) => {
      clearTimeout(t);
      res(m);
    });
  });
}

const exec = (code, extra = {}) => send("exec", { code, track: true, ...extra });

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
  if (!cond) failures++;
}

const ping = await send("ping");
check("ping", ping.ok, JSON.stringify(ping.result));

// 1. helpers: createAutoLayout + set + hex + solid, created_ids tracked
const r1 = await exec(`
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const card = createAutoLayout('VERTICAL', { name: 'smoke-test', itemSpacing: 8, padding: 16, fill: '#ffffff', stroke: '#e5e7eb' });
  card.x = 10; card.y = 10;
  figma.currentPage.appendChild(card);
  const t = figma.createText();
  t.characters = 'Smoke';
  set(t, { fontSize: 18, fills: [solid('#111111')] });
  card.appendChild(t);
  const r = figma.createRectangle();
  set(r, { name: 'Swatch', width: 40, height: 40, fill: '#0d99ff80', cornerRadius: 8 });
  card.appendChild(r);
  return { card: card.id, text: t.id, rect: r.id, w: card.width, h: card.height };
`);
check("helpers run", r1.ok, r1.ok ? JSON.stringify(r1.result.result) : r1.error);
const ids = r1.ok ? r1.result.result : {};
check("created_ids tracked", r1.ok && Array.isArray(r1.result.created_ids) && r1.result.created_ids.includes(ids.card), JSON.stringify(r1.result?.created_ids));

// 2. query selectors
const r2 = await exec(`
  const card = await figma.getNodeByIdAsync(${JSON.stringify(ids.card)});
  return {
    byType: query(card, 'TEXT').map(n => n.id),
    byName: query(card, 'RECTANGLE[name=Swatch]').map(n => n.id),
    contains: query(figma.currentPage, 'FRAME[name*=smoke] > TEXT').map(n => n.id),
    union: query(card, 'TEXT, RECTANGLE').length,
  };
`);
const q = r2.ok ? r2.result.result : {};
check("query by type", r2.ok && q.byType?.[0] === ids.text, JSON.stringify(q));
check("query attr + child combinator", r2.ok && q.byName?.[0] === ids.rect && q.contains?.[0] === ids.text && q.union === 2);

// 3. changed_ids tracked, created_ids empty
const r3 = await exec(`
  const r = await figma.getNodeByIdAsync(${JSON.stringify(ids.rect)});
  set(r, { fill: '#22c55e' });
  return 'ok';
`);
check("changed_ids tracked", r3.ok && (r3.result.changed_ids ?? []).includes(ids.rect) && !r3.result.created_ids, JSON.stringify(r3.result));

// 4. error diagnostics
// Fonts stay loaded for the whole plugin session, so provoking the real
// error is unreliable here; throw Figma's own message to test the mapping.
const r4 = await exec(`
  throw new Error('Cannot write to node with unloaded font "Inter Bold". Please call figma.loadFontAsync({ family: "Inter", style: "Bold" }) and await the returned promise first.');
`);
check("font error has hint + safe_to_retry", !r4.ok && /font/i.test(r4.hint ?? "") && r4.safe_to_retry === true, `${r4.error} | ${r4.hint}`);

const r5 = await exec(`figma.currentPage = figma.root.children[0]; return 1;`);
check("currentPage error diagnosed", !r5.ok && /setCurrentPageAsync/.test(r5.hint ?? ""), r5.error);

const r6 = await exec(`const n = await figma.getNodeByIdAsync('999999:1'); return n.name;`);
check("missing node -> safe_to_retry false", !r6.ok && r6.safe_to_retry === false, r6.error);

// 5. screenshot after create
const r7 = await exec(`
  const f = createAutoLayout('HORIZONTAL', { name: 'smoke-shot', fill: '#fde68a', padding: 12 });
  f.x = 400; f.y = 10;
  figma.currentPage.appendChild(f);
  const r = figma.createRectangle(); set(r, { width: 30, height: 30, fill: '#f59e0b' }); f.appendChild(r);
  return f.id;
`, { screenshot: true });
check("screenshot after create", r7.ok && Array.isArray(r7.result.screenshots) && r7.result.screenshots.length === 1 && r7.result.screenshots[0].base64.length > 100,
  r7.ok ? `${r7.result.screenshots?.[0]?.width}x${r7.result.screenshots?.[0]?.height}` : r7.error);

// cleanup
const r8 = await exec(`
  for (const n of query(figma.currentPage, 'FRAME[name^=smoke-]')) n.remove();
  return 'cleaned';
`);
check("cleanup", r8.ok && (r8.result.deleted_ids ?? []).length >= 1, JSON.stringify(r8.result));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
