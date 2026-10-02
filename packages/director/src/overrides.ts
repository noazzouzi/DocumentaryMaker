// applyOverrides (§4.13, §9.3 step 13): fingerprinted user overrides, validated in isolation; rejected ones are listed,
// never applied, never thrown.
import {
  COMPONENT_META, CameraMove, ClipLayout, OVERLAY_PROPS, OverlayItem, Transition, VisualSource, fnv1a32, framesAt, isDocmakerError,
  resolveAnchor, type Anchor, type AnchorIndex, type BeatPlan, type LayoutParams, type OverridesDoc, type StyleData, type Timeline,
} from "@docmaker/core";
import type { DirectorInput } from "./types";

type Ctx = { style: StyleData; validateAsset: DirectorInput["validateAsset"]; plans: BeatPlan[] };
type AnyItem = { id: string; start: Anchor; end: Anchor; from: number; dur: number; beatId?: string | null };

function allItems(t: Timeline): AnyItem[] {
  const a = t.audio;
  return [...t.video, ...t.overlays, ...t.captions, ...t.fx, ...a.vo, ...a.music, ...a.sfx, ...a.clip, ...a.silences];
}

/** Re-matches a word anchor whose expectNorm no longer matches: nearest word of the same segment with that norm. */
function rematch(a: Anchor, ix: AnchorIndex): Anchor | string {
  if (a.ref !== "word") return a;
  const cur = ix.words.get(a.wordId);
  if (cur && (a.expectNorm === null || cur.norm === a.expectNorm)) return a;
  if (a.expectNorm === null) return `word ${a.wordId} no longer exists`;
  const m = /^(CH\d{1,2}-S\d{2,3}):(\d{1,4})$/.exec(a.wordId);
  if (!m) return `invalid word id ${a.wordId}`;
  const seg = m[1]!, idx = Number(m[2]);
  let best: { id: string; d: number } | null = null;
  for (const [id, w] of ix.words) {
    if (!id.startsWith(seg + ":") || w.norm !== a.expectNorm) continue;
    const d = Math.abs(Number(id.slice(seg.length + 1)) - idx);
    if (!best || d < best.d) best = { id, d };
  }
  return best ? { ...a, wordId: best.id } : `anchored word "${a.expectNorm}" not found in ${seg}`;
}

const defaultParams = (layout: "card" | "pip", seed: string, style: StyleData): LayoutParams => ({
  backdrop: layout === "pip" ? "blurSelf" : style.stills.card.backdrops[0] ?? "gradientGrid",
  heightFrac: layout === "pip" ? 0.76 : Math.min(1, Math.max(0.4, (style.stills.card.heightFrac[0] + style.stills.card.heightFrac[1]) / 2)),
  borderPx: layout === "pip" ? 0 : Math.round(style.stills.card.borderPx[0]), tiltDeg: 0, shadow: true,
  stroke: layout === "pip" ? style.tokens.palette.accent : null, entry: "none", backdropSeed: fnv1a32(seed),
});

function checkTarget(t: Timeline, ov: OverridesDoc["overrides"][number], ix: AnchorIndex, ctx: Ctx): string | null {
  const tg = ov.target;
  const op = ov.override;
  if (op.op === "addOverlay") return null;
  const item = allItems(t).find((x) => x.id === tg.itemId);
  if (!item) return `target ${tg.itemId} is not in the timeline`;
  const targetId = "clipId" in op ? op.clipId : "itemId" in op ? op.itemId : null;
  if (targetId !== null && targetId !== tg.itemId) return "override and fingerprint name different items";
  if (tg.component !== null) {
    const o = t.overlays.find((x) => x.id === tg.itemId);
    if (!o || o.component !== tg.component) return `the item is no longer a ${tg.component}`;
  }
  if (tg.beatId !== null && (item.beatId ?? null) !== tg.beatId) return `the item no longer belongs to beat ${tg.beatId}`;
  if (tg.planKey !== null) {
    const plan = ctx.plans.find((p) => p.id === tg.beatId);
    if (!plan || plan.planKey !== tg.planKey) return "the beat's plan changed since the override was made (planKey mismatch)";
  }
  if (tg.assetId !== null) {
    const v = t.video.find((x) => x.id === tg.itemId);
    const cur = v && (v.source.kind === "image" || v.source.kind === "video") ? v.source.assetId : null;
    if (cur !== tg.assetId) return "the clip source changed since the override was made";
  }
  if (tg.wordNorm !== null) {
    const a = [item.start, item.end].find((x) => x.ref === "word");
    if (a && a.ref === "word") {
      const w = ix.words.get(a.wordId);
      if (!w || w.norm !== tg.wordNorm) return `the anchored word changed ("${tg.wordNorm}" → "${w?.norm ?? "missing"}")`;
    }
  }
  return null;
}

function applyOne(t: Timeline, ov: OverridesDoc["overrides"][number], ix: AnchorIndex, ctx: Ctx): Timeline | string {
  const fp = checkTarget(t, ov, ix, ctx);
  if (fp) return fp;
  const op = ov.override;
  const keepOut = t.render.tokens.layout.keepOut;
  const zoneOk = (z: string) => z === "full" || !keepOut.some((k) => {
    const r = t.render.tokens.layout.zones[z as keyof typeof t.render.tokens.layout.zones];
    return r.x < k.x + k.w && k.x < r.x + r.w && r.y < k.y + k.h && k.y < r.y + r.h;
  });
  switch (op.op) {
    case "replaceSource": {
      const i = t.video.findIndex((c) => c.id === op.clipId);
      if (i < 0) return `clip ${op.clipId} not found`;
      const src = VisualSource.safeParse(op.source);
      if (!src.success) return "invalid source";
      const s = src.data;
      if (s.kind === "image" || s.kind === "video") {
        const a = t.assets[s.assetId];
        if (!a) return "the asset is not frozen for this project";
        if ((s.kind === "image" && a.kind !== "image") || (s.kind === "video" && a.kind !== "video")) return "the asset kind does not match the source kind";
        const errs = ctx.validateAsset(s.assetId, t.video[i]!.beatId).filter((x) => x.level === "error");
        if (errs.length) return `policy: ${errs.map((e) => e.msg).join("; ")}`;
        if (s.kind === "video" && a.durationFrames !== null && s.sourceInFrames + t.video[i]!.dur > a.durationFrames) return "the video is shorter than the clip";
      }
      const video = [...t.video];
      video[i] = { ...video[i]!, source: s };
      return { ...t, video };
    }
    case "setTransition": {
      const i = t.video.findIndex((c) => c.id === op.clipId);
      if (i < 0) return `clip ${op.clipId} not found`;
      const tr = Transition.safeParse(op.transition);
      if (!tr.success) return "invalid transition";
      const x = tr.data;
      const c = t.video[i]!, p = t.video[i - 1];
      if (!p && x.kind !== "cut") return "the first clip can only cut";
      if (x.kind === "overlap" && p) {
        if (t.chapters.some((ch) => ch.from === c.from)) return "overlaps are not allowed on a chapter's first clip";
        if (x.durationFrames > Math.min(p.dur, c.dur) - 2) return "overlap too long for its neighbours";
        const h = x.durationFrames / 2;
        if (c.source.kind === "video" && c.source.sourceInFrames < h) return "no head handle for the overlap";
        if (p.source.kind === "video") {
          const a = t.assets[p.source.assetId];
          if (a?.durationFrames !== null && a?.durationFrames !== undefined && p.source.sourceInFrames + p.dur + h > a.durationFrames) return "no tail handle for the overlap";
        }
      }
      if (x.kind === "cover" && p && (x.durationFrames / 2 > p.dur || x.durationFrames / 2 > c.dur)) return "cover longer than its neighbours";
      const video = [...t.video];
      video[i] = { ...c, transitionIn: x };
      return { ...t, video };
    }
    case "setCamera": {
      const i = t.video.findIndex((c) => c.id === op.clipId);
      if (i < 0) return `clip ${op.clipId} not found`;
      const cam = CameraMove.safeParse(op.camera);
      if (!cam.success) return "invalid camera";
      const video = [...t.video];
      video[i] = { ...video[i]!, camera: cam.data };
      return { ...t, video };
    }
    case "setLayout": {
      const i = t.video.findIndex((c) => c.id === op.clipId);
      if (i < 0) return `clip ${op.clipId} not found`;
      const l = ClipLayout.safeParse(op.layout);
      if (!l.success) return "invalid layout";
      const c = t.video[i]!;
      if (l.data !== "cover" && l.data !== "contain-blur" && c.source.kind !== "image" && c.source.kind !== "video") return "only image/video clips can be framed";
      const params = l.data === "card" || l.data === "pip" ? c.layoutParams ?? defaultParams(l.data, c.id, ctx.style) : null;
      const video = [...t.video];
      video[i] = { ...c, layout: l.data, layoutParams: params };
      return { ...t, video };
    }
    case "removeItem": {
      if (op.itemId.startsWith("vo:")) return "voice-over clips cannot be removed";
      if (t.video.some((c) => c.id === op.itemId)) return "picture clips cannot be removed (replace the source instead)";
      const drop = <T extends { id: string }>(xs: T[]) => xs.filter((x) => x.id !== op.itemId);
      const a = t.audio;
      const next: Timeline = {
        ...t, overlays: drop(t.overlays), captions: drop(t.captions), fx: drop(t.fx),
        audio: { ...a, music: drop(a.music), sfx: drop(a.sfx), clip: drop(a.clip), silences: drop(a.silences) },
      };
      return next;
    }
    case "addOverlay": {
      const parsed = OverlayItem.safeParse(op.item);
      if (!parsed.success) return "invalid overlay item";
      const it = parsed.data;
      if (allItems(t).some((x) => x.id === it.id)) return `id ${it.id} already exists`;
      const start = rematch(it.start, ix), end = rematch(it.end, ix);
      if (typeof start === "string") return start;
      if (typeof end === "string") return end;
      let from: number, to: number;
      try { from = resolveAnchor(start, ix); to = resolveAnchor(end, ix); } catch (e) { return isDocmakerError(e) ? e.message : "anchor does not resolve"; }
      if (to - from < 1) return "the overlay resolves to an empty span";
      const props = OVERLAY_PROPS[it.component].safeParse(it.props);
      if (!props.success) return "invalid overlay props";
      if (!zoneOk(it.zone)) return `zone ${it.zone} intersects a keep-out area`;
      const m = COMPONENT_META[it.component];
      const item = {
        ...it, start, end, from, dur: to - from, props: props.data, band: m.band, followsCamera: m.followsCamera,
        enterFrames: framesAt(t.fps, m.enter30), exitFrames: framesAt(t.fps, m.exit30),
      } as Timeline["overlays"][number];
      return { ...t, overlays: [...t.overlays, item].sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1)) };
    }
    case "patchOverlayProps": {
      const i = t.overlays.findIndex((o) => o.id === op.itemId);
      if (i < 0) return `overlay ${op.itemId} not found`;
      const o = t.overlays[i]!;
      const merged = OVERLAY_PROPS[o.component].safeParse({ ...(o.props as Record<string, unknown>), ...op.props });
      if (!merged.success) return `the patched props are invalid for ${o.component}`;
      const overlays = [...t.overlays];
      overlays[i] = { ...o, props: merged.data } as Timeline["overlays"][number];
      return { ...t, overlays };
    }
    case "setSfxGain": {
      const i = t.audio.sfx.findIndex((x) => x.id === op.itemId);
      if (i < 0) return `sfx ${op.itemId} not found`;
      const sfx = [...t.audio.sfx];
      sfx[i] = { ...sfx[i]!, gainDb: op.gainDb };
      return { ...t, audio: { ...t.audio, sfx } };
    }
  }
}

export function applyOverrides(t: Timeline, o: OverridesDoc, ix: AnchorIndex, ctx: Ctx): { timeline: Timeline; rejected: { id: string; reason: string }[] } {
  const rejected: { id: string; reason: string }[] = [];
  if (o.lang !== t.lang) return { timeline: t, rejected: o.overrides.map((x) => ({ id: x.id, reason: `overrides are for ${o.lang}, timeline is ${t.lang}` })) };
  if (ix.layoutHash !== t.layoutHash) return { timeline: t, rejected: o.overrides.map((x) => ({ id: x.id, reason: "the anchor index belongs to another layout" })) };
  let cur = t;
  for (const ov of o.overrides) {
    try {
      const r = applyOne(cur, ov, ix, ctx);
      if (typeof r === "string") rejected.push({ id: ov.id, reason: r });
      else cur = r;
    } catch (e) {
      rejected.push({ id: ov.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { timeline: cur, rejected };
}
