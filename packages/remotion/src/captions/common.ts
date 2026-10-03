// Caption helpers shared by every variant: tones → colours, word timing (group-relative), pop scale.
import type { CaptionDNA, CaptionGroup, CaptionTone } from "@docmaker/core";
import { textWidth } from "../components/fit";
import { clamp01, expoOut } from "../lib/easing";

export function toneColor(dna: CaptionDNA, tone: CaptionTone, hero: boolean): string {
  if (tone === "keyword") return dna.keywordColor;
  if (tone === "money") return dna.moneyColor;
  if (tone === "danger") return dna.dangerColor;
  return hero ? dna.keywordColor : dna.color;
}

/** Pop scale of a word: popFrom → 1.0 over popFrames from its start (expo.out); 1 before/after. */
export function popScale(dna: Pick<CaptionDNA, "popFrom" | "popFrames">, localFromWordStart: number): number {
  if (localFromWordStart < 0) return 1;
  const p = expoOut(clamp01(localFromWordStart / Math.max(1, dna.popFrames)));
  return dna.popFrom + (1 - dna.popFrom) * p;
}

/** Words with group-relative start frames (word.from − group.from), clamped into the group. */
export function relWords(g: CaptionGroup): { text: string; at: number; dur: number; tone: CaptionTone; hero: boolean }[] {
  return g.words.map((w) => ({ text: w.text, at: Math.max(0, w.from - g.from), dur: Math.max(1, w.dur), tone: w.tone, hero: w.hero }));
}

export const captionText = (s: string, dna: Pick<CaptionDNA, "uppercase">, locale: string): string => (dna.uppercase ? s.toLocaleUpperCase(locale) : s);

/**
 * Horizontal margin (px, each side) that keeps a word drawn at a steady scale > 1 (hero words) from overlapping its
 * neighbours: scale() grows the glyphs about the centre without changing the flex layout.
 */
export function heroMargin(text: string, o: { family: string; weight: number; size: number; scale: number }): number {
  if (!(o.scale > 1)) return 0;
  return (textWidth(text, { family: o.family, weight: o.weight, size: o.size }) * (o.scale - 1)) / 2;
}

/** Gap between caption words: a word space plus the outside half of both neighbours' strokes. */
export const wordGap = (size: number, strokePx: number, em = 0.25): number => size * em + Math.max(0, strokePx);
