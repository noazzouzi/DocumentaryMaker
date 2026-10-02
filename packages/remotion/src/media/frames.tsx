// Shared pieces of the framed layouts (card, pip, contain-blur): blurSelf backdrop, layout backdrops, entry animations.
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { LayoutParams, VisualSource } from "@docmaker/core";
import { useEnv } from "../data/env";
import { expoOut, prog } from "../lib/easing";
import { GeneratedBackdrop } from "./GeneratedBackdrop";
import { SourceView } from "./SourceView";

/** The same source cover-fit at 1.2×, blur(30px), brightness(.4) — the "blurSelf" backdrop. */
export const BlurSelf: React.FC<{ source: VisualSource; trimBefore: number }> = ({ source, trimBefore }) => (
  <AbsoluteFill style={{ transform: "scale(1.2)", filter: "blur(30px) brightness(0.4)" }}>
    <SourceView source={source} trimBefore={trimBefore} />
  </AbsoluteFill>
);

export const LayoutBackdrop: React.FC<{ recipe: LayoutParams["backdrop"]; seed: number; source: VisualSource; trimBefore: number }> = ({ recipe, seed, source, trimBefore }) => {
  const env = useEnv();
  if (recipe === "blurSelf") {
    if (source.kind === "image" || source.kind === "video") return <BlurSelf source={source} trimBefore={trimBefore} />;
    return <GeneratedBackdrop recipe="darkNoise" seed={seed} />;
  }
  const r = recipe === "gradientGrid" || recipe === "paper" || recipe === "darkNoise" ? recipe : env.tokens.tokens.backdrop === "blurSelf" ? "darkNoise" : env.tokens.tokens.backdrop;
  return <GeneratedBackdrop recipe={r} seed={seed} />;
};

/** Entry animation of a framed element at clip-local frame f (none | scale 0.9→1 in 10 f | tvOn | slide). */
export function frameEntryStyle(entry: LayoutParams["entry"], f: number): { transform: string; opacity: number; filter: string | undefined } {
  if (entry === "scale") {
    const p = prog(f, 0, 10, expoOut);
    return { transform: `scale(${(0.9 + 0.1 * p).toFixed(5)})`, opacity: Math.min(1, 0.35 + p), filter: undefined };
  }
  if (entry === "tvOn") {
    const sy = 0.02 + 0.98 * prog(f, 0, 5, expoOut);
    const sx = 1 + 0.08 * (1 - prog(f, 0, 3, expoOut));
    const b = 1 + 1.6 * (1 - prog(f, 1, 7));
    return { transform: `scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`, opacity: f < 0 ? 0 : 1, filter: b > 1.01 ? `brightness(${b.toFixed(3)})` : undefined };
  }
  if (entry === "slide") {
    const p = prog(f, 0, 12, expoOut);
    return { transform: `translateY(${(140 * (1 - p)).toFixed(2)}px)`, opacity: prog(f, 0, 6), filter: undefined };
  }
  return { transform: "none", opacity: 1, filter: undefined };
}
