// Caption helpers shared by every variant: tones → colours, word timing (group-relative), pop scale.
import type { CaptionDNA, CaptionGroup, CaptionTone } from "@docmaker/core";
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
