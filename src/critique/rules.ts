// Deterministic design-critique rules over a Figma snapshot.
//
// Rule ids and most heuristics follow Impeccable's detector
// (github.com/pbakaus/impeccable, Apache-2.0), re-expressed for Figma nodes
// instead of HTML. Rules marked "figma-only" have no Impeccable counterpart.
// Every rule is a pure function: snapshot in, findings out.

import type { SnapNode, Snapshot } from "./snapshot.js";
import { contrast, hexToRgb, hslOf, isNeutral, over, rgbToHex, type Rgb } from "./color.js";

export type Severity = "primary" | "advisory";

export interface Finding {
  rule: string;
  severity: Severity;
  node: string;        // node id (or the root id for subtree-level findings)
  name: string;        // node name
  detail: string;      // the fact
  fix?: string;        // which tool to use
}

export interface RuleDef {
  id: string;
  severity: Severity;
  group: "typography" | "color" | "composition" | "text" | "design-system" | "figma";
  title: string;
  figmaOnly?: boolean;
  run: (ctx: Ctx) => Finding[];
}

// ---------------------------------------------------------------------------
// Context helpers

export class Ctx {
  readonly nodes: SnapNode[];
  readonly byId: Record<string, SnapNode>;
  readonly roots: SnapNode[];
  constructor(readonly snap: Snapshot) {
    this.byId = snap.nodes;
    this.nodes = Object.values(snap.nodes);
    this.roots = snap.context.rootIds.map((id) => snap.nodes[id]).filter(Boolean) as SnapNode[];
  }
  get visible(): SnapNode[] {
    return this.nodes.filter((n) => this.isVisible(n));
  }
  isVisible(n: SnapNode): boolean {
    let cur: SnapNode | undefined = n;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent ? this.byId[cur.parent] : undefined;
    }
    return true;
  }
  texts(): SnapNode[] {
    return this.visible.filter((n) => n.text && n.text.chars.trim().length > 0);
  }
  parent(n: SnapNode): SnapNode | undefined {
    return n.parent ? this.byId[n.parent] : undefined;
  }
  ancestors(n: SnapNode): SnapNode[] {
    const out: SnapNode[] = [];
    let p = this.parent(n);
    while (p) {
      out.push(p);
      p = this.parent(p);
    }
    return out;
  }
  children(n: SnapNode): SnapNode[] {
    return n.children.map((id) => this.byId[id]).filter(Boolean) as SnapNode[];
  }
  siblings(n: SnapNode): SnapNode[] {
    const p = this.parent(n);
    return p ? this.children(p) : this.roots;
  }
  rootOf(n: SnapNode): SnapNode {
    const a = this.ancestors(n);
    return a.length ? a[a.length - 1]! : n;
  }
  /** First visible SOLID fill of a node, composited to an opaque color if we know what is behind. */
  solidFill(n: SnapNode): { hex: string; alpha: number } | null {
    const p = (n.fills ?? []).find((f) => f.type === "SOLID" && f.hex);
    if (!p) return null;
    const alpha = (p.opacity ?? 1) * (n.opacity ?? 1);
    return { hex: p.hex!, alpha };
  }
  /** Opaque background behind a node: nearest ancestor solid fill, composited; white if none. */
  backgroundOf(n: SnapNode): Rgb {
    const layers: { hex: string; alpha: number }[] = [];
    for (const a of this.ancestors(n)) {
      const f = this.solidFill(a);
      if (f) {
        layers.push(f);
        if (f.alpha >= 0.99) break;
      }
    }
    let bg: Rgb = { r: 1, g: 1, b: 1 };
    for (const l of layers.reverse()) bg = over(hexToRgb(l.hex), l.alpha, bg);
    return bg;
  }
  isCardLike(n: SnapNode): boolean {
    if (!["FRAME", "RECTANGLE", "COMPONENT", "INSTANCE"].includes(n.type)) return false;
    const fill = this.solidFill(n);
    const hasFill = !!fill && fill.alpha > 0.05;
    const hasStroke = (n.strokes ?? []).length > 0;
    const hasShadow = (n.effects ?? []).some((e) => e.visible && e.type === "DROP_SHADOW");
    const r = typeof n.radius === "number" ? n.radius : Array.isArray(n.radius) ? Math.max(...n.radius) : 0;
    return hasFill && (r >= 4 || hasStroke || hasShadow) && n.w >= 80 && n.h >= 40;
  }
  fontSize(n: SnapNode): number | null {
    return n.text && typeof n.text.size === "number" ? n.text.size : null;
  }
  isHeading(n: SnapNode): boolean {
    const s = this.fontSize(n);
    return s !== null && s >= 24;
  }
}

const f = (rule: string, severity: Severity, n: SnapNode, detail: string, fix?: string): Finding => ({
  rule,
  severity,
  node: n.id,
  name: n.name,
  detail,
  fix,
});

const pct = (v: number) => `${Math.round(v * 100)}%`;
const uniq = <T>(a: T[]) => [...new Set(a)];

const BUZZWORDS = /\b(seamless(ly)?|effortless(ly)?|unlock|supercharge|elevate|empower|next[- ]level|revolutionary|cutting[- ]edge|game[- ]chang(er|ing)|leverage|synergy|all[- ]in[- ]one|10x|frictionless|world[- ]class|reimagine[d]?|unleash)\b/i;

// ---------------------------------------------------------------------------
// Rules

export const RULES: RuleDef[] = [
  // ---- typography ---------------------------------------------------------
  {
    id: "overused-font",
    severity: "advisory",
    group: "typography",
    title: "One font family does everything",
    run: (c) => {
      const texts = c.texts().filter((t) => t.text!.family !== "mixed");
      if (texts.length < 10) return [];
      const fams = new Map<string, number>();
      for (const t of texts) fams.set(t.text!.family, (fams.get(t.text!.family) ?? 0) + 1);
      const [top, count] = [...fams.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (count / texts.length < 0.95) return [];
      const headings = texts.filter((t) => c.isHeading(t));
      if (headings.length === 0) return [];
      return [f("overused-font", "advisory", c.roots[0]!, `${top} on ${pct(count / texts.length)} of ${texts.length} texts, headings included`, "pick a display face for headings: set_text / use_figma fontName")];
    },
  },
  {
    id: "flat-type-hierarchy",
    severity: "primary",
    group: "typography",
    title: "Type sizes barely differ",
    run: (c) => {
      const sizes = c.texts().map((t) => c.fontSize(t)).filter((s): s is number => s !== null);
      if (sizes.length < 6) return [];
      const distinct = uniq(sizes).sort((a, b) => a - b);
      const ratio = distinct[distinct.length - 1]! / distinct[0]!;
      // Two sizes are fine when they differ clearly (logo + labels); flag only a flat ladder.
      if (ratio < 1.5) {
        return [f("flat-type-hierarchy", "primary", c.roots[0]!, `${sizes.length} texts use sizes ${distinct.join("/")} (max/min ${ratio.toFixed(2)})`, "give headings a clear step up (1.5x+): use_figma fontSize")];
      }
      return [];
    },
  },
  {
    id: "oversized-h1",
    severity: "advisory",
    group: "typography",
    title: "Heading too large for its container",
    run: (c) =>
      c.texts().flatMap((t) => {
        const s = c.fontSize(t);
        const root = c.rootOf(t);
        if (s === null || s < 64 || root.w <= 0) return [];
        return s > root.w * 0.14 ? [f("oversized-h1", "advisory", t, `${s}px in a ${root.w}px wide frame`, "resize_node / fontSize ≤ 12% of width")] : [];
      }),
  },
  {
    id: "extreme-negative-tracking",
    severity: "primary",
    group: "typography",
    title: "Letter-spacing crushed",
    run: (c) =>
      c.texts().flatMap((t) => {
        const ls = t.text!.letterSpacing;
        const s = c.fontSize(t);
        if (!ls || ls === "mixed" || s === null) return [];
        const px = ls.unit === "PERCENT" ? (ls.value / 100) * s : ls.value;
        return px / s <= -0.05 ? [f("extreme-negative-tracking", "primary", t, `letterSpacing ${ls.value}${ls.unit === "PERCENT" ? "%" : "px"} at ${s}px`, "set letterSpacing between -2% and 0")] : [];
      }),
  },
  {
    id: "wide-tracking",
    severity: "advisory",
    group: "typography",
    title: "Wide tracking on body text",
    run: (c) =>
      c.texts().flatMap((t) => {
        const ls = t.text!.letterSpacing;
        const s = c.fontSize(t);
        if (!ls || ls === "mixed" || s === null || s < 15) return [];
        const px = ls.unit === "PERCENT" ? (ls.value / 100) * s : ls.value;
        const caps = t.text!.chars.length <= 24 && t.text!.chars === t.text!.chars.toUpperCase();
        return px / s >= 0.08 && !caps ? [f("wide-tracking", "advisory", t, `letterSpacing ${ls.value}${ls.unit === "PERCENT" ? "%" : "px"} on ${s}px body text`, "reserve wide tracking for short all-caps labels")] : [];
      }),
  },
  {
    id: "tight-leading",
    severity: "primary",
    group: "typography",
    title: "Line height too tight for body text",
    run: (c) =>
      c.texts().flatMap((t) => {
        const lh = t.text!.lineHeight;
        const s = c.fontSize(t);
        if (!lh || lh === "mixed" || s === null || s > 20 || t.text!.chars.length < 60) return [];
        const ratio = lh.unit === "PERCENT" ? lh.value / 100 : lh.value / s;
        return ratio < 1.2 ? [f("tight-leading", "primary", t, `line-height ${ratio.toFixed(2)}x at ${s}px over ${t.text!.chars.length} chars`, "lineHeight 1.4–1.6x for body: use_figma lineHeight = {unit:'PERCENT', value:150}")] : [];
      }),
  },
  {
    id: "line-length",
    severity: "advisory",
    group: "typography",
    title: "Lines too long to read",
    run: (c) =>
      c.texts().flatMap((t) => {
        const s = c.fontSize(t);
        if (s === null || t.text!.chars.length < 120) return [];
        const charsPerLine = t.w / (s * 0.5);
        return charsPerLine > 90 ? [f("line-length", "advisory", t, `~${Math.round(charsPerLine)} characters per line (${t.w}px at ${s}px)`, "narrow the text box: resize_node width ≈ 60–75 chars")] : [];
      }),
  },
  {
    id: "justified-text",
    severity: "advisory",
    group: "typography",
    title: "Justified text",
    run: (c) => c.texts().filter((t) => t.text!.align === "JUSTIFIED").map((t) => f("justified-text", "advisory", t, "textAlignHorizontal = JUSTIFIED", "use_figma textAlignHorizontal = 'LEFT'")),
  },
  {
    id: "tiny-text",
    severity: "primary",
    group: "typography",
    title: "Text below 11px",
    run: (c) => c.texts().flatMap((t) => { const s = c.fontSize(t); return s !== null && s < 11 ? [f("tiny-text", "primary", t, `${s}px`, "fontSize ≥ 12 (≥ 14 for body)")] : []; }),
  },
  {
    id: "heading-rhythm",
    severity: "advisory",
    group: "typography",
    title: "Type scale skips a step",
    run: (c) => {
      const sizes = uniq(c.texts().map((t) => c.fontSize(t)).filter((s): s is number => s !== null)).sort((a, b) => a - b);
      if (sizes.length < 3) return [];
      for (let i = 1; i < sizes.length; i++) {
        if (sizes[i]! / sizes[i - 1]! > 2.4 && sizes[i - 1]! >= 14) {
          return [f("heading-rhythm", "advisory", c.roots[0]!, `jump from ${sizes[i - 1]}px to ${sizes[i]}px with nothing between`, `add an intermediate size (e.g. ${Math.round(sizes[i - 1]! * 1.5)}px) for subheads`)];
        }
      }
      return [];
    },
  },
  {
    id: "gradient-text",
    severity: "primary",
    group: "typography",
    title: "Gradient-filled text",
    run: (c) => c.texts().filter((t) => (t.fills ?? []).some((p) => p.type === "GRADIENT")).map((t) => f("gradient-text", "primary", t, "text fill is a gradient", "set_fill with a solid color")),
  },
  {
    id: "mixed-fonts-in-text",
    severity: "advisory",
    group: "typography",
    title: "Several font families in one text layer",
    figmaOnly: true,
    run: (c) => c.texts().filter((t) => t.text!.family === "mixed" && (t.text!.families?.length ?? 0) > 1).map((t) => f("mixed-fonts-in-text", "advisory", t, `families: ${t.text!.families!.join(", ")}`, "split into separate text layers or unify: loadFontsFor + fontName")),
  },

  // ---- color ----------------------------------------------------------------
  {
    id: "low-contrast",
    severity: "primary",
    group: "color",
    title: "Text contrast below WCAG AA",
    run: (c) =>
      c.texts().flatMap((t) => {
        const fill = c.solidFill(t);
        const s = c.fontSize(t);
        if (!fill || s === null) return [];
        const bg = c.backgroundOf(t);
        const fg = over(hexToRgb(fill.hex), fill.alpha, bg);
        const ratio = contrast(fg, bg);
        const bold = /bold|black|heavy/i.test(t.text!.style);
        const large = s >= 24 || (s >= 19 && bold);
        const need = large ? 3 : 4.5;
        if (ratio >= need) return [];
        const sev: Severity = ratio >= need - 0.5 ? "advisory" : "primary";
        return [f("low-contrast", sev, t, `${rgbToHex(fg)} on ${rgbToHex(bg)} = ${ratio.toFixed(1)}:1 (need ${need}:1)`, "set_fill with a darker/lighter color, or change the background")];
      }),
  },
  {
    id: "gray-on-color",
    severity: "primary",
    group: "color",
    title: "Gray text on a colored background",
    run: (c) =>
      c.texts().flatMap((t) => {
        const fill = c.solidFill(t);
        if (!fill) return [];
        const fg = hslOf(fill.hex);
        const bg = hslOf(rgbToHex(c.backgroundOf(t)));
        if (fg.s < 0.08 && fg.l > 0.3 && fg.l < 0.8 && bg.s > 0.3 && bg.l > 0.15 && bg.l < 0.85) {
          return [f("gray-on-color", "primary", t, `gray ${fill.hex} on ${rgbToHex(c.backgroundOf(t))}`, "use a tint of the background hue or white/black: set_fill")];
        }
        return [];
      }),
  },
  {
    id: "ai-color-palette",
    severity: "primary",
    group: "color",
    title: "Purple-to-blue gradient",
    run: (c) =>
      c.visible.flatMap((n) => {
        const g = (n.fills ?? []).find((p) => p.type === "GRADIENT" && (p.stops?.length ?? 0) >= 2);
        if (!g || n.w * n.h < 10000) return [];
        const hues = g.stops!.filter((s) => !isNeutral(s.hex)).map((s) => hslOf(s.hex).h);
        const hasPurple = hues.some((h) => h >= 255 && h <= 300);
        const hasBlue = hues.some((h) => h >= 195 && h <= 245);
        return hasPurple && hasBlue ? [f("ai-color-palette", "primary", n, `gradient ${g.stops!.map((s) => s.hex).join(" → ")}`, "pick one brand hue; solid fill or a same-hue gradient")] : [];
      }),
  },
  {
    id: "cream-palette",
    severity: "advisory",
    group: "color",
    title: "Default cream background",
    run: (c) =>
      c.roots.flatMap((r) => {
        const fill = c.solidFill(r);
        if (!fill) return [];
        const { h, s, l } = hslOf(fill.hex);
        // Light tints read as highly saturated in HSL, so no upper bound on s.
        return h >= 25 && h <= 60 && s >= 0.12 && l >= 0.86 && l < 0.97 ? [f("cream-palette", "advisory", r, `background ${fill.hex}`, "choose a background on purpose (pure white, a brand tint, or a dark surface)")] : [];
      }),
  },
  {
    id: "dark-glow",
    severity: "advisory",
    group: "color",
    title: "Colored glow shadow",
    run: (c) =>
      c.visible.flatMap((n) =>
        (n.effects ?? [])
          .filter((e) => e.visible && e.type === "DROP_SHADOW" && e.radius >= 24 && e.hex && (e.a ?? 1) >= 0.25 && hslOf(e.hex).s > 0.4)
          .slice(0, 1)
          .map((e) => f("dark-glow", "advisory", n, `drop shadow ${e.hex} blur ${e.radius} alpha ${e.a}`, "use a neutral shadow with low alpha, or none")),
      ),
  },
  {
    id: "radial-halo",
    severity: "advisory",
    group: "color",
    title: "Radial halo / blurred blob",
    run: (c) =>
      c.visible.flatMap((n) => {
        const radial = (n.fills ?? []).some((p) => p.type === "GRADIENT" && p.gradient === "GRADIENT_RADIAL" && (p.stops ?? []).some((s) => s.a < 0.2));
        const blurredBlob = n.type === "ELLIPSE" && (n.effects ?? []).some((e) => e.visible && e.type === "LAYER_BLUR" && e.radius >= 40);
        return (radial && n.w * n.h > 40000) || blurredBlob ? [f("radial-halo", "advisory", n, radial ? "radial gradient fading to transparent" : "blurred ellipse", "remove decorative halos; let layout and type carry the hierarchy")] : [];
      }),
  },
  {
    id: "repeating-stripes-gradient",
    severity: "advisory",
    group: "color",
    title: "Striped / grid gradient background",
    run: (c) => c.visible.flatMap((n) => ((n.fills ?? []).some((p) => p.type === "GRADIENT" && (p.stops?.length ?? 0) >= 8) ? [f("repeating-stripes-gradient", "advisory", n, `gradient with ${(n.fills ?? []).find((p) => p.type === "GRADIENT")!.stops!.length} stops`, "replace with a flat surface")] : [])),
  },
  {
    id: "color-amount",
    severity: "advisory",
    group: "color",
    title: "Too many distinct hues",
    run: (c) => {
      const hues: number[] = [];
      for (const n of c.visible) for (const p of [...(n.fills ?? []), ...(n.strokes ?? [])]) if (p.type === "SOLID" && p.hex && !isNeutral(p.hex)) hues.push(hslOf(p.hex).h);
      const buckets = uniq(hues.map((h) => Math.round(h / 20)));
      return buckets.length > 6 ? [f("color-amount", "advisory", c.roots[0]!, `${buckets.length} distinct hue families across the subtree`, "limit to 1 brand hue + 1 accent + neutrals")] : [];
    },
  },

  // ---- composition ----------------------------------------------------------
  {
    id: "nested-cards",
    severity: "primary",
    group: "composition",
    title: "Card inside a card",
    run: (c) =>
      c.visible.flatMap((n) => {
        if (!c.isCardLike(n)) return [];
        const p = c.parent(n);
        if (!p || !c.isCardLike(p)) return [];
        const cardSiblings = c.children(p).filter((s) => c.isCardLike(s));
        const covers = (n.w * n.h) / Math.max(1, p.w * p.h);
        return cardSiblings.length <= 1 || covers > 0.6 ? [f("nested-cards", "primary", n, `card-like inside card-like "${p.name}" (${p.id}), covers ${pct(covers)}`, `flatten: remove the fill/stroke/radius of ${p.id} or of this node (set_fill, use_figma)`)] : [];
      }),
  },
  {
    id: "monotonous-spacing",
    severity: "advisory",
    group: "composition",
    title: "Every gap and padding identical",
    run: (c) => {
      const containers = c.visible.filter((n) => n.layout);
      if (containers.length < 6) return [];
      const values = new Set<number>();
      for (const n of containers) {
        values.add(n.layout!.gap);
        for (const p of n.layout!.pad) values.add(p);
      }
      values.delete(0);
      return values.size === 1 ? [f("monotonous-spacing", "advisory", c.roots[0]!, `all gaps/paddings = ${[...values][0]} across ${containers.length} containers`, "vary rhythm: tighter inside groups, wider between sections (set_auto_layout)")] : [];
    },
  },
  {
    id: "edge-flush-cards",
    severity: "advisory",
    group: "composition",
    title: "Cards flush with the frame edge",
    run: (c) =>
      c.roots.flatMap((r) => {
        if (r.w < 480) return [];
        return c.children(r)
          .filter((k) => c.isCardLike(k) && (k.x <= 0 || k.x + k.w >= r.w) && k.w < r.w * 0.98)
          .slice(0, 3)
          .map((k) => f("edge-flush-cards", "advisory", k, `touches the frame edge (x=${k.x}, w=${k.w} in ${r.w})`, "add horizontal padding on the container"));
      }),
  },
  {
    id: "icon-tile-stack",
    severity: "advisory",
    group: "composition",
    title: "Icon tile above every heading",
    run: (c) => {
      const hits: SnapNode[] = [];
      for (const n of c.visible) {
        if (!n.layout || n.layout.mode !== "VERTICAL") continue;
        const kids = c.children(n);
        for (let i = 0; i + 1 < kids.length; i++) {
          const tile = kids[i]!;
          const next = kids[i + 1]!;
          const r = typeof tile.radius === "number" ? tile.radius : 0;
          const square = Math.abs(tile.w - tile.h) <= 4 && tile.w <= 72 && r >= 6 && !!c.solidFill(tile);
          const hasIcon = c.children(tile).some((k) => ["VECTOR", "BOOLEAN_OPERATION", "FRAME", "INSTANCE"].includes(k.type));
          if (square && hasIcon && next.text && (c.fontSize(next) ?? 0) >= 16) hits.push(tile);
        }
      }
      return hits.length >= 2 ? [f("icon-tile-stack", "advisory", hits[0]!, `${hits.length} icon tiles stacked above headings`, "drop the tiles or make icons inline with the heading")] : [];
    },
  },
  {
    id: "hero-eyebrow-chip",
    severity: "advisory",
    group: "composition",
    title: "Pill chip above the hero heading",
    run: (c) => {
      for (const n of c.visible) {
        if (!n.layout || n.layout.mode !== "VERTICAL") continue;
        const kids = c.children(n);
        for (let i = 0; i + 1 < kids.length; i++) {
          const chip = kids[i]!;
          const next = kids[i + 1]!;
          const r = typeof chip.radius === "number" ? chip.radius : 0;
          const isChip = chip.h <= 36 && r >= chip.h / 2 - 1 && !!c.solidFill(chip) && c.children(chip).some((k) => k.text);
          if (isChip && next.text && (c.fontSize(next) ?? 0) >= 32) {
            return [f("hero-eyebrow-chip", "advisory", chip, `pill "${chip.name}" directly above a ${c.fontSize(next)}px heading`, "say it in the heading or the body instead of a badge")];
          }
        }
      }
      return [];
    },
  },
  {
    id: "numbered-section-labels",
    severity: "advisory",
    group: "composition",
    title: "“01 / 02 / 03” section labels",
    run: (c) => {
      const hits = c.texts().filter((t) => /^0\d$|^\d{2}\s*[\/—–-]/.test(t.text!.chars.trim()));
      return hits.length >= 2 ? [f("numbered-section-labels", "advisory", hits[0]!, `${hits.length} numbered labels (${hits.map((h) => `"${h.text!.chars.trim()}"`).slice(0, 3).join(", ")})`, "remove the numbers unless order matters to the reader")] : [];
    },
  },
  {
    id: "text-occlusion",
    severity: "primary",
    group: "composition",
    title: "Text covered by a later sibling",
    run: (c) =>
      c.texts().flatMap((t) => {
        const sibs = c.siblings(t);
        const idx = sibs.indexOf(t);
        for (const s of sibs.slice(idx + 1)) {
          if (!c.isVisible(s) || !c.solidFill(s) || (c.solidFill(s)!.alpha < 0.8)) continue;
          const ox = Math.max(0, Math.min(t.ax + t.w, s.ax + s.w) - Math.max(t.ax, s.ax));
          const oy = Math.max(0, Math.min(t.ay + t.h, s.ay + s.h) - Math.max(t.ay, s.ay));
          const cover = (ox * oy) / Math.max(1, t.w * t.h);
          if (cover > 0.3) return [f("text-occlusion", "primary", t, `${pct(cover)} covered by "${s.name}" (${s.id})`, "reorder layers or move the text: move_node / use_figma")];
        }
        return [];
      }),
  },
  {
    id: "clipped-overflow-container",
    severity: "advisory",
    group: "composition",
    title: "Children clipped by the container",
    run: (c) =>
      c.visible.flatMap((n) => {
        if (!n.clips) return [];
        const out = c.children(n).filter((k) => c.isVisible(k) && (k.x < -4 || k.y < -4 || k.x + k.w > n.w + 4 || k.y + k.h > n.h + 4));
        return out.length ? [f("clipped-overflow-container", "advisory", n, `${out.length} child(ren) extend past the clipped bounds, e.g. "${out[0]!.name}" (${out[0]!.id})`, "resize the container or the child; check for truncated content")] : [];
      }),
  },
  {
    id: "text-overflow",
    severity: "primary",
    group: "composition",
    title: "Text wider than its container or truncated",
    run: (c) =>
      c.texts().flatMap((t) => {
        if (t.text!.truncation === "ENDING") return [f("text-overflow", "primary", t, "textTruncation = ENDING (content is cut)", "widen the box or shorten the copy")];
        const p = c.parent(t);
        if (!p || p.type === "PAGE" || t.positioning === "ABSOLUTE") return [];
        const over = t.x + t.w - p.w;
        return over > 2 && p.layout ? [f("text-overflow", "primary", t, `sticks ${Math.round(over)}px out of "${p.name}"`, "layoutSizingHorizontal = 'FILL' + textAutoResize = 'HEIGHT', or resize_node")] : [];
      }),
  },
  {
    id: "absolute-in-autolayout",
    severity: "advisory",
    group: "composition",
    title: "Absolute-positioned child inside auto-layout",
    figmaOnly: true,
    run: (c) => c.visible.filter((n) => n.positioning === "ABSOLUTE" && c.parent(n)?.layout).slice(0, 5).map((n) => f("absolute-in-autolayout", "advisory", n, `absolute inside auto-layout "${c.parent(n)!.name}"`, "let auto-layout place it, or move overlays into their own layer")),
  },
  {
    id: "off-grid-spacing",
    severity: "advisory",
    group: "composition",
    title: "Spacing off the 4px grid",
    figmaOnly: true,
    run: (c) => {
      const off: { n: SnapNode; v: number }[] = [];
      for (const n of c.visible) {
        if (!n.layout) continue;
        for (const v of [n.layout.gap, ...n.layout.pad]) if (v > 0 && v % 4 !== 0) off.push({ n, v });
      }
      return off.length >= 3 ? [f("off-grid-spacing", "advisory", off[0]!.n, `${off.length} gap/padding values off the 4px grid (e.g. ${uniq(off.map((o) => o.v)).slice(0, 5).join(", ")})`, "set_auto_layout with multiples of 4 (8/12/16/24/32)")] : [];
    },
  },
  {
    id: "inconsistent-radius",
    severity: "advisory",
    group: "composition",
    title: "Sibling cards with different corner radii",
    figmaOnly: true,
    run: (c) => {
      const out: Finding[] = [];
      for (const n of c.visible) {
        const cards = c.children(n).filter((k) => c.isCardLike(k));
        if (cards.length < 2) continue;
        const radii = uniq(cards.map((k) => (typeof k.radius === "number" ? k.radius : Array.isArray(k.radius) ? k.radius[0]! : 0)));
        if (radii.length > 1) out.push(f("inconsistent-radius", "advisory", n, `cards in "${n.name}" use radii ${radii.join("/")}`, "use one radius token: set cornerRadius or bind_variable"));
      }
      return out.slice(0, 5);
    },
  },
  {
    id: "small-tap-target",
    severity: "advisory",
    group: "composition",
    title: "Interactive element smaller than 44px",
    figmaOnly: true,
    run: (c) =>
      c.visible
        .filter((n) => /\b(button|btn|cta|chip|tab|toggle|checkbox|radio|icon[- ]?button)\b/i.test(n.name) && ["FRAME", "INSTANCE", "COMPONENT", "GROUP"].includes(n.type))
        .filter((n) => n.h < 32 || (n.w < 44 && n.h < 44))
        .slice(0, 5)
        .map((n) => f("small-tap-target", "advisory", n, `${n.w}x${n.h}px`, "min height 40–44px: resize_node")),
  },

  // ---- text -----------------------------------------------------------------
  {
    id: "em-dash-overuse",
    severity: "advisory",
    group: "text",
    title: "Em dashes everywhere",
    run: (c) => {
      const hits = c.texts().filter((t) => /—/.test(t.text!.chars));
      return hits.length >= 3 ? [f("em-dash-overuse", "advisory", hits[0]!, `${hits.length} texts contain “—”`, "rewrite with commas, colons or two sentences: set_text")] : [];
    },
  },
  {
    id: "marketing-buzzword",
    severity: "advisory",
    group: "text",
    title: "Marketing buzzwords",
    run: (c) => c.texts().filter((t) => BUZZWORDS.test(t.text!.chars)).slice(0, 5).map((t) => f("marketing-buzzword", "advisory", t, `“${t.text!.chars.match(BUZZWORDS)![0]}” in “${t.text!.chars.slice(0, 50)}”`, "say what it does: set_text")),
  },
  {
    id: "aphoristic-cadence",
    severity: "advisory",
    group: "text",
    title: "“Simple. Fast. Done.” cadence",
    run: (c) => {
      const hits = c.texts().filter((t) => /^(\S+\.\s*){3,}$/.test(t.text!.chars.trim()) || /^(\S+\.\s*){2}$/.test(t.text!.chars.trim()));
      return hits.length >= 1 ? hits.slice(0, 3).map((t) => f("aphoristic-cadence", "advisory", t, `“${t.text!.chars.trim().slice(0, 60)}”`, "write a sentence with a verb: set_text")) : [];
    },
  },
  {
    id: "repeated-container-text",
    severity: "advisory",
    group: "text",
    title: "Same copy repeated across cards",
    run: (c) => {
      const out: Finding[] = [];
      for (const n of c.visible) {
        const kids = c.children(n);
        if (kids.length < 3) continue;
        const counts = new Map<string, number>();
        for (const k of kids) for (const t of c.texts().filter((t) => c.ancestors(t).includes(k))) {
          const s = t.text!.chars.trim();
          if (s.length >= 12) counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        for (const [s, cnt] of counts) if (cnt >= 3) { out.push(f("repeated-container-text", "advisory", n, `“${s.slice(0, 50)}” repeated in ${cnt} children of "${n.name}"`, "write distinct copy per item: set_text")); break; }
      }
      return out.slice(0, 3);
    },
  },
  {
    id: "lorem-placeholder",
    severity: "advisory",
    group: "text",
    title: "Lorem ipsum left in",
    figmaOnly: true,
    run: (c) => c.texts().filter((t) => /lorem ipsum|dolor sit amet/i.test(t.text!.chars)).slice(0, 3).map((t) => f("lorem-placeholder", "advisory", t, "placeholder copy", "replace with real or realistic copy: set_text")),
  },

  // ---- design system --------------------------------------------------------
  {
    id: "design-system-color",
    severity: "advisory",
    group: "design-system",
    title: "Hardcoded colors while color variables exist",
    run: (c) => {
      const vars = c.snap.context.colorVariables;
      if (vars.length < 3) return [];
      const known = new Set(vars.map((v) => v.hex.toLowerCase()));
      const offenders = c.visible.filter((n) => [...(n.fills ?? []), ...(n.strokes ?? [])].some((p) => p.type === "SOLID" && p.hex && !p.bound && !n.fillStyle && !known.has(p.hex.toLowerCase())));
      return offenders.length >= 5 ? [f("design-system-color", "advisory", offenders[0]!, `${offenders.length} nodes use colors that match no variable (e.g. ${uniq(offenders.map((n) => c.solidFill(n)?.hex ?? "")).filter(Boolean).slice(0, 4).join(", ")}) while ${vars.length} color variables exist`, "bind_variable(node, 'fill', variable_id) or use a variable's color")] : [];
    },
  },
  {
    id: "design-system-font",
    severity: "advisory",
    group: "design-system",
    title: "Texts without a text style while styles exist",
    run: (c) => {
      if (c.snap.context.textStyles < 2) return [];
      const loose = c.texts().filter((t) => !t.text!.styleId);
      return loose.length >= 5 ? [f("design-system-font", "advisory", loose[0]!, `${loose.length} texts have no text style; the file defines ${c.snap.context.textStyles}`, "apply the matching text style (use_figma textStyleId) or set a consistent size/weight")] : [];
    },
  },
  {
    id: "design-system-number",
    severity: "advisory",
    group: "design-system",
    title: "Hardcoded radius/spacing while number variables exist",
    run: (c) => {
      const vars = c.snap.context.numberVariables;
      if (vars.length < 2) return [];
      const known = new Set(vars.map((v) => v.value));
      let radius = 0, spacing = 0;
      for (const n of c.visible) {
        if (typeof n.radius === "number" && n.radius > 0 && !n.radiusBound && !known.has(n.radius)) radius++;
        if (n.layout && !n.layout.gapBound && n.layout.gap > 0 && !known.has(n.layout.gap)) spacing++;
      }
      return radius + spacing >= 5 ? [f("design-system-number", "advisory", c.roots[0]!, `${radius} radii and ${spacing} gaps use values that match no number variable (${vars.length} exist)`, "bind_variable(node, 'cornerRadius' | 'itemSpacing', variable_id)")] : [];
    },
  },

  // ---- figma hygiene --------------------------------------------------------
  {
    id: "unnamed-layers",
    severity: "advisory",
    group: "figma",
    title: "Default layer names",
    figmaOnly: true,
    run: (c) => {
      const hits = c.visible.filter((n) => ["FRAME", "GROUP", "COMPONENT", "SECTION"].includes(n.type) && /^(Frame|Group|Component|Section) \d+$/.test(n.name) && n.children.length > 0);
      return hits.length >= 5 ? [f("unnamed-layers", "advisory", hits[0]!, `${hits.length} containers still named "Frame N" / "Group N"`, "rename_node with what they are (Header, Card, Actions)")] : [];
    },
  },
  {
    id: "hidden-layers",
    severity: "advisory",
    group: "figma",
    title: "Hidden layers left behind",
    figmaOnly: true,
    run: (c) => {
      const hidden = c.nodes.filter((n) => !n.visible && (!n.parent || c.isVisible(c.byId[n.parent]!)));
      return hidden.length >= 1 ? [f("hidden-layers", "advisory", hidden[0]!, `${hidden.length} hidden layer(s), e.g. "${hidden[0]!.name}"`, "delete_nodes if they are leftovers")] : [];
    },
  },
];

export const RULE_IDS = RULES.map((r) => r.id);

export function runRules(snap: Snapshot, opts: { rules?: string[]; minSeverity?: Severity } = {}): Finding[] {
  const ctx = new Ctx(snap);
  const selected = opts.rules?.length ? RULES.filter((r) => opts.rules!.includes(r.id)) : RULES;
  const out: Finding[] = [];
  for (const r of selected) {
    try {
      out.push(...r.run(ctx));
    } catch (err) {
      out.push({ rule: r.id, severity: "advisory", node: snap.context.rootIds[0] ?? "", name: "(rule error)", detail: err instanceof Error ? err.message : String(err) });
    }
  }
  const filtered = opts.minSeverity === "primary" ? out.filter((x) => x.severity === "primary") : out;
  return filtered.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "primary" ? -1 : 1));
}
