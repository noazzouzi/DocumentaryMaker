// Generated backdrops (§10.7): gradientGrid (dark pink→orange + 150 px grid, 2.5 px lines, 5–9 % dark overlay), paper,
// darkNoise, keywordCard (big Anton text) — each drifting on its own (≈ 8 px/s, +1 %/10 s scale), seeded, plus the
// theme texture overlay. Used by generated sources, card/pip backdrops, chapter cards and title stings.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { StyleRenderTokens } from "@docmaker/core";
import { fontStack, useEnv } from "../data/env";
import { darken, mixHex, rgba } from "../lib/color";
import { hash01 } from "../lib/random";
import { upper } from "../lib/text";
import { NoiseCanvas } from "./NoiseCanvas";

export type BackdropRecipe = "gradientGrid" | "paper" | "darkNoise" | "keywordCard";

export interface GeneratedBackdropProps {
  recipe: BackdropRecipe;
  seed: number;
  palette?: readonly string[] | null;
  text?: string;
  /** Drift on the enclosing Sequence's clock (default true). */
  drift?: boolean;
  /** Skip the theme texture overlay (e.g. when the caller adds its own). */
  noTexture?: boolean;
}

/** Default two-colour palette per recipe from the style tokens. */
export function defaultPalette(recipe: BackdropRecipe, tokens: StyleRenderTokens): string[] {
  const p = tokens.tokens.palette;
  switch (recipe) {
    case "gradientGrid":
      return [darken(mixHex(p.danger, p.secondary, 0.3), 0.55), darken(mixHex(p.danger, p.accent, 0.45), 0.22)];
    case "paper":
      return [p.paper, darken(p.paper, 0.12)];
    default:
      return [p.ink, mixHex(p.ink, "#FFFFFF", 0.07)];
  }
}

/** Bounded wandering drift (px) and slow push (scale) for a backdrop at local time t (s). */
export function backdropDrift(seed: number, tSec: number): { dx: number; dy: number; scale: number } {
  const ang = hash01(seed, "drift-dir") * Math.PI * 2;
  const A = 110; // amplitude (px); A·ω ≈ 8 px/s
  const w = 8 / A;
  const ph = hash01(seed, "drift-ph") * Math.PI * 2;
  const s = Math.sin(tSec * w + ph) - Math.sin(ph);
  return { dx: Math.cos(ang) * A * s, dy: Math.sin(ang) * A * s, scale: Math.min(1.06, 1 + 0.001 * tSec) };
}

export const TextureOverlay: React.FC<{ texture: string | null | undefined; seed: number }> = ({ texture, seed }) => {
  if (!texture || texture === "none") return null;
  if (texture === "paper") return <NoiseCanvas seed={seed} kind="paper" opacity={0.14} blend="multiply" />;
  if (texture === "film") return <NoiseCanvas seed={seed} kind="grain" opacity={0.08} blend="overlay" />;
  if (texture === "scanlines")
    return <AbsoluteFill style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 2px, transparent 2px, transparent 4px)" }} />;
  if (texture === "halftone")
    return <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.22) 1.2px, transparent 1.7px)", backgroundSize: "8px 8px", mixBlendMode: "multiply" }} />;
  return null;
};

export const GeneratedBackdrop: React.FC<GeneratedBackdropProps> = ({ recipe, seed, palette, text, drift = true, noTexture }) => {
  const env = useEnv();
  const frame = useCurrentFrame();
  const tSec = drift ? Math.max(0, frame) / env.fps : 0;
  const { dx, dy, scale } = backdropDrift(seed, tSec);
  const pal = palette && palette.length >= 2 ? palette : defaultPalette(recipe, env.tokens);
  const c0 = pal[0]!;
  const c1 = pal[1]!;
  const c2 = pal[2] ?? c1;
  const ink = env.tokens.tokens.palette.ink;
  const layer: React.CSSProperties = { position: "absolute", inset: "-12%", transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(5)})` };

  let body: React.ReactNode;
  if (recipe === "gradientGrid") {
    const darkOverlay = 0.05 + 0.04 * hash01(seed, "grid-dark");
    const gx = (dx * 0.6) % 150;
    const gy = (dy * 0.6) % 150;
    body = (
      <>
        <div style={{ ...layer, background: `linear-gradient(${(120 + hash01(seed, "grad") * 40).toFixed(1)}deg, ${c0} 0%, ${mixHex(c0, c1, 0.55)} 55%, ${c2} 100%)` }} />
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${rgba("#FFFFFF", 0.11)} 2.5px, transparent 2.5px), linear-gradient(90deg, ${rgba("#FFFFFF", 0.11)} 2.5px, transparent 2.5px)`,
            backgroundSize: "150px 150px",
            backgroundPosition: `${gx.toFixed(2)}px ${gy.toFixed(2)}px`,
          }}
        />
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, transparent 35%, ${rgba("#000000", 0.35)} 100%)` }} />
        <AbsoluteFill style={{ backgroundColor: rgba("#000000", darkOverlay) }} />
        <NoiseCanvas seed={seed} kind="grain" opacity={0.06} blend="overlay" />
      </>
    );
  } else if (recipe === "paper") {
    body = (
      <>
        <div style={{ ...layer, background: `radial-gradient(ellipse at 45% 40%, ${c0} 0%, ${mixHex(c0, c1, 0.6)} 75%, ${c1} 100%)` }} />
        <div style={layer}>
          <NoiseCanvas seed={seed} kind="paper" opacity={0.55} blend="multiply" />
        </div>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 55%, ${rgba("#3b2f1e", 0.28)} 100%)` }} />
      </>
    );
  } else {
    // darkNoise and keywordCard share the dark textured base
    body = (
      <>
        <div style={{ ...layer, background: `radial-gradient(ellipse at ${(40 + 20 * hash01(seed, "cx")).toFixed(1)}% 42%, ${c1} 0%, ${mixHex(c0, c1, 0.4)} 45%, ${c0} 100%)` }} />
        <div style={layer}>
          <NoiseCanvas seed={seed} kind="grain" opacity={0.11} blend="screen" />
        </div>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 45%, ${rgba("#000000", 0.5)} 100%)` }} />
      </>
    );
  }
  const kw = recipe === "keywordCard" && text ? upper(text, env.locale) : null;
  const fontSize = kw ? Math.round(Math.max(90, Math.min(260, 1650 / Math.max(1, kw.length * 0.5)))) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: ink, overflow: "hidden" }}>
      {body}
      {kw ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 120px" }}>
          <div
            style={{
              fontFamily: fontStack(env.tokens, "headline"), fontSize, lineHeight: 1.0, color: env.tokens.tokens.palette.text, textAlign: "center",
              letterSpacing: "0.01em", textShadow: `0 8px 40px ${rgba("#000000", 0.6)}`, transform: `scale(${(1 + 0.004 * tSec).toFixed(5)})`,
            }}
          >
            {kw}
          </div>
        </AbsoluteFill>
      ) : null}
      {noTexture ? null : <TextureOverlay texture={env.tokens.theme?.texture} seed={seed ^ 0x51ed} />}
    </AbsoluteFill>
  );
};
