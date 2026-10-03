// direct (§9.3): orchestration of steps 0–14 and assembly of the Timeline. Pure and deterministic.
import {
  COMPONENT_META, DocmakerError, Timeline, buildAnchorIndex, collectAssetIds, framesAt, type FxCue, type LintIssue, type OverlayItem,
  type VisualClip, type VisualSource,
} from "@docmaker/core";
import { arbitrate, salienceRoom, type ImpactEvent } from "./arbitration";
import { buildSilences, clipAudio, duckingSpec, musicItems, silenceItems, voClips, voSpans } from "./audio";
import { assignCameras, camMax } from "./camera";
import { buildCaptions } from "./captions";
import { anchorAt, buildCtx, isAiAsset, round3, type Ctx, type Shot } from "./ctx";
import { reconcileAiLabels } from "./disclosure";
import { FxBook, climaxFx, impactShakes, montagePunches, type Fx } from "./fx";
import { lintTimeline } from "./lint";
import { buildAssets, buildMarkers, buildUsage } from "./markers";
import { planMusic } from "./music";
import { buildOverlays, type Ov } from "./overlays";
import { zOf } from "./overlays/conflicts";
import { personRule } from "./overlays/state";
import { applyOverrides } from "./overrides";
import { placePunches, plannedReserve } from "./punch";
import { planReveals, quietZones } from "./reveal";
import { selectSfx, sfxCandidates } from "./sfx";
import { applyHits, buildShots, numberShots, snapRevealCuts, textlessUnderText } from "./shots";
import { effectiveUpscale, isImpact, maxGapFrames, punchEvents, sfxEvents, timelineVisualEvents } from "./stats";
import { decideLayouts, relayoutChanges } from "./stills";
import { assignTransitions, hiddenTransitions, keyOf } from "./transitions";
import type { DirectorInput, DirectorOutput, DirectorStats } from "./types";
import { DIRECTOR_VERSION } from "./version";
import { visualChangePass } from "./visual-change";
import { readText } from "./overlays/hold";

function visualSource(s: Shot): VisualSource {
  const src = s.src;
  if (src.kind === "image" && src.assetId) return { kind: "image", assetId: src.assetId, crop: src.crop, focal: src.focal };
  if (src.kind === "video" && src.assetId) return { kind: "video", assetId: src.assetId, sourceInFrames: Math.max(0, src.sourceIn), crop: src.crop, focal: src.focal };
  return { kind: "generated", recipe: src.recipe, text: src.text, palette: src.palette.slice(0, 4).length >= 2 ? src.palette.slice(0, 4) : ["#000000", "#FFFFFF"], seed: src.seed };
}

function clipName(ctx: Ctx, s: Shot, n: number): string {
  const what = s.src.kind === "generated" ? `${s.src.recipe}` : s.role === "clip" ? "clip" : s.layout;
  return `${s.beatId ?? s.chapterId} · ${n + 1} · ${what}`.slice(0, 120);
}

function videoClips(ctx: Ctx, shots: readonly Shot[]): VisualClip[] {
  const starts = shots.map((s, i) => {
    if (i === 0) return anchorAt(ctx, 0, { chapter: s.chapterId });
    const ch = ctx.chapters.find((c) => c.id === s.chapterId)!;
    if (s.anchorWord) {
      const w = ctx.ix.words.get(s.anchorWord);
      if (w && Math.abs(s.from - w.from) <= ctx.F30(15)) return anchorAt(ctx, s.from, { word: s.anchorWord });
    }
    if (s.from === ch.from) return anchorAt(ctx, s.from, { chapter: ch.id });
    return anchorAt(ctx, s.from, { beat: s.beatId });
  });
  const perRef = new Map<string, number>();
  return shots.map((s, i) => {
    const ref = s.beatId ?? s.chapterId;
    const n = perRef.get(ref) ?? 0;
    perRef.set(ref, n + 1);
    const end = i + 1 < shots.length ? starts[i + 1]! : ({ ref: "program", edge: "end", offset: 0 } as const);
    return {
      id: s.id, start: starts[i]!, end, from: s.from, dur: s.end - s.from, chapterId: s.chapterId, beatId: s.beatId,
      source: visualSource(s), layout: s.layout, layoutParams: s.layout === "card" || s.layout === "pip" ? s.layoutParams : null,
      camera: s.camera!, treatment: s.treatment, transitionIn: i === 0 ? { kind: "cut", accent: { type: "none" } } : s.transition,
      sourceLabel: s.sourceLabel, name: clipName(ctx, s, n),
    };
  });
}

function overlayItems(ctx: Ctx, ovs: readonly Ov[]): OverlayItem[] {
  return ovs.filter((o) => !o.dropped).map((o) => {
    const m = COMPONENT_META[o.component];
    const hint = o.anchorWord ? { word: o.anchorWord } : o.anchorChapter ? { chapter: o.anchorChapter } : o.anchorSegment ? { segment: o.anchorSegment } : { beat: o.beatId };
    return {
      id: o.id, start: anchorAt(ctx, o.from, hint), end: anchorAt(ctx, o.from + o.dur, hint), from: o.from, dur: o.dur, beatId: o.beatId,
      band: m.band, z: zOf(o), zone: o.zone, enterFrames: framesAt(ctx.fps, m.enter30), exitFrames: framesAt(ctx.fps, m.exit30),
      followsCamera: m.followsCamera, component: o.component, props: o.props,
    } as OverlayItem;
  }).sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
}

function fxItems(ctx: Ctx, book: FxBook, droppedOv: ReadonlySet<string>): FxCue[] {
  return book.items.filter((f) => !f.dropped && !(f.sourceOv && droppedOv.has(f.sourceOv))).map((f: Fx) => {
    const hint = f.anchorWord ? { word: f.anchorWord } : { beat: f.beatId };
    const cue: FxCue = {
      id: f.id, start: anchorAt(ctx, f.from, hint), end: anchorAt(ctx, f.from + f.dur, hint), from: f.from, dur: f.dur, fx: f.fx, shape: f.shape,
      pre: f.pre, curve: f.curve, fade: f.fade, amt: f.amt, decay: f.decay, hz: f.hz, ampY: f.ampY, rotDeg: f.rotDeg,
      x: f.x === null ? null : round3(f.x), y: f.y === null ? null : round3(f.y), color: f.color, seed: f.seed, target: f.target,
    };
    return cue;
  }).sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
}

/** POLICY (validateAsset on every on-screen asset) and PRIVATE_PERSON (overlay text) checks, which need project context. */
function policyChecks(ctx: Ctx, t: Timeline): LintIssue[] {
  const out: LintIssue[] = [];
  const seen = new Set<string>();
  const check = (assetId: string, beatId: string | null, where: string) => {
    const key = `${assetId}|${beatId}`;
    if (seen.has(key)) return;
    seen.add(key);
    for (const i of ctx.I.validateAsset(assetId, beatId)) {
      out.push({ level: i.level === "error" ? "error" : "warn", rule: i.level === "error" ? "POLICY" : i.rule, where, msg: i.msg });
    }
  };
  for (const c of t.video) if (c.source.kind === "image" || c.source.kind === "video") check(c.source.assetId, c.beatId, c.id);
  for (const o of t.overlays) {
    const walk = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (/assetid$/i.test(k) && typeof x === "string") check(x, o.beatId, o.id); else walk(x); }
    };
    walk(o.props);
  }
  // overlay text naming people who must not be named
  for (const o of t.overlays) {
    const text = readText(o.component, o.props).concat(
      typeof (o.props as Record<string, unknown>).speaker === "string" ? [(o.props as Record<string, string>).speaker!] : [],
      typeof (o.props as Record<string, unknown>).displayName === "string" ? [(o.props as Record<string, string>).displayName!] : [],
    ).join(" ").toLowerCase();
    if (!text) continue;
    for (const p of ctx.facts.people) {
      const rule = personRule(ctx, p);
      if (rule === "name") continue;
      const names = [p.name, ...p.aliases].map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 4);
      if (names.some((n) => text.includes(n))) {
        out.push({ level: "error", rule: "PRIVATE_PERSON", where: o.id, msg: `${o.component} names ${rule === "never" ? "a minor or private victim" : "a non-public person without a person-ack"}` });
      }
    }
  }
  return out;
}

/** project.assets.maxClipSeconds (DirectorInput.project.assets is optional). */
function maxClipSecondsOf(I: DirectorInput): number | null {
  const v: unknown = I.project.assets?.maxClipSeconds;
  return typeof v === "number" && v > 0 ? v : null;
}

export function direct(I: DirectorInput): DirectorOutput {
  if (I.layout.lang !== I.lang) throw new DocmakerError("VALIDATION", `layout language ${I.layout.lang} ≠ ${I.lang}`);
  const ctx = buildCtx(I);
  if (ctx.beats.length === 0 && ctx.chapters.length === 0) throw new DocmakerError("VALIDATION", "the layout has no chapter");

  // 1. music plan (reveal silences first)
  const reveals = planReveals(ctx);
  const music = planMusic(ctx, reveals);
  // 2. shots, montage; shot-level edits of steps 6 and 11b
  const shots = buildShots(ctx, music);
  const hits = applyHits(ctx, shots, music);
  const snapped = snapRevealCuts(ctx, shots, reveals);
  numberShots(shots);
  // 3. stills; 5. transitions; 4. camera (with the planned punch reserve)
  decideLayouts(ctx, shots);
  assignTransitions(ctx, shots);
  assignCameras(ctx, shots, { reserve: plannedReserve(ctx, shots) });
  // 7. overlays
  const { st, bleeps } = buildOverlays(ctx, shots);
  textlessUnderText(shots, st.items); // no keyword headline under a text overlay (the words would be drawn twice)
  hiddenTransitions(ctx, shots, st.items); // no transition (or its SFX) under an opaque full-frame card
  // 6. reveals, shocks, fx, punches
  const book = new FxBook();
  climaxFx(ctx, book, reveals, snapped);
  impactShakes(ctx, book, st);
  montagePunches(ctx, book, shots);
  const shockFrames = book.items.filter((f) => f.role === "plate").map((f) => f.from);
  const quiet = quietZones(ctx, [...reveals.map((r) => r.a), ...shockFrames]);
  const impacts: ImpactEvent[] = [
    ...ctx.chapters.filter((c) => c.idx > 0).map((c) => ({ key: `chapter:${c.id}`, frame: c.from, cls: 6, combo: null, beatId: null })),
    ...reveals.map((r) => ({ key: `reveal:${r.beat.id}`, frame: r.a, cls: 6, combo: "reveal" as const, beatId: r.beat.id })),
    ...book.items.filter((f) => f.role === "plate").map((f) => ({ key: `shock:${f.id}`, frame: f.from, cls: 6, combo: null, beatId: f.beatId })),
    ...hits.map((h) => ({ key: `hit:${h.beatId}`, frame: h.frame, cls: 3, combo: null, beatId: h.beatId })),
  ];
  const room = (f: number) => salienceRoom(ctx, shots, st, book, impacts, f, ctx.Bu.salience.weights.punch);
  placePunches(ctx, { shots, st, book, quiet, room });
  // 8. visual change → re-layout split shots, final cameras around the accepted punches
  visualChangePass(ctx, shots, st, book);
  hiddenTransitions(ctx, shots, st.items); // again for the zoom cuts of step 6 and the splits of step 8
  relayoutChanges(ctx, shots);
  const punchAmt = (s: Shot) => Math.max(0, ...book.live().filter((f) => (f.fx === "zoom" || f.fx === "punch") && f.target !== "all" && f.from < s.end && f.from + f.dur > s.from).map((f) => f.amt));
  assignCameras(ctx, shots, { reserve: punchAmt });
  for (const f of book.live()) { // punches never exceed the final camera headroom
    if (f.role !== "punch" && f.role !== "fillPunch") continue;
    const s = shots.find((x) => x.from <= f.from && f.from < x.end);
    if (!s || s.src.kind === "generated") continue;
    const head = s.maxCamScale / Math.max(1, camMax(s.camera)) - 1;
    if (head < 0.08) f.dropped = true;
    else if (f.amt > head) f.amt = Math.round(head * 10000) / 10000;
  }
  // 9. arbitration
  const arb = arbitrate(ctx, shots, st, book, impacts);
  const droppedOv = new Set(st.items.filter((o) => o.dropped).map((o) => o.id));
  // 10. captions
  const caps = buildCaptions(ctx, st);
  // 11. audio
  const silences = buildSilences(ctx, music, bleeps);
  const ca = clipAudio(ctx, shots);
  const liveOv = st.items.filter((o) => !o.dropped);
  const env = { shots, overlays: liveOv, fx: book.live().filter((f) => !(f.sourceOv && droppedOv.has(f.sourceOv))), reveals, silences, bleeps, hits, droppedImpacts: arb.droppedImpacts, cleanRanges: arb.cleanRanges };
  const sfx = selectSfx(ctx, env, sfxCandidates(ctx, env));
  const ducking = duckingSpec(ctx);
  // 12. assemble, markers, assets, usage
  const video = videoClips(ctx, shots);
  const overlays = overlayItems(ctx, liveOv);
  const fx = fxItems(ctx, book, droppedOv);
  const audio: Timeline["audio"] = {
    voProgram: { assetId: I.layout.voProgram.assetId, bakedGainDb: I.layout.voProgram.bakedGainDb }, voSpans: voSpans(ctx, ducking), vo: voClips(ctx),
    music: musicItems(ctx, music), sfx: sfx.items, clip: ca.items, silences: silenceItems(ctx, silences), ducking,
  };
  const draft = { video, overlays, audio };
  let timeline: Timeline = {
    schemaVersion: 1, projectSlug: I.project.slug, lang: I.lang, title: I.script.title, styleId: I.style.manifest.id, seed: I.project.seed,
    fps: I.layout.fps, width: 1920, height: 1080, durationInFrames: ctx.N, layoutHash: I.layoutHash, takeId: I.layout.takeId, takeKind: I.layout.takeKind,
    onlyChapters: I.layout.onlyChapters, directorVersion: DIRECTOR_VERSION, captionsMode: I.project.captions,
    chapters: ctx.chapters.map((c) => ({ id: c.id, title: c.title, act: c.act, from: c.from, dur: c.end - c.from })),
    video, overlays, captions: caps.groups, fx, audio, grade: I.style.grade, markers: buildMarkers(ctx, shots), assets: buildAssets(ctx, draft), render: I.renderTokens,
  };
  // 13. overrides (replaceSource assets that are frozen join the assets table first)
  let rejected: { id: string; reason: string }[] = [];
  if (I.overrides && I.overrides.overrides.length > 0) {
    const extra = { ...timeline.assets };
    for (const o of I.overrides.overrides) {
      const op = o.override;
      if (op.op === "replaceSource" && (op.source.kind === "image" || op.source.kind === "video") && I.frozen[op.source.assetId] && !extra[op.source.assetId]) {
        const f = I.frozen[op.source.assetId]!;
        extra[f.id] = { id: f.id, kind: f.kind, ext: f.ext, mime: f.mime, width: f.width, height: f.height, durationFrames: f.durationMs !== null ? Math.round((f.durationMs * ctx.fps) / 1000) : null, hasAudio: f.hasAudio, projectRel: f.projectRel };
      }
    }
    const r = applyOverrides({ ...timeline, assets: extra }, I.overrides, buildAnchorIndex(I.layout, I.layoutHash), { style: I.style, validateAsset: I.validateAsset, plans: I.plans });
    timeline = r.timeline;
    rejected = r.rejected;
    // keep only referenced assets
    const used = new Set(collectAssetIds(timeline));
    timeline = { ...timeline, assets: Object.fromEntries(Object.entries(timeline.assets).filter(([id]) => used.has(id))) };
  }
  // 13b. AI-illustration disclosure follows the final picture track (overrides may have swapped sources)
  timeline = reconcileAiLabels(timeline, (id) => isAiAsset(I.frozen[id]));
  // 14. check
  const parsed = Timeline.safeParse(timeline);
  if (!parsed.success) {
    throw new DocmakerError("INTERNAL", `director produced an invalid timeline: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, { details: parsed.error.issues.slice(0, 20) });
  }
  const lint = [
    ...ctx.issues,
    ...policyChecks(ctx, timeline),
    ...lintTimeline(timeline, I.style, { layout: I.layout, layoutHash: I.layoutHash, frozen: I.frozen, maxClipSeconds: maxClipSecondsOf(I) }),
    // a replaceSource refused by validateAsset is a POLICY error (§7.4, §16.6); other refusals stay warnings
    ...rejected.map((r) => (r.reason.startsWith("policy: ")
      ? { level: "error" as const, rule: "POLICY", where: r.id, msg: `override rejected — ${r.reason}` }
      : { level: "warn" as const, rule: "OVERRIDE_REJECTED", where: r.id, msg: r.reason })),
  ];
  const stats = computeStats(ctx, timeline, shots, { drops: arb.drops, cleanStretches: arb.cleanStretches, jl: ca.jl, keywordCaptions: caps.keywordCount, transitionCuts: sfx.transitionCuts, boundaries: sfx.boundaries });
  return { timeline, lint, stats, usage: buildUsage(timeline), rejectedOverrides: rejected };
}

function computeStats(ctx: Ctx, t: Timeline, shots: readonly Shot[], x: { drops: number; cleanStretches: number; jl: number; keywordCaptions: number; transitionCuts: number; boundaries: number }): DirectorStats {
  const fps = t.fps;
  const durationSec = t.durationInFrames / fps;
  const minutes = durationSec / 60;
  const keys = t.video.slice(1).map((c) => keyOf(c.transitionIn));
  const byKind: Record<string, number> = {};
  for (const k of keys) byKind[k] = (byKind[k] ?? 0) + 1;
  const nonCut = keys.filter((k) => k !== "cut").length;
  const counted = shots.slice(1).filter((s) => s.tkey !== "cut" && s.tsource !== "structural" && s.tsource !== "montage");
  const primary = counted.filter((s) => s.tkey === ctx.T.primary).length;
  const overlaysByKind: Record<string, number> = {};
  for (const o of t.overlays) overlaysByKind[o.component] = (overlaysByKind[o.component] ?? 0) + 1;
  const images = t.video.filter((c) => c.source.kind === "image");
  let maxStatic = 0;
  for (const c of t.video) {
    if (c.source.kind === "video") continue;
    const still = c.camera.keys.every((k) => k.scale === c.camera.keys[0]!.scale && k.x === c.camera.keys[0]!.x && k.y === c.camera.keys[0]!.y);
    if (still) maxStatic = Math.max(maxStatic, c.dur / fps);
  }
  let maxUp = 0;
  for (let i = 0; i < t.video.length; i++) maxUp = Math.max(maxUp, effectiveUpscale(t, i) ?? 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const events = timelineVisualEvents(t);
  const impacts = sfxEvents(t, isImpact).length;
  return {
    durationSec: r2(durationSec), shots: t.video.length, aslSec: r2(durationSec / Math.max(1, t.video.length)),
    nonCutShare: r2(nonCut / Math.max(1, keys.length)), primaryShare: r2(counted.length ? primary / counted.length : 0), transitionsByKind: byKind,
    punchPerMin: r2(punchEvents(t, ctx.style).length / Math.max(1e-9, minutes)), sfxPerMin: r2(sfxEvents(t).length / Math.max(1e-9, minutes)),
    impactsPerMin: r2(impacts / Math.max(1e-9, minutes)), overlaysByKind, silences: t.audio.silences.filter((s) => s.reason !== "bleep" && s.reason !== "user").length,
    jlCuts: x.jl, maxStaticHoldSec: r2(maxStatic), maxNoChangeSec: r2(maxGapFrames(t) / fps), eventsPer10s: r2(events.length / Math.max(1e-9, durationSec / 10)),
    captionGroups: t.captions.length, keywordCaptions: x.keywordCaptions, salienceDrops: x.drops, cleanStretches: x.cleanStretches,
    cardShare: r2(images.length ? images.filter((c) => c.layout === "card").length / images.length : 0), maxUpscale: r2(maxUp),
  };
}
