// Timeline measurements shared by DirectorStats and lintTimeline (pure functions of a Timeline).
import { COMPONENT_META, isSfxImpact, sfxDensityEvents, type CameraMove, type StyleData, type Timeline } from "@docmaker/core";
import { keyOf } from "./transitions";
import { DEAD_AIR_MAX_SEC, bareStretches, isBareSource, isForeground } from "./dead-air";

export const camMaxOf = (c: CameraMove) => Math.max(...c.keys.map((k) => k.scale));

/** Visual events: cuts, punch/zoom/flash fx, overlay entries (non-HUD) and VO-synced sub-beats (`at`/`*At`). */
export function timelineVisualEvents(t: Timeline): number[] {
  const ev = new Set<number>();
  for (const c of t.video) if (c.from > 0) ev.add(c.from);
  for (const f of t.fx) if (f.fx === "zoom" || f.fx === "punch" || f.fx === "flash") ev.add(f.from);
  for (const o of t.overlays) {
    if (COMPONENT_META[o.component].band === "hud") continue;
    ev.add(o.from);
    const walk = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if ((k === "at" || /At$/.test(k)) && typeof x === "number") { if (x > 0 && x < o.dur) ev.add(o.from + x); } else walk(x);
      }
    };
    walk(o.props);
  }
  return [...ev].filter((f) => f > 0 && f < t.durationInFrames).sort((a, b) => a - b);
}

export function maxGapFrames(t: Timeline): number {
  const pts = [0, ...timelineVisualEvents(t), t.durationInFrames];
  let g = 0;
  for (let k = 1; k < pts.length; k++) g = Math.max(g, pts[k]! - pts[k - 1]!);
  return g;
}

/** Punch events: span zoom punches (amt ≥ 0.08) and zoom cuts (tight reframe of the previous clip's asset). */
export function punchEvents(t: Timeline, style: StyleData): number[] {
  const out: number[] = [];
  for (const f of t.fx) if (f.fx === "zoom" && f.shape === "span" && f.amt >= 0.08 && f.target !== "all") out.push(f.from);
  for (let i = 1; i < t.video.length; i++) {
    const c = t.video[i]!, p = t.video[i - 1]!;
    const a = c.source.kind === "image" || c.source.kind === "video" ? c.source.assetId : null;
    const pa = p.source.kind === "image" || p.source.kind === "video" ? p.source.assetId : null;
    const pulse = c.transitionIn.kind === "cut" && c.transitionIn.accent.type === "pulse";
    if (a && a === pa && pulse && c.camera.kind === "reframe" && c.camera.keys[0]!.scale >= style.cameraPolicy.reframe.scale[0] - 1e-6) out.push(c.from);
  }
  return out.sort((a, b) => a - b);
}

/** SFX events for density: rolls (ticks, keys) of one source item within 1 s count once (the shared core rule). */
export const sfxEvents = (t: Timeline, filter: (cat: string) => boolean = () => true): number[] => sfxDensityEvents(t, filter);
export const isImpact = isSfxImpact;

/** Effective source upscale of a clip: layout base × camera max × (1 + max punch/zoom amt over the clip). */
export function effectiveUpscale(t: Timeline, i: number): number | null {
  const c = t.video[i]!;
  if (c.source.kind !== "image" && c.source.kind !== "video") return null;
  const a = t.assets[c.source.assetId];
  if (!a || !a.width || !a.height) return null;
  const w = c.source.crop ? a.width * c.source.crop.w : a.width;
  const h = c.source.crop ? a.height * c.source.crop.h : a.height;
  let base: number;
  if (c.layout === "card" && c.layoutParams) base = (c.layoutParams.heightFrac * 1080) / h;
  else if (c.layout === "pip" && c.layoutParams) base = Math.max((c.layoutParams.heightFrac * 1920) / w, (c.layoutParams.heightFrac * 1080) / h);
  else if (c.layout === "contain-blur") base = Math.min(1920 / w, 1080 / h);
  else base = Math.max(1920 / w, 1080 / h);
  let punch = 0;
  for (const f of t.fx) {
    if ((f.fx === "zoom" || f.fx === "punch") && f.target !== "all" && f.from < c.from + c.dur && f.from + f.dur > c.from) punch = Math.max(punch, f.amt);
  }
  return base * camMaxOf(c.camera) * (1 + punch);
}

export function transitionKeys(t: Timeline): string[] {
  return t.video.slice(1).map((c) => keyOf(c.transitionIn));
}

/** Shot boundaries carrying an SFX event within [cut − 2, cut + 3] frames (a "non-silent" cut). */
export function cutsWithSfx(t: Timeline): number {
  const ev = t.audio.sfx.map((x) => x.eventFrame).sort((a, b) => a - b);
  let n = 0;
  for (const c of t.video.slice(1)) if (ev.some((f) => f >= c.from - 2 && f <= c.from + 3)) n++;
  return n;
}

/** Bare-backdrop stretches (s) of a finished timeline longer than DEAD_AIR_MAX_SEC (QA / tests read-back of §9.3 step 7c). */
export function deadAirStretches(t: Timeline): { from: number; end: number }[] {
  return bareStretches(
    t.video.map((c) => ({ from: c.from, end: c.from + c.dur, bare: isBareSource(c.source.kind === "generated" ? c.source : { kind: c.source.kind }) })),
    t.overlays.filter((o) => isForeground(o.component)).map((o) => ({ from: o.from, end: o.from + o.dur })),
    Math.round(DEAD_AIR_MAX_SEC * t.fps),
  );
}
