// Helpers for building snippets that run inside the Figma plugin sandbox.
// These are interpolated into JS strings sent through `use_figma`-style exec.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parses #RGB, #RGBA, #RRGGBB, #RRGGBBAA into Figma's 0..1 RGB + alpha.
 */
export function parseColor(input: string): Rgba {
  const m = input.trim().match(/^#([0-9a-fA-F]{3,8})$/);
  if (!m) {
    throw new Error(
      `Invalid color '${input}'. Expected hex like #0d99ff or #0d99ffcc.`,
    );
  }
  let hex = m[1]!;
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (hex.length !== 6 && hex.length !== 8) {
    throw new Error(`Invalid color '${input}'. Use 3, 4, 6, or 8 hex digits.`);
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

/** Safe JS-literal encoding via JSON. */
export function J(value: unknown): string {
  return JSON.stringify(value);
}

/** Produces JS that builds a Figma SOLID fill array from a Rgba. */
export function solidFillExpr(c: Rgba): string {
  return `[{ type: 'SOLID', color: { r: ${c.r}, g: ${c.g}, b: ${c.b} }, opacity: ${c.a} }]`;
}

/**
 * JS snippet that resolves a node id into a local `n` (or custom name) and
 * throws if not found.
 */
export function resolveNode(id: string, varname = "n"): string {
  return `const ${varname} = await figma.getNodeByIdAsync(${J(id)}); if (!${varname}) throw new Error('Node not found: ' + ${J(id)});`;
}

/**
 * JS snippet that appends `varname` to the given parent (by id) or to
 * the current page if no parent is specified.
 */
export function appendToParent(varname: string, parentId?: string): string {
  if (!parentId) {
    return `figma.currentPage.appendChild(${varname});`;
  }
  return `const __parent = await figma.getNodeByIdAsync(${J(parentId)}); if (!__parent) throw new Error('Parent not found: ' + ${J(parentId)}); if (!('appendChild' in __parent)) throw new Error('Parent does not accept children: ' + __parent.type); __parent.appendChild(${varname});`;
}

/** Minimal summary returned by most write tools. */
export function summaryReturn(varname = "n"): string {
  return `return { id: ${varname}.id, name: ${varname}.name, type: ${varname}.type };`;
}
