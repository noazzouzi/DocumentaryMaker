// Font registry (§10.10): exactly core BUILTIN_FONTS (unit-tested), plus weight resolution so single-weight display
// faces (Anton, Archivo Black) are never faux-bolded by the browser.
import { BUILTIN_FONTS } from "@docmaker/core";

export const FONT_REGISTRY: readonly { family: string; weights: readonly number[]; italic: boolean }[] = BUILTIN_FONTS.map((f) => ({
  family: f.family, weights: f.weights, italic: f.italic,
}));

/** Closest registered weight of `family` to `wanted` (unknown families keep `wanted`). */
export function fontWeightFor(family: string, wanted: number): number {
  const f = FONT_REGISTRY.find((x) => x.family === family);
  if (!f || f.weights.length === 0) return wanted;
  let best = f.weights[0]!;
  for (const w of f.weights) if (Math.abs(w - wanted) < Math.abs(best - wanted)) best = w;
  return best;
}

/** Every family × weight × style the FontGate waits for. */
export function fontFaces(): { family: string; weight: number; style: "normal" | "italic" }[] {
  const out: { family: string; weight: number; style: "normal" | "italic" }[] = [];
  for (const f of FONT_REGISTRY) {
    for (const w of f.weights) out.push({ family: f.family, weight: w, style: "normal" });
    if (f.italic) for (const w of f.weights) out.push({ family: f.family, weight: w, style: "italic" });
  }
  return out;
}
