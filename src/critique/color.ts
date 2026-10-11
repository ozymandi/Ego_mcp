// Small color helpers for the critique rules: hex <-> rgb, HSL, WCAG contrast.

export interface Rgb { r: number; g: number; b: number } // 0..1

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4) };
}

export function rgbToHex(c: Rgb): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Composites `fg` with alpha `a` over `bg`. */
export function over(fg: Rgb, a: number, bg: Rgb): Rgb {
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
}

export function luminance(c: Rgb): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Hsl { h: number; s: number; l: number } // h 0..360, s/l 0..1

export function toHsl(c: Rgb): Hsl {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === c.r) h = ((c.g - c.b) / d + (c.g < c.b ? 6 : 0)) * 60;
  else if (max === c.g) h = ((c.b - c.r) / d + 2) * 60;
  else h = ((c.r - c.g) / d + 4) * 60;
  return { h, s, l };
}

export const hslOf = (hex: string): Hsl => toHsl(hexToRgb(hex));

export function isNeutral(hex: string): boolean {
  const { s, l } = hslOf(hex);
  return s < 0.1 || l < 0.08 || l > 0.95;
}

/** Hue distance on the circle. */
export function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
