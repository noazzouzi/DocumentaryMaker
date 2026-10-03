// Headline legibility helpers (pure): text colours that hold contrast on a generated backdrop (light "paper" needs
// ink, not the near-white palette text), and a line height that leaves room for accented capitals (FR "DUPÉ").
import type { StyleRenderTokens } from "@docmaker/core";
import { contrastRatio, darken, mixHex, readableOn, rgba } from "./color";

export type HeadlineBackdrop = "gradientGrid" | "paper" | "darkNoise" | "keywordCard";

/** The colours a backdrop recipe paints under centred text (its lightest and darkest regions). */
export function backdropTones(recipe: HeadlineBackdrop, tokens: StyleRenderTokens): string[] {
  const p = tokens.tokens.palette;
  switch (recipe) {
    case "paper": // radial paper → 12 % darker edge, multiply grain on top
      return [p.paper, darken(p.paper, 0.2)];
    case "gradientGrid":
      return [darken(mixHex(p.danger, p.secondary, 0.3), 0.55), darken(mixHex(p.danger, p.accent, 0.45), 0.22)];
    default:
      return [p.ink, mixHex(p.ink, "#FFFFFF", 0.07)];
  }
}

export interface HeadlineColors {
  /** True when the backdrop is light (dark text on it). */
  light: boolean;
  title: string;
  kicker: string;
  /** A text-shadow that separates the title from the backdrop without muddying dark-on-light type. */
  shadow: string;
}

/**
 * Light backdrops (paper) get ink for the title and the accent — darkened until it reads at ≥ 4.5:1 — for the kicker;
 * dark backdrops keep the palette's near-white text (unchanged look) under a dark shadow.
 */
export function headlineColors(recipe: HeadlineBackdrop, tokens: StyleRenderTokens, accent: string): HeadlineColors {
  const p = tokens.tokens.palette;
  const tones = backdropTones(recipe, tokens);
  const worst = (c: string) => Math.min(...tones.map((t) => contrastRatio(c, t)));
  const light = worst(p.ink) > worst(p.text);
  if (!light) return { light, title: p.text, kicker: rgba(p.text, 0.85), shadow: `0 12px 50px ${rgba("#000000", 0.6)}` };
  return { light, title: p.ink, kicker: readableOn(accent, tones, 4.5), shadow: `0 6px 26px ${rgba(p.paper, 0.55)}` };
}

// Combining marks that sit ABOVE the base letter (after NFD): grave…comma-above, horn, the Greek/IPA above range.
const CAP_DIACRITIC = /\p{Lu}[̀-̛̽̕̚-̈́͆͊-͌͐-͒͗͛ͣ-ͯ]/u;

/** True when the text holds an upper-case letter with a mark above it (É, À, Ô, Ï, Å…). */
export const hasCapitalDiacritic = (s: string): boolean => CAP_DIACRITIC.test(s.normalize("NFD"));

/** Minimum headline line height when any line carries an accented capital (the accent clears the line above). */
export const ACCENT_LINE_HEIGHT = 1.14;

/** `base` line height, raised to ACCENT_LINE_HEIGHT when any line carries an accented capital. */
export function headlineLineHeight(lines: readonly string[] | string, base: number): number {
  const all = typeof lines === "string" ? [lines] : lines;
  return all.some(hasCapitalDiacritic) ? Math.max(base, ACCENT_LINE_HEIGHT) : base;
}
