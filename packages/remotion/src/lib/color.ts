// Tiny colour helpers for #RRGGBB / #RRGGBBAA tokens (Color schema). Pure.

export interface Rgba { r: number; g: number; b: number; a: number }

export function parseHex(hex: string, fallback = "#000000"): Rgba {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex) ?? /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(fallback);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const v = parseInt(m[1]!, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
const h2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
export const toHex = (c: Rgba): string => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;
export function rgba(hex: string, alpha = 1): string {
  const c = parseHex(hex);
  const a = Math.min(1, Math.max(0, c.a * alpha));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(a.toFixed(4))})`;
}
/** Linear sRGB-space mix of two colours (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}
export const darken = (hex: string, t: number): string => mixHex(hex, "#000000", t);
export const lighten = (hex: string, t: number): string => mixHex(hex, "#FFFFFF", t);
/** Relative luminance (WCAG) in [0,1]. */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}
/** Black or white, whichever reads better on `bg`. */
export const onColor = (bg: string): string => (luminance(bg) > 0.45 ? "#0E0F0E" : "#FFFFFF");
/** Channel values in [0,1] (for SVG feComponentTransfer tables). */
export function unitRgb(hex: string): [number, number, number] {
  const c = parseHex(hex);
  return [c.r / 255, c.g / 255, c.b / 255];
}
/** WCAG contrast ratio between two opaque colours, in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/**
 * `fg` itself when it reaches `min` contrast against every colour in `bgs`; otherwise `fg` mixed towards black or
 * white (whichever side the backgrounds leave more room on) by the smallest 5 % step that does — hue is kept as long
 * as possible, and the pure end (black/white) is the fallback.
 */
export function readableOn(fg: string, bgs: readonly string[], min = 4.5): string {
  const worst = (c: string) => Math.min(...bgs.map((b) => contrastRatio(c, b)));
  if (bgs.length === 0 || worst(fg) >= min) return fg;
  const meanLum = bgs.reduce((s, b) => s + luminance(b), 0) / bgs.length;
  const target = meanLum > 0.18 ? "#000000" : "#FFFFFF";
  for (let t = 0.05; t < 1; t += 0.05) {
    const c = mixHex(fg, target, t);
    if (worst(c) >= min) return c;
  }
  return target;
}
