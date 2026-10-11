#!/usr/bin/env node
// Live smoke test of the structured canvas tools through the real MCP server
// (in-memory transport) -> daemon -> plugin. Needs the daemon running and the
// plugin connected in Figma desktop. Creates nodes named "smoke-*" and a
// variable collection "smoke-vars" on the current page and removes them.
//
// Usage: node scripts/smoke-tools.mjs

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
McpServer.prototype.connect = async function () {
  captured = this;
};
StdioServerTransport.prototype.start = async function () {};
await import(pathToFileURL(path.join(root, "dist", "server.js")).href);
const [ct, st] = InMemoryTransport.createLinkedPair();
await origConnect.call(captured, st);
const client = new Client({ name: "smoke-tools", version: "0" });
await client.connect(ct);

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${String(detail).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
}

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  // On error `data` stays an object so chained property reads do not crash the script.
  if (res.isError && (data === null || typeof data !== "object")) data = { error: text };
  return { ok: !res.isError, text, data, images: res.content.filter((c) => c.type === "image").length };
}

// wait for the bridge client to reach the daemon
let status;
for (let i = 0; i < 25; i++) {
  status = await call("bridge_status");
  if (status.data?.plugin === "connected") break;
  await new Promise((r) => setTimeout(r, 200));
}
check("bridge_status: plugin connected", status.data?.plugin === "connected", status.text);
if (status.data?.plugin !== "connected") {
  console.log("\nplugin not connected; aborting");
  process.exit(1);
}

// pages
const pages = await call("list_pages");
check("list_pages", pages.ok && Array.isArray(pages.data) && pages.data.some((p) => p.current), pages.text);
const cur = pages.data.find((p) => p.current);
const sp = await call("set_current_page", { page_id: cur.id });
check("set_current_page (same page)", sp.ok && sp.data.id === cur.id, sp.text);

// base frame + text for spec
const frame = await call("create_frame", { x: 20, y: 20, width: 200, height: 120, name: "smoke-spec" });
check("create_frame", frame.ok, frame.text);
const fid = frame.data.id;
const al = await call("set_auto_layout", { node_id: fid, direction: "VERTICAL", item_spacing: 8, padding: 12 });
check("set_auto_layout", al.ok, al.text);
const txt = await call("create_text", { x: 0, y: 0, content: "Spec me", font_size: 16, color: "#123456", parent_id: fid });
check("create_text in frame", txt.ok, txt.text);
const spec = await call("get_node_spec", { node_id: fid });
check("get_node_spec", spec.ok && /FRAME "smoke-spec"/.test(spec.text) && /TEXT/.test(spec.text) && /layout=VERTICAL/.test(spec.text) && /#123456/.test(spec.text), spec.text);

// icons
const si = await call("search_icons", { query: "arrow right" });
check("search_icons", si.ok && si.data.icons.includes("arrow-right"), si.text);
const icon = await call("insert_icon", { name: "heart", x: 300, y: 20, size: 32, color: "#ff0000", parent_id: fid });
check("insert_icon", icon.ok && icon.data.name === "icon/heart" && icon.data.width > 0, icon.text);
const bad = await call("insert_icon", { name: "definitely-not-an-icon", x: 0, y: 0 });
check("insert_icon unknown -> error", !bad.ok && /No Lucide icon/.test(bad.text), bad.text);
const svg = await call("create_from_svg", { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#00ff00"/></svg>', x: 340, y: 20, name: "smoke-svg" });
check("create_from_svg", svg.ok && svg.data.width === 20, svg.text);

// components
const comp = await call("create_component", { node_id: fid, name: "State=Default", description: "smoke" });
check("create_component", comp.ok && comp.data.type === "COMPONENT", comp.text);
const cid = comp.data.id;
const inst = await call("create_instance", { component_id: cid, x: 20, y: 200, name: "smoke-inst" });
check("create_instance by id", inst.ok && inst.data.type === "INSTANCE" && inst.data.main_component?.id === cid, inst.text);
const iid = inst.data.id;
const ip = await call("get_instance_properties", { node_id: iid });
check("get_instance_properties", ip.ok && ip.data.main_component?.id === cid, ip.text);

const clone = await call("clone_node", { node_id: cid });
check("clone component", clone.ok, clone.text);
const rn = await call("rename_node", { node_id: clone.data.id, name: "State=Hover" });
check("rename clone", rn.ok, rn.text);
const set = await call("combine_as_variants", { node_ids: [cid, clone.data.id], name: "smoke-set" });
check("combine_as_variants", set.ok && set.data.variants?.length === 2 && set.data.definitions?.State?.options?.length === 2, set.text);
const setSpec = await call("get_node_spec", { node_id: set.data.id, max_depth: 1 });
check("combine_as_variants: set has auto-layout, variants side by side", setSpec.ok && /layout=HORIZONTAL/.test(setSpec.text) && set.data.width > 200, setSpec.text.split(String.fromCharCode(10))[1]);
const sip = await call("set_instance_properties", { node_id: iid, properties: { State: "Hover" } });
check("set_instance_properties variant", sip.ok && sip.data.properties?.State?.value === "Hover", sip.text);
const sw = await call("swap_instance", { node_id: iid, component_id: cid });
check("swap_instance", sw.ok && sw.data.main_component?.id === cid, sw.text);
const lc = await call("list_components", { name_pattern: "^smoke-set$" });
check("list_components", lc.ok && lc.data.count === 1 && lc.data.components?.[0]?.type === "COMPONENT_SET", lc.text);
const det = await call("detach_instance", { node_id: iid });
check("detach_instance", det.ok && det.data.type === "FRAME", det.text);

// variables
const col = await call("create_variable_collection", { name: "smoke-vars", modes: ["Light", "Dark"] });
check("create_variable_collection", col.ok && col.data.modes?.length === 2 && col.data.modes[0].name === "Light", col.text);
const colId = col.data.id;
const v = await call("create_variable", { collection_id: colId, name: "smoke/primary", type: "COLOR", values_by_mode: { Light: "#0d99ff", Dark: "#80c8ff" } });
check("create_variable COLOR", v.ok && v.data.values?.Light === "#0d99ff" && v.data.values.Dark === "#80c8ff", v.text);
const vid = v.data.id;
const vf = await call("create_variable", { collection_id: colId, name: "smoke/gap", type: "FLOAT", value: 12 });
check("create_variable FLOAT", vf.ok && vf.data.values?.Light === 12, vf.text);
const sv = await call("set_variable_value", { variable_id: vid, value: "#112233", mode: "Dark" });
check("set_variable_value", sv.ok && sv.data.value === "#112233", sv.text);
const lv = await call("list_variables", { collection_id: colId });
check("list_variables", lv.ok && lv.data?.count === 2, lv.text);
const lcol = await call("list_variable_collections");
check("list_variable_collections", lcol.ok && (lcol.data ?? []).some?.((c) => c.id === colId && c.variable_count === 2), lcol.text);
const batch = await call("create_variables", { collection_id: colId, variables: [
  { name: "smoke/b1", type: "COLOR", value: "#ff0000" },
  { name: "smoke/b2", type: "FLOAT", value: 8 },
  { name: "smoke/bad", type: "COLOR", value: "not-a-color" },
] });
check("create_variables batch (2 ok, 1 error)", batch.ok && batch.data.created_count === 2 && batch.data.errors?.length === 1, batch.text);
const rect = await call("create_rectangle", { x: 400, y: 200, width: 50, height: 50, fill: "#000000", name: "smoke-rect" });
const rect2 = await call("create_rectangle", { x: 470, y: 200, width: 50, height: 50, fill: "#000000", name: "smoke-rect2" });
const bb = await call("bind_variables", { bindings: [
  { node_id: rect2.data.id, field: "fill", variable_id: vid },
  { node_id: rect2.data.id, field: "cornerRadius", variable_id: vf.data.id },
  { node_id: "999:999", field: "fill", variable_id: vid },
] });
check("bind_variables batch (2 ok, 1 error)", bb.ok && bb.data.bound_count === 2 && bb.data.errors?.length === 1, bb.text);
const bv = await call("bind_variable", { node_id: rect.data.id, field: "fill", variable_id: vid });
check("bind_variable fill", bv.ok && bv.data.bound?.includes("fills[0].color"), bv.text);
const bg = await call("bind_variable", { node_id: rect.data.id, field: "cornerRadius", variable_id: vf.data.id });
check("bind_variable cornerRadius", bg.ok && bg.data.bound?.length === 4, bg.text);
const defs = await call("get_variable_defs", { node_id: rect.data.id });
check("get_variable_defs", defs.ok && defs.data.bindings?.some((l) => /smoke\/primary/.test(l)) && defs.data.bindings?.some((l) => /smoke\/gap/.test(l)), defs.text);
const spec2 = await call("get_node_spec", { node_id: rect.data.id });
check("get_node_spec shows {variable}", spec2.ok && /\{smoke\/primary\}/.test(spec2.text), spec2.text);

const zoom = await call("zoom_to", { node_ids: [rect.data.id] });
check("zoom_to", zoom.ok, zoom.text);

// cleanup
const del = await call("use_figma", {
  code: `
    for (const n of query(figma.currentPage, '[name^=smoke-]')) { try { n.remove(); } catch (e) {} }
    for (const n of query(figma.currentPage, '[name^=State=]')) { try { n.remove(); } catch (e) {} }
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    for (const c of cols) if (c.name === 'smoke-vars') c.remove();
    return 'cleaned';
  `,
});
check("cleanup", del.ok, del.text);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
