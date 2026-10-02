// Step 3 — STILL LAYOUT, TREATMENT, UPSCALE GUARD (§9.3): cover vs framed card, card parameters, camera-change flips,
// treatments from the asset analysis, asset-reuse rule.
import { fnv1a32, lerp, weightedPick, type ClipLayout } from "@docmaker/core";
import { clamp, round2, type Ctx, type Shot } from "./ctx";

const FRAME_W = 1920, FRAME_H = 1080, SAFE_W = 1728;

export interface StillGeometry { w: number; h: number; aspect: number; coverFactor: number; maxCover: number }
export function geometryOf(ctx: Ctx, s: Shot): StillGeometry | null {
  if (s.src.kind === "generated" || s.src.width === null || s.src.height === null) return null;
  const w = s.src.width, h = s.src.height;
  const coverFactor = Math.max(FRAME_W / w, FRAME_H / h);
  return { w, h, aspect: w / h, coverFactor, maxCover: ctx.P.maxUpscale / coverFactor };
}

function forcedCard(ctx: Ctx, s: Shot, g: StillGeometry): boolean {
  const kind = s.beatId ? ctx.beatById.get(s.beatId)?.plan.visualKind : undefined;
  return g.aspect < ctx.St.cardIfAspectBelow || g.w < ctx.St.cardIfWidthBelow || kind === "document_screenshot" || kind === "social_post" || g.maxCover < 1;
}

/** Applies a layout (and its parameters, scale caps) to an image shot. */
export function applyStillLayout(ctx: Ctx, s: Shot, layout: ClipLayout, tiltSign: number): void {
  const g = geometryOf(ctx, s)!;
  s.layout = layout;
  if (layout === "card") {
    const r = ctx.R(`card:${s.id}`);
    const cap = Math.max(0.5, (ctx.P.maxUpscale * g.h) / FRAME_H);
    const fit = SAFE_W / (FRAME_H * g.aspect);
    const hf = clamp(Math.min(lerp(ctx.St.card.heightFrac, r()), cap, fit), 0.4, 1);
    const borderPx = Math.round(lerp(ctx.St.card.borderPx, r()));
    const tilt = clamp(tiltSign * lerp(ctx.St.card.tiltDeg, r()), -4, 4);
    const backdrops = ctx.St.card.backdrops;
    const backdrop = ctx.tok.theme?.backdropRecipe ?? backdrops[Math.min(backdrops.length - 1, Math.floor(r() * backdrops.length))]!;
    s.layoutParams = { backdrop, heightFrac: round2(hf), borderPx, tiltDeg: round2(tilt), shadow: true, stroke: null, entry: "none", backdropSeed: fnv1a32(s.id) };
    s.baseUpscale = (round2(hf) * FRAME_H) / g.h;
    s.maxCamScale = Math.max(1, ctx.P.maxUpscale / s.baseUpscale);
  } else if (layout === "contain-blur") {
    s.layoutParams = null;
    s.baseUpscale = Math.min(FRAME_W / g.w, FRAME_H / g.h);
    s.maxCamScale = Math.max(1, ctx.P.maxUpscale / s.baseUpscale);
  } else {
    s.layoutParams = null;
    s.baseUpscale = g.coverFactor;
    s.maxCamScale = Math.max(1, g.maxCover);
  }
}

function treatmentOf(ctx: Ctx, s: Shot): Shot["treatment"] {
  const a = s.src.assetId ? ctx.frozen[s.src.assetId] : undefined;
  if (!a) return "none";
  if (a.analysis.grayscale) return "bw";
  if (a.analysis.year !== null && a.analysis.year < 1970) return "archival";
  return "none";
}

export function decideLayouts(ctx: Ctx, shots: Shot[]): void {
  let cardRun = 0;
  let tiltSign = 1;
  const prevOfAsset = new Map<string, Shot>();
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    s.treatment = treatmentOf(ctx, s);
    const g = geometryOf(ctx, s);
    if (s.role === "clip") {
      s.baseUpscale = g ? g.coverFactor : 1;
      s.maxCamScale = g ? Math.max(1, g.maxCover) : 1.6;
    } else if (s.src.kind === "generated" || !g) {
      s.layout = "cover"; s.layoutParams = null; s.baseUpscale = 1; s.maxCamScale = 2;
    } else if (s.src.kind === "video") {
      s.layout = "cover"; s.layoutParams = null; s.baseUpscale = g.coverFactor; s.maxCamScale = Math.max(1, g.maxCover);
    } else {
      const forced = forcedCard(ctx, s, g);
      s.forcedCard = forced;
      const prev = s.src.assetId ? prevOfAsset.get(s.src.assetId) : undefined;
      let layout: ClipLayout;
      if (s.change && prev && prev === shots[i - 1]) {
        // camera-change shot: keep the layout and reframe, unless the reframe would exceed the upscale guard → flip
        if (prev.layout === "cover") layout = g.maxCover >= ctx.P.reframe.scale[0] ? "cover" : "card";
        else layout = !forced ? "cover" : "card";
      } else if (forced) layout = "card";
      else layout = weightedPick(ctx.St.layoutWeights, ctx.R(`lay:${s.id}`)) ?? "cover";
      if (layout === "card" && cardRun >= ctx.St.maxCardRun) {
        if (!forced) layout = "cover";
        else {
          // break the run by turning an earlier non-forced card of the run into a cover, else contain-blur when it
          // does not over-upscale, else accept the run (a forced card must not be blown up)
          let fixed = false;
          for (let j = i - 1; j >= Math.max(0, i - cardRun); j--) {
            const q = shots[j]!;
            const gq = geometryOf(ctx, q);
            if (q.layout === "card" && !q.forcedCard && q.role === "normal" && gq && gq.maxCover >= 1) {
              applyStillLayout(ctx, q, "cover", 1);
              cardRun = i - 1 - j;
              fixed = true;
              break;
            }
          }
          if (!fixed && Math.min(1920 / g.w, 1080 / g.h) <= ctx.P.maxUpscale) layout = "contain-blur";
          else if (!fixed) ctx.warn("UPSCALE", s.id, "three framed cards in a row: the image is too small for any other layout");
        }
      }
      applyStillLayout(ctx, s, layout, tiltSign);
      if (layout === "card") {
        tiltSign = -tiltSign;
        if (s.layoutParams && shots[i - 1]?.layout !== "card") s.layoutParams.entry = "scale";
      }
    }
    cardRun = s.layout === "card" ? cardRun + 1 : 0;
    if (s.src.assetId) prevOfAsset.set(s.src.assetId, s);
  }
  assetReuse(ctx, shots);
}

/** A reuse inside assetReuseMinGapSec must change layout or framing (flip or force a reframe), else ASSET_REUSE. */
function assetReuse(ctx: Ctx, shots: Shot[]): void {
  const gap = ctx.S(ctx.St.assetReuseMinGapSec);
  const last = new Map<string, Shot>();
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    const id = s.src.assetId;
    if (!id || s.role === "clip" || s.role === "montage") { if (id) last.set(id, s); continue; }
    const p = last.get(id);
    last.set(id, s);
    if (!p || p === shots[i - 1] && s.change) continue;
    if (s.change && p.beatId === s.beatId) continue; // reframes alternate tight/wide within a beat
    if (s.from - p.end >= gap) continue;
    if (p.layout !== s.layout || p.change !== s.change) continue;
    if (s.src.kind === "image") {
      const g = geometryOf(ctx, s)!;
      const run = (shots[i - 1]?.layout === "card" ? 1 : 0) + (shots[i - 2]?.layout === "card" && shots[i - 1]?.layout === "card" ? 1 : 0);
      if (s.layout === "cover" && run < ctx.St.maxCardRun) { applyStillLayout(ctx, s, "card", (i % 2) ? 1 : -1); continue; }
      if (s.layout === "card" && !s.forcedCard && g.maxCover >= 1) { applyStillLayout(ctx, s, "cover", 1); continue; }
    }
    if (!s.change) { s.change = true; continue; }
    ctx.warn("ASSET_REUSE", s.id, `asset ${id.slice(0, 12)} reused ${((s.from - p.end) / ctx.fps).toFixed(1)} s after ${p.id} with the same layout and framing`);
  }
}

/** Layout of camera-change shots created after the main pass (visual-change splits): reframe, or flip when the reframe
 *  would exceed the upscale guard or the card run. */
export function relayoutChanges(ctx: Ctx, shots: Shot[]): void {
  let run = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    const prev = shots[i - 1];
    if (s.layoutParams === null && s.layout === "card" && s.src.kind === "image") applyStillLayout(ctx, s, "card", i % 2 ? 1 : -1);
    if (s.change && prev && s.src.kind === "image" && prev.src.assetId === s.src.assetId && s.role === "normal") {
      const g = geometryOf(ctx, s)!;
      if (s.layout === "cover" && g.maxCover < ctx.P.reframe.scale[0] && run < ctx.St.maxCardRun) applyStillLayout(ctx, s, "card", i % 2 ? 1 : -1);
      else if (s.layout === "card" && run >= ctx.St.maxCardRun && !s.forcedCard && g.maxCover >= 1) applyStillLayout(ctx, s, "cover", 1);
      if (s.layout === "card" && s.layoutParams) s.layoutParams = { ...s.layoutParams, backdropSeed: s.layoutParams.backdropSeed, entry: "none" };
    }
    run = s.layout === "card" ? run + 1 : 0;
  }
}
