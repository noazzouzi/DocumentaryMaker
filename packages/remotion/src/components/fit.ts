// Text fitting after FontGate (§10.10): measureText/fitText never run before fonts are loaded. Falls back to a
// character-width estimate when measuring is impossible (no DOM, e.g. unit tests).
import { fitText, measureText } from "@remotion/layout-utils";

const AVG_EM: Record<string, number> = { Anton: 0.46, "Archivo Black": 0.68, Inter: 0.58, "JetBrains Mono": 0.6, "Courier Prime": 0.6, "Instrument Serif": 0.45, "Special Elite": 0.6 };
const estimateWidth = (text: string, family: string, size: number): number => text.length * (AVG_EM[family] ?? 0.58) * size;

/** Largest font size ≤ max at which `text` fits `width` on one line (≥ min). */
export function fitFontSize(text: string, o: { family: string; weight?: number; width: number; max: number; min?: number; uppercase?: boolean; letterSpacingEm?: number }): number {
  const min = o.min ?? 12;
  const t = o.uppercase ? text.toUpperCase() : text;
  if (!t) return o.max;
  let size: number;
  try {
    if (typeof document === "undefined") throw new Error("no DOM");
    size = fitText({
      text: t, withinWidth: o.width, fontFamily: o.family, fontWeight: o.weight ?? 400,
      letterSpacing: o.letterSpacingEm ? `${o.letterSpacingEm}em` : undefined, textTransform: o.uppercase ? "uppercase" : undefined,
    }).fontSize;
  } catch {
    size = (o.width / Math.max(1, estimateWidth(t, o.family, 1))) * (1 - (o.letterSpacingEm ?? 0));
  }
  if (!Number.isFinite(size)) size = o.max;
  return Math.max(min, Math.min(o.max, Math.floor(size)));
}

/** Measured single-line width (px) of `text` at `size`, with the same fallback. */
export function textWidth(text: string, o: { family: string; weight?: number; size: number; uppercase?: boolean }): number {
  const t = o.uppercase ? text.toUpperCase() : text;
  try {
    if (typeof document === "undefined") throw new Error("no DOM");
    return measureText({ text: t, fontFamily: o.family, fontSize: o.size, fontWeight: o.weight ?? 400, textTransform: o.uppercase ? "uppercase" : undefined }).width;
  } catch {
    return estimateWidth(t, o.family, o.size);
  }
}
