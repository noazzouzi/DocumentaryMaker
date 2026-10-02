// lintTimeline (§4.13 LINT_RULES table): errors fail `direct` unless --force; warnings are reported in stats and the UI.
import {
  COMPONENT_META, buildAnchorIndex, canonicalJson, collectAssetIds, isDocmakerError, resolveTimeline, timelineItemIds,
  type FrozenAsset, type LintIssue, type ProgramLayout, type StyleData, type Timeline,
} from "@docmaker/core";
import { holdOf } from "./overlays/hold";
import { cutsWithSfx, effectiveUpscale, isImpact, maxGapFrames, punchEvents, sfxEvents } from "./stats";
import { OVERLAPS, keyOf } from "./transitions";

/** Lint severities (§4.13 table): exported so the web app can render rule help. */
export const LINT_RULES: Readonly<Record<string, { level: "error" | "warn"; help: string }>> = {
  V_CONTIGUOUS: { level: "error", help: "The picture track is sorted and contiguous over [0, durationInFrames)." },
  V_BOUNDS: { level: "error", help: "Every item ends inside the program (from + dur ≤ durationInFrames)." },
  IDS_UNIQUE: { level: "error", help: "All timeline item ids are unique." },
  ASSET_MISSING: { level: "error", help: "Every asset referenced by the timeline has a TimelineAsset entry." },
  RESOLVE_MISMATCH: { level: "error", help: "Re-resolving the anchors against the same layout gives back the same timeline." },
  T_OVERLAP: { level: "error", help: "Overlap transitions: never on a chapter's first clip, even duration ≤ min(neighbours) − 2, media handles on both sides." },
  MEDIA_RANGE: { level: "error", help: "Video sources and clip audio stay inside their media, including overlap handles and J/L offsets." },
  ZONE_KEEPOUT: { level: "error", help: "No overlay inside a keep-out rect (player controls); burned captions inside the caption band." },
  OVERSHOOT: { level: "error", help: "Overshoot animation only for components the style allows (motion.overshootAllowedIn)." },
  FLASH_CAP: { level: "error", help: "Routine flashes ≤ flash.cap; explicit flashes ≤ explicitMax and ≤ explicitPerMin per 60 s." },
  TRANSITION_RUN: { level: "error", help: "Never 3 identical non-cut transitions in a row; transition kinds ≤ maxKindsPerFilm." },
  POLICY: { level: "error", help: "An on-screen asset fails the licence / AI / person policy (validatePick)." },
  PRIVATE_PERSON: { level: "error", help: "Overlay text names a minor or private victim, or a non-public person without a person-ack." },
  CLIP_SHARE: { level: "error", help: "Third-party clip time above maxClipShare.error of the runtime (error) or above .warn (warning)." },
  DENSITY_MAX: { level: "warn", help: "Per 60 s: SFX, impacts, punches and keyword slams stay under their caps." },
  DENSITY_MIN: { level: "warn", help: "Per 60 s (acts ≥ 90 s): SFX and punches reach their floors after the fill passes." },
  STATIC_HOLD: { level: "warn", help: "No picture or full-frame card holds longer than maxStaticHoldSec without motion." },
  NO_VISUAL_CHANGE: { level: "warn", help: "No window longer than visualChangeSec[1] + 1 s without a cut, punch, overlay entry or sub-beat." },
  READABILITY: { level: "warn", help: "An overlay is held shorter than its read policy, or a caption group is shorter than 0.5 s." },
  PRIMARY_SHARE: { level: "warn", help: "The primary transition's share of non-cut transitions is outside primaryShare." },
  SILENT_CUT_SHARE: { level: "warn", help: "The share of cuts without a transition SFX is outside silentCutShare ± 0.1." },
  SFX_REPEAT: { level: "warn", help: "The same SFX file plays twice in a row." },
  TECHNIQUE_FLOOR: { level: "warn", help: "Per-chapter or per-five-minute technique floors (punches, silences, J/L cuts) are unmet." },
  UPSCALE: { level: "warn", help: "A source is upscaled beyond maxUpscale after layout, camera and punch mitigation." },
  ASSET_REUSE: { level: "warn", help: "An asset is reused within assetReuseMinGapSec with the same layout and framing." },
};

/** Director notes that are not lint rules but appear in `direct` output (help for the UI). */
export const DIRECTOR_NOTES: Readonly<Record<string, string>> = {
  OVERLAY_PROPS: "An overlay was dropped because its derived props did not validate.",
  OVERLAY_CONFLICT: "An overlay was dropped because it overlapped a higher-priority overlay.",
  TEMPLATE_DATA: "A beat's motion data did not parse; its template was skipped.",
  TEMPLATE_FACTS: "A template referenced a fact (figure, quote, source) missing from the FactSheet; it was skipped.",
  PICK_ASSET: "A pick referenced an asset that is not frozen or not visual; it was ignored.",
  BEAT_PLAN_MISSING: "A layout beat had no plan; a neutral plan was used.",
  BLEEP_SKIPPED: "A SENSITIVE \"bleep\" cue outside a quoted passage was ignored (the narrator's own words are never bleeped).",
};

const issue = (level: "error" | "warn", rule: string, where: string, msg: string): LintIssue => ({ level, rule, where, msg });
const rectsHit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Acts ≥ exempt seconds as frame ranges (from the timeline chapters). */
function eligible(t: Timeline, style: StyleData): [number, number][] {
  const out: [number, number][] = [];
  let k = 0;
  while (k < t.chapters.length) {
    let j = k;
    while (j + 1 < t.chapters.length && t.chapters[j + 1]!.act === t.chapters[k]!.act) j++;
    const a = t.chapters[k]!.from, e = t.chapters[j]!.from + t.chapters[j]!.dur;
    if ((e - a) / t.fps >= style.techniqueFloor.exemptActsShorterThanSec) out.push([a, e]);
    k = j + 1;
  }
  return out;
}

function intensityRange(t: Timeline, style: StyleData, a: number, e: number): { min: number; max: number } {
  const xs = t.chapters.filter((c) => c.from < e && c.from + c.dur > a).map((c) => style.budgets.actIntensity[c.act] ?? 1);
  return { min: xs.length ? Math.min(...xs) : 1, max: xs.length ? Math.max(...xs) : 1 };
}

export function lintTimeline(t: Timeline, style: StyleData, ctx: { layout: ProgramLayout; layoutHash: string; frozen: Record<string, FrozenAsset> }): LintIssue[] {
  const out: LintIssue[] = [];
  const N = t.durationInFrames;
  const fps = t.fps;
  const S = (s: number) => Math.round(s * fps);

  // V_CONTIGUOUS
  if (t.video.length === 0) out.push(issue("error", "V_CONTIGUOUS", "global", "the picture track is empty"));
  else {
    if (t.video[0]!.from !== 0) out.push(issue("error", "V_CONTIGUOUS", t.video[0]!.id, "the first clip does not start at frame 0"));
    for (let i = 1; i < t.video.length; i++) {
      const p = t.video[i - 1]!, c = t.video[i]!;
      if (c.from !== p.from + p.dur) { out.push(issue("error", "V_CONTIGUOUS", c.id, `gap/overlap at frame ${c.from} (previous ends at ${p.from + p.dur})`)); break; }
    }
    const last = t.video[t.video.length - 1]!;
    if (last.from + last.dur !== N) out.push(issue("error", "V_CONTIGUOUS", last.id, `the last clip ends at ${last.from + last.dur}, not ${N}`));
  }
  // V_BOUNDS
  const timed = [...t.video, ...t.overlays, ...t.captions, ...t.fx, ...t.audio.vo, ...t.audio.music, ...t.audio.sfx, ...t.audio.clip, ...t.audio.silences];
  for (const it of timed) if (it.from < 0 || it.dur < 1 || it.from + it.dur > N) out.push(issue("error", "V_BOUNDS", it.id, `spans [${it.from}, ${it.from + it.dur}) outside [0, ${N})`));
  for (const m of t.markers) if (m.frame + m.dur > N) out.push(issue("error", "V_BOUNDS", m.id, "marker outside the program"));
  // IDS_UNIQUE
  const seen = new Set<string>();
  for (const id of timelineItemIds(t)) { if (seen.has(id)) out.push(issue("error", "IDS_UNIQUE", id, "duplicate item id")); seen.add(id); }
  // ASSET_MISSING
  for (const id of collectAssetIds(t)) if (!(id in t.assets)) out.push(issue("error", "ASSET_MISSING", id.slice(0, 12), `asset ${id} has no TimelineAsset`));
  // RESOLVE_MISMATCH
  if (ctx.layoutHash !== t.layoutHash) out.push(issue("error", "RESOLVE_MISMATCH", "global", "the timeline was built against another layout (re-direct required)"));
  else {
    try {
      const r = resolveTimeline(t, buildAnchorIndex(ctx.layout, ctx.layoutHash));
      if (r.dropped.length) out.push(issue("error", "RESOLVE_MISMATCH", r.dropped[0]!, `${r.dropped.length} item(s) do not resolve: ${r.dropped.slice(0, 5).join(", ")}`));
      else if (canonicalJson(r.timeline) !== canonicalJson(t)) {
        const ids = new Map(timelineItemsById(t));
        const diff = timelineItemsById(r.timeline).find(([id, v]) => canonicalJson(v) !== canonicalJson(ids.get(id)));
        out.push(issue("error", "RESOLVE_MISMATCH", diff?.[0] ?? "global", "anchors do not resolve to the item frames"));
      }
    } catch (e) {
      out.push(issue("error", "RESOLVE_MISMATCH", "global", isDocmakerError(e) ? e.message : String(e)));
    }
  }
  // T_OVERLAP + MEDIA_RANGE
  const chapterStarts = new Set(t.chapters.map((c) => c.from));
  const half = (i: number) => { const c = t.video[i]; return c && c.transitionIn.kind === "overlap" ? c.transitionIn.durationFrames / 2 : 0; };
  t.video.forEach((c, i) => {
    const tr = c.transitionIn;
    if (tr.kind === "overlap") {
      const p = t.video[i - 1];
      const d = tr.durationFrames;
      if (!p || chapterStarts.has(c.from)) out.push(issue("error", "T_OVERLAP", c.id, "overlap on a chapter's first clip"));
      else {
        if (d % 2 !== 0) out.push(issue("error", "T_OVERLAP", c.id, `odd overlap duration ${d}`));
        if (d > Math.min(p.dur, c.dur) - 2) out.push(issue("error", "T_OVERLAP", c.id, `overlap ${d} f too long for its neighbours`));
      }
    }
    if (c.source.kind === "video") {
      const a = t.assets[c.source.assetId];
      const head = half(i), tail = half(i + 1);
      if (c.source.sourceInFrames < head) out.push(issue("error", tr.kind === "overlap" ? "T_OVERLAP" : "MEDIA_RANGE", c.id, `needs ${head} f of head handle, has ${c.source.sourceInFrames}`));
      if (a?.durationFrames !== null && a?.durationFrames !== undefined && c.source.sourceInFrames + c.dur + tail > a.durationFrames) {
        out.push(issue("error", tail > 0 ? "T_OVERLAP" : "MEDIA_RANGE", c.id, `runs past its media (${c.source.sourceInFrames} + ${c.dur} + ${tail} > ${a.durationFrames})`));
      }
    }
  });
  for (const ca of t.audio.clip) {
    const a = t.assets[ca.assetId];
    if (ca.sourceInFrames < 0) out.push(issue("error", "MEDIA_RANGE", ca.id, "clip audio starts before its media"));
    if (a?.durationFrames !== null && a?.durationFrames !== undefined && ca.sourceInFrames + ca.dur > a.durationFrames) out.push(issue("error", "MEDIA_RANGE", ca.id, "clip audio runs past its media"));
  }
  // ZONE_KEEPOUT
  const lay = t.render.tokens.layout;
  for (const o of t.overlays) {
    if (o.zone === "full") continue;
    const r = lay.zones[o.zone];
    const k = lay.keepOut.find((x) => rectsHit(r, x));
    if (k) out.push(issue("error", "ZONE_KEEPOUT", o.id, `${o.component} in zone ${o.zone} intersects keep-out "${k.reason}"`));
  }
  if (t.captions.some((c) => c.burn)) {
    const k = lay.keepOut.find((x) => rectsHit(lay.zones.captionBand, x));
    if (k) out.push(issue("error", "ZONE_KEEPOUT", "captions", `caption band intersects keep-out "${k.reason}"`));
  }
  // OVERSHOOT
  for (const o of t.overlays) {
    if (COMPONENT_META[o.component].overshootAllowed && !t.render.motion.overshootAllowedIn.includes(o.component)) {
      out.push(issue("error", "OVERSHOOT", o.id, `${o.component} overshoots but the style does not allow it`));
    }
  }
  // FLASH_CAP
  const F = style.transitionPolicy.flash;
  const explicit: number[] = [];
  const flash = (where: string, f: number, peak: number) => {
    if (peak > F.cap + 1e-9) {
      if (peak > F.explicitMax + 1e-9) out.push(issue("error", "FLASH_CAP", where, `flash peak ${peak} > explicitMax ${F.explicitMax}`));
      explicit.push(f);
    }
  };
  for (const c of t.video) {
    const tr = c.transitionIn;
    if (tr.kind === "cover" && tr.presentation === "flash") flash(c.id, c.from, tr.peak);
    if (tr.kind === "cut" && tr.accent.type === "flash") flash(c.id, c.from, tr.accent.peak);
    if (tr.kind === "cut" && tr.accent.type === "velocity") flash(c.id, c.from, tr.accent.flash);
  }
  for (const f of t.fx) if (f.fx === "flash") flash(f.id, f.from, f.amt);
  explicit.sort((a, b) => a - b);
  for (let i = 0; i < explicit.length; i++) {
    const n = explicit.filter((x) => x >= explicit[i]! && x < explicit[i]! + S(60)).length;
    if (n > F.explicitPerMin) { out.push(issue("error", "FLASH_CAP", "global", `${n} explicit flashes within 60 s from frame ${explicit[i]}`)); break; }
  }
  // TRANSITION_RUN
  const T = style.transitionPolicy;
  const nonCut = t.video.slice(1).map((c) => ({ id: c.id, k: keyOf(c.transitionIn) })).filter((x) => x.k !== "cut");
  for (let i = 2; i < nonCut.length; i++) {
    if (nonCut[i]!.k === nonCut[i - 1]!.k && nonCut[i]!.k === nonCut[i - 2]!.k) { out.push(issue("error", "TRANSITION_RUN", nonCut[i]!.id, `3 × ${nonCut[i]!.k} in a row`)); break; }
  }
  const kinds = new Set(nonCut.map((x) => x.k));
  if (kinds.size > T.maxKindsPerFilm) out.push(issue("error", "TRANSITION_RUN", "global", `${kinds.size} transition kinds > maxKindsPerFilm ${T.maxKindsPerFilm}`));
  // CLIP_SHARE
  const clipFrames = t.video.filter((c) => c.beatId?.endsWith("-CLIP") && c.source.kind === "video").reduce((a, c) => a + c.dur, 0);
  const share = clipFrames / N;
  const cs = style.scriptProfile.maxClipShare;
  if (share > cs.error) out.push(issue("error", "CLIP_SHARE", "global", `clips fill ${(share * 100).toFixed(1)} % of the runtime (> ${cs.error * 100} %)`));
  else if (share > cs.warn) out.push(issue("warn", "CLIP_SHARE", "global", `clips fill ${(share * 100).toFixed(1)} % of the runtime (> ${cs.warn * 100} %)`));
  // DENSITY_MAX / DENSITY_MIN
  const W = S(60), step = S(10);
  const sfx = sfxEvents(t);
  const impacts = sfxEvents(t, isImpact);
  const punches = punchEvents(t, style);
  const slams = t.overlays.filter((o) => o.component === "KeywordSlam").map((o) => o.from);
  const count = (xs: readonly number[], a: number, e: number) => xs.filter((x) => x >= a && x < e).length;
  const maxRules: [string, readonly number[], number][] = [
    ["SFX", sfx, style.sfxPolicy.perMin[1]], ["impacts", impacts, style.sfxPolicy.impactsPerMin[1]],
    ["punches", punches, style.cameraPolicy.punch.perMin[1]], ["keyword slams", slams, style.budgets.keywordSlamPerMin],
  ];
  for (const [name, xs, cap] of maxRules) {
    for (let a = 0; a + W <= Math.max(N, W); a += step) {
      const I = intensityRange(t, style, a, a + W).max;
      const n = count(xs, a, a + W);
      if (n > Math.max(1, Math.floor(cap * I + 1e-9))) { out.push(issue("warn", "DENSITY_MAX", `${(a / fps).toFixed(0)}s`, `${n} ${name} in 60 s (cap ${cap})`)); break; }
    }
  }
  for (const [a0, e0] of eligible(t, style)) {
    if (e0 - a0 < W) continue;
    const mins: [string, readonly number[], number][] = [["SFX", sfx, style.sfxPolicy.perMin[0]], ["punches", punches, style.cameraPolicy.punch.perMin[0]]];
    for (const [name, xs, floor] of mins) {
      for (let a = a0; a + W <= e0; a += step) {
        const I = intensityRange(t, style, a, a + W).min;
        const n = count(xs, a, a + W);
        if (n < Math.ceil(floor * I - 1e-9)) { out.push(issue("warn", "DENSITY_MIN", `${(a / fps).toFixed(0)}s`, `${n} ${name} in 60 s (floor ${floor})`)); break; }
      }
    }
  }
  // STATIC_HOLD
  const maxStatic = S(style.cameraPolicy.shots.maxStaticHoldSec);
  const moving = (o: Timeline["overlays"][number]) => COMPONENT_META[o.component].fullFrame && COMPONENT_META[o.component].continuousMotion;
  for (const c of t.video) {
    if (c.source.kind === "video" || c.dur <= maxStatic) continue;
    const still = c.camera.keys.every((k) => k.scale === c.camera.keys[0]!.scale && k.x === c.camera.keys[0]!.x && k.y === c.camera.keys[0]!.y) && !c.camera.handheld;
    if (!still) continue;
    const covered = t.overlays.filter((o) => moving(o) && o.from < c.from + c.dur && o.from + o.dur > c.from).reduce((a, o) => a + Math.min(o.from + o.dur, c.from + c.dur) - Math.max(o.from, c.from), 0);
    if (c.dur - covered > maxStatic) out.push(issue("warn", "STATIC_HOLD", c.id, `static picture for ${(c.dur / fps).toFixed(1)} s`));
  }
  for (const o of t.overlays) {
    const m = COMPONENT_META[o.component];
    if (m.fullFrame && !m.continuousMotion && o.dur > maxStatic) out.push(issue("warn", "STATIC_HOLD", o.id, `${o.component} holds ${(o.dur / fps).toFixed(1)} s without motion`));
  }
  // NO_VISUAL_CHANGE
  const gap = maxGapFrames(t);
  if (gap > S(style.cameraPolicy.shots.visualChangeSec[1] + 1)) out.push(issue("warn", "NO_VISUAL_CHANGE", "global", `${(gap / fps).toFixed(1)} s without a visual change`));
  // READABILITY
  for (const o of t.overlays) {
    const m = COMPONENT_META[o.component];
    if (m.read.mode === "none") continue;
    const p = o.props as Record<string, unknown>;
    let narratedEnd: number | null = null;
    if (m.read.mode === "narrated") {
      const ats: number[] = [];
      const walk = (v: unknown) => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if ((k === "at" || /At$/.test(k)) && typeof x === "number") ats.push(x); else walk(x); }
      };
      walk(p);
      narratedEnd = ats.length ? Math.max(...ats) : 0;
    }
    const h = holdOf(o.component, p, fps, { narratedEnd, typeFrames: o.component === "DateStamp" ? Math.round((2 * [...String(p.text ?? "")].length * fps) / 30) : undefined });
    const need = Math.min(h.readHold, h.maxHold);
    if (o.dur < need) out.push(issue("warn", "READABILITY", o.id, `${o.component} held ${o.dur} f < read hold ${need} f`));
  }
  for (const c of t.captions) if (c.burn && c.dur < S(0.5)) out.push(issue("warn", "READABILITY", c.id, `caption group held ${c.dur} f (< 0.5 s)`));
  // PRIMARY_SHARE (non-structural, non-montage non-cut transitions)
  const counted = t.video.slice(1).filter((c, i) => {
    const prev = t.video[i]!;
    if (chapterStarts.has(c.from) || c.beatId?.endsWith("-BR")) return false;
    if (keyOf(c.transitionIn) === "cut") return false;
    return !(c.beatId === prev.beatId && keyOf(c.transitionIn) === T.montage.primary);
  });
  if (counted.length >= 5) {
    const ps = counted.filter((c) => keyOf(c.transitionIn) === T.primary).length / counted.length;
    if (ps < T.primaryShare[0] - 1e-9 || ps > T.primaryShare[1] + 1e-9) out.push(issue("warn", "PRIMARY_SHARE", "global", `primary share ${(ps * 100).toFixed(0)} % outside ${T.primaryShare.map((x) => x * 100).join("–")} %`));
  }
  // SILENT_CUT_SHARE
  const boundaries = t.video.length - 1;
  if (boundaries >= 10) {
    const silent = 1 - cutsWithSfx(t) / boundaries;
    const target = style.sfxPolicy.silentCutShare;
    if (Math.abs(silent - target) > 0.1 + 1e-9) out.push(issue("warn", "SILENT_CUT_SHARE", "global", `${(silent * 100).toFixed(0)} % silent cuts (target ${(target * 100).toFixed(0)} % ± 10)`));
  }
  // SFX_REPEAT
  const bySfx = [...t.audio.sfx].sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
  let repeats = 0;
  for (let i = 1; i < bySfx.length; i++) if (bySfx[i]!.assetId === bySfx[i - 1]!.assetId) repeats++;
  if (repeats) out.push(issue("warn", "SFX_REPEAT", "global", `${repeats} SFX play the same file as the previous one`));
  // TECHNIQUE_FLOOR
  const perCh = style.techniqueFloor.perChapter.punch ?? 0;
  for (const ch of t.chapters) {
    if (perCh > 0 && count(punches, ch.from, ch.from + ch.dur) < perCh) out.push(issue("warn", "TECHNIQUE_FLOOR", ch.id, `fewer than ${perCh} punch(es) in the chapter`));
  }
  const eligibleSec = eligible(t, style).reduce((a, [x, y]) => a + (y - x) / fps, 0);
  const pf = style.techniqueFloor.perFiveMin;
  const sil = t.audio.silences.filter((s) => s.reason !== "bleep" && s.reason !== "user").length;
  if (pf.silence !== undefined && sil < Math.floor((pf.silence * eligibleSec) / 300)) out.push(issue("warn", "TECHNIQUE_FLOOR", "global", `${sil} silences (floor ${pf.silence} per 5 min)`));
  const clipSegs = new Set(t.video.filter((c) => c.beatId?.endsWith("-CLIP") && c.source.kind === "video").map((c) => c.beatId));
  if (pf.jlCut !== undefined && clipSegs.size > 0) {
    let jl = 0;
    for (const ca of t.audio.clip) {
      const pics = t.video.filter((c) => c.beatId === `${ca.segmentId}-CLIP` && c.source.kind === "video");
      if (!pics.length) continue;
      if (ca.from < pics[0]!.from) jl++;
      if (ca.from + ca.dur > pics[pics.length - 1]!.from + pics[pics.length - 1]!.dur) jl++;
    }
    if (jl < Math.floor((pf.jlCut * eligibleSec) / 300)) out.push(issue("warn", "TECHNIQUE_FLOOR", "global", `${jl} J/L cuts (floor ${pf.jlCut} per 5 min)`));
  }
  // UPSCALE
  for (let i = 0; i < t.video.length; i++) {
    const u = effectiveUpscale(t, i);
    if (u !== null && u > style.cameraPolicy.maxUpscale + 0.01) out.push(issue("warn", "UPSCALE", t.video[i]!.id, `effective upscale ${u.toFixed(2)} > ${style.cameraPolicy.maxUpscale}`));
  }
  // ASSET_REUSE
  const lastUse = new Map<string, number>();
  const gapF = S(style.stills.assetReuseMinGapSec);
  t.video.forEach((c, i) => {
    if (c.source.kind !== "image" && c.source.kind !== "video") return;
    const id = c.source.assetId;
    const j = lastUse.get(id);
    lastUse.set(id, i);
    if (j === undefined || j === i - 1) return;
    const p = t.video[j]!;
    if (c.from - (p.from + p.dur) >= gapF) return;
    const framing = (x: typeof c) => (x.camera.kind === "reframe" ? `r${Math.round(x.camera.keys[0]!.scale * 10)}` : "base");
    if (p.layout === c.layout && framing(p) === framing(c) && !c.beatId?.endsWith("-CLIP")) out.push(issue("warn", "ASSET_REUSE", c.id, `asset reused ${((c.from - p.from - p.dur) / fps).toFixed(1)} s after ${p.id} with the same layout and framing`));
  });
  void ctx.frozen;
  void OVERLAPS;
  return out;
}

/** [id, item] pairs of every timed item (RESOLVE_MISMATCH diagnostics). */
function timelineItemsById(t: Timeline): [string, unknown][] {
  const a = t.audio;
  return [...t.video, ...t.overlays, ...t.captions, ...t.fx, ...a.vo, ...a.music, ...a.sfx, ...a.clip, ...a.silences].map((x) => [x.id, x]);
}
