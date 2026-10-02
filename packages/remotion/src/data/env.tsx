// Render environment shared by every layer and component (React context; no state). Components read tokens, assets
// and the asset base from here and their timing from Sequence-relative useCurrentFrame() only.
import { createContext, useContext, useMemo } from "react";
import type { Grade, StyleRenderTokens, Timeline, VisualClip } from "@docmaker/core";
import type { ComputedTimeline } from "../compute/types";
import { assetUrl } from "../lib/assetUrl";
import { bezierOf, type Ease } from "../lib/easing";
import { uiLang, type UiLang } from "../lib/text";

export interface RenderEnv {
  tokens: StyleRenderTokens;
  assets: Timeline["assets"];
  base: string;
  mode: "render" | "preview";
  lang: UiLang;
  locale: string; // BCP 47 for casing
  fps: number;
  width: number;
  height: number;
  seed: number;
  grade: Grade;
}
export interface DocState { t: Timeline; ct: ComputedTimeline; parts: VisualClip[] }

const EnvCtx = createContext<RenderEnv | null>(null);
const DocCtx = createContext<DocState | null>(null);
export const EnvProvider = EnvCtx.Provider;
export const DocProvider = DocCtx.Provider;

export function useEnv(): RenderEnv {
  const v = useContext(EnvCtx);
  if (!v) throw new Error("@docmaker/remotion: component rendered outside a Documentary/EnvProvider");
  return v;
}
export const useDocState = (): DocState | null => useContext(DocCtx);

export function envFromTimeline(t: Timeline, base: string, mode: "render" | "preview"): RenderEnv {
  const lang = uiLang(t.lang);
  return {
    tokens: t.render, assets: t.assets, base, mode, lang, locale: lang === "fr" ? "fr-FR" : "en-US",
    fps: t.fps, width: t.width, height: t.height, seed: t.seed, grade: t.grade,
  };
}

export function useAsset(assetId: string | null | undefined): { url: string | null; width: number | null; height: number | null; durationFrames: number | null } {
  const env = useEnv();
  return useMemo(() => {
    const a = assetId ? env.assets[assetId] : undefined;
    return { url: assetUrl(env, assetId, env.base), width: a?.width ?? null, height: a?.height ?? null, durationFrames: a?.durationFrames ?? null };
  }, [env, assetId]);
}

/** Font stack for a token role, with a built-in fallback so a missing glyph never shows tofu. */
export type FontRole = keyof StyleRenderTokens["tokens"]["fonts"];
export const familyOf = (tokens: StyleRenderTokens, role: FontRole): string =>
  role === "headline" && tokens.theme?.fontHeadline ? tokens.theme.fontHeadline : tokens.tokens.fonts[role];
export function fontStack(tokens: StyleRenderTokens, role: FontRole): string {
  const fam = familyOf(tokens, role);
  const fallback = role === "mono" || role === "document" ? `"JetBrains Mono", monospace` : role === "serif" ? `"Instrument Serif", serif` : `"Inter", sans-serif`;
  return `"${fam}", ${fallback}`;
}
export const familyStack = (family: string): string => `"${family}", "Inter", sans-serif`;

const easeCache = new Map<string, Ease>();
export function tokenEase(b: readonly [number, number, number, number]): Ease {
  const k = b.join(",");
  let e = easeCache.get(k);
  if (!e) {
    e = bezierOf(b);
    easeCache.set(k, e);
  }
  return e;
}
/** Accent colour (theme override wins). */
export const accentOf = (tokens: StyleRenderTokens): string => tokens.theme?.accent ?? tokens.tokens.palette.accent;

/** Environment for compositions rendered without a Timeline (specimens, generated stills). */
export function envFromTokens(
  tokens: StyleRenderTokens,
  o: { grade: Grade; base?: string; mode?: "render" | "preview"; lang?: string; fps?: number; width?: number; height?: number; seed?: number; assets?: Timeline["assets"] },
): RenderEnv {
  const lang = uiLang(o.lang ?? "en");
  return {
    tokens, assets: o.assets ?? {}, base: o.base ?? "", mode: o.mode ?? "render", lang, locale: lang === "fr" ? "fr-FR" : "en-US",
    fps: o.fps ?? 30, width: o.width ?? 1920, height: o.height ?? 1080, seed: o.seed ?? 0, grade: o.grade,
  };
}
