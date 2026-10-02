// Step 5 — TRANSITIONS (§9.3): structural → proposals → seeded quota fill → constraint re-check (failure → cut).
import { DEFERRED_TRANSITIONS, lerp, weightedPick, type Direction, type Transition, type TransitionKey } from "@docmaker/core";
import { clamp, round2, takeExplicitFlash, type Ctx, type Shot, type TSource } from "./ctx";

export const VELOCITY: ReadonlySet<string> = new Set(["whip", "zoomThrough", "zoomThroughInverse", "cutTheCurve", "pushCut"]);
export const COVERS: ReadonlySet<string> = new Set(["flash", "dipToBlack", "dipToWhite", "lightLeak", "filmBurn", "whipStreaks", "glitch", "paperRip", "dotWipe", "iris"]);
export const OVERLAPS: ReadonlySet<string> = new Set(["dissolve", "blurDissolve", "push", "wipe"]);

/** The TransitionKey a built transition reads as (pulse accents are cuts). */
export function keyOf(t: Transition): TransitionKey {
  if (t.kind === "cut") return t.accent.type === "velocity" ? t.accent.preset : t.accent.type === "flash" ? "flash" : "cut";
  return t.presentation;
}

/** Overlap handles: frames needed after A's end (tail) / before B's start (head) for a centred overlap of d frames. */
export function overlapOk(A: Shot, B: Shot, d: number): boolean {
  if (d % 2 !== 0 || d < 4 || d > 30) return false;
  if (A.chapterId !== B.chapterId) return false;
  if (A.end - A.from < d + 2 || B.end - B.from < d + 2) return false;
  const h = d / 2;
  if (A.src.kind === "video" && A.src.mediaFrames !== null && A.src.sourceIn + (A.end - A.from) + h > A.src.mediaFrames) return false;
  if (B.src.kind === "video" && B.src.sourceIn - h < 0) return false;
  return true;
}

interface NonCut { frame: number; key: TransitionKey; structural: boolean; idx: number }

export function assignTransitions(ctx: Ctx, shots: Shot[]): void {
  const T = ctx.T;
  const window: boolean[] = []; // rolling decisions (true = non-cut), montage-internal cuts excluded
  const film = new Set<TransitionKey>();
  const actAccents = new Map<string, Set<TransitionKey>>();
  const nonCuts: NonCut[] = [];
  const whipDir = new Map<string, Direction>();
  let primaryCount = 0, quotaNonCut = 0;
  const allowedQuota = new Set<TransitionKey>([T.primary, ...T.accents]);
  const quotaWeights: Partial<Record<TransitionKey, number>> = {};
  for (const [k, w] of Object.entries(T.weights) as [TransitionKey, number][]) if (allowedQuota.has(k)) quotaWeights[k] = w;
  const accentWeights: Partial<Record<TransitionKey, number>> = { ...quotaWeights };
  delete accentWeights[T.primary];
  const share = (extra: boolean) => {
    const last = window.slice(-(T.quota.window - 1));
    return (last.filter(Boolean).length + (extra ? 1 : 0)) / T.quota.window;
  };

  // structural kinds are registered first so they always fit the film-kind budget
  for (let i = 1; i < shots.length; i++) {
    const B = shots[i]!;
    const ch = ctx.chapters.find((c) => c.id === B.chapterId)!;
    if (B.from !== ch.from || ch.idx === 0) continue;
    const prev = ctx.chapters[ch.idx - 1]!;
    const k = ch.macro !== prev.macro ? T.actBoundary : T.chapterBoundary === "cut+impact" ? "cut" : T.chapterBoundary;
    const mk = DEFERRED_TRANSITIONS[k] ?? k;
    if (mk !== "cut") film.add(mk);
  }

  for (let i = 1; i < shots.length; i++) {
    const A = shots[i - 1]!, B = shots[i]!;
    const ch = ctx.chapters.find((c) => c.id === B.chapterId)!;
    const b = B.beatId ? ctx.beatById.get(B.beatId) ?? null : null;
    const chapterStart = B.from === ch.from && ch.idx > 0;
    const macroStart = chapterStart && ch.macro !== ctx.chapters[ch.idx - 1]!.macro;
    const beatStart = B.beatId !== A.beatId;
    const montageInternal = B.role === "montage" && !beatStart;
    const energy = b?.energy ?? 3;
    const intensity = b?.intensity ?? 1;
    let key: TransitionKey = "cut";
    let source: TSource = "none";
    let structural = false;
    let explicit = false;

    // pass 1 — structural
    if (B.explicitFlash) { key = "flash"; source = "explicit"; explicit = ctx.explicitFlashes.includes(B.from); }
    else if (macroStart) { key = T.actBoundary; source = "structural"; structural = true; }
    else if (chapterStart) { key = T.chapterBoundary === "cut+impact" ? "cut" : T.chapterBoundary; source = "structural"; structural = true; }
    else if (montageInternal) { key = T.montage.primary; source = "montage"; }
    else if (beatStart && b) {
      // pass 2 — proposals
      if (b.montage) { key = T.montage.primary; source = "cue"; }
      else {
        const c0 = b.cues[0]?.type;
        const viaCue = c0 ? T.cueMap[c0] : undefined;
        if (viaCue) {
          key = viaCue; source = "cue";
          if ((c0 === "REVEAL" || c0 === "FLASHBACK") && (DEFERRED_TRANSITIONS[viaCue] ?? viaCue) === "flash") explicit = true;
        } else {
          const viaIntent = T.intentMap[b.plan.transitionIn];
          if (viaIntent && viaIntent !== "cut") {
            key = viaIntent; source = "intent";
            // intents are suggestions: while the primary share is below its band, an accent intent becomes the primary
            if (key !== T.primary && quotaNonCut >= 3 && primaryCount / quotaNonCut < (T.primaryShare[0] + T.primaryShare[1]) / 2) key = T.primary;
          }
        }
      }
      // pass 3 — quota fill
      if (key === "cut" && energy >= T.quota.minEnergy && share(false) < (1 - T.cutShare) - T.quota.tolerance && ctx.R(`trq:${b.id}`)() < intensity) {
        const ps = quotaNonCut >= 3 ? primaryCount / quotaNonCut : null;
        const r = ctx.R(`trw:${b.id}`);
        const mid = (T.primaryShare[0] + T.primaryShare[1]) / 2;
        const picked = ps !== null && ps < mid ? T.primary
          : ps !== null && ps > T.primaryShare[1] ? weightedPick(accentWeights, r) ?? T.primary
          : weightedPick(quotaWeights, r) ?? T.primary;
        key = picked; source = "quota";
      }
    }

    // duration (frames)
    const band = energy <= 2 ? "calm" : energy === 3 ? "medium" : "high";
    let d = ctx.F30(Math.round(lerp(T.energyFrames[band], ctx.R(`trd:${B.id}`)())));

    // pass 4 — constraints (re-checked after every substitution; failure → cut)
    if (key !== "cut") {
      const act = ch.act;
      const accents = actAccents.get(act) ?? new Set<TransitionKey>();
      const prevNon = nonCuts[nonCuts.length - 1];
      const montage = source === "montage";
      const lastRun = nonCuts.slice(-(T.noRepeatRun - 1)).map((x) => x.key);
      const overlapD = (k: TransitionKey) => (OVERLAPS.has(k) ? clamp(d + (d % 2), 4, 30) : d);
      const passes = (k: TransitionKey): "ok" | "cut" | "primary" | "run" => {
        if (!structural && !montage && share(true) > (1 - T.cutShare) + T.quota.tolerance) return "cut";
        if (!film.has(k) && film.size >= T.maxKindsPerFilm) return montage || k === T.primary ? "cut" : "primary";
        if (!structural && !montage && k !== T.primary && !accents.has(k) && accents.size >= T.accentKindsPerAct) return "primary";
        if (lastRun.length === T.noRepeatRun - 1 && lastRun.every((x) => x === k)) return "run";
        if (!structural && !montage && !explicit && !B.explicitFlash && prevNon && B.from - prevNon.frame < T.minGapFrames) return "cut";
        if (OVERLAPS.has(k) && (chapterStart || !overlapOk(A, B, overlapD(k)))) return "cut";
        return "ok";
      };
      const tried = new Set<TransitionKey>();
      for (let guard = 0; guard < 16; guard++) {
        key = (DEFERRED_TRANSITIONS[key] ?? key) as TransitionKey;
        if (tried.has(key)) { key = "cut"; break; }
        tried.add(key);
        const v = passes(key);
        if (v === "ok") break;
        if (v === "cut") { key = "cut"; break; }
        if (v === "primary") { key = T.primary; continue; }
        // run: the allowed kind with the highest weight passing every check, else cut
        const alts = (Object.entries(T.weights) as [TransitionKey, number][])
          .filter(([k, w]) => w > 0 && k !== key && !tried.has(k) && !DEFERRED_TRANSITIONS[k])
          .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
          .map(([k]) => k);
        const alt = montage ? undefined : alts.find((k) => passes(k) === "ok");
        if (!alt) { key = "cut"; break; }
        key = alt;
      }
      // structural transitions win the minimum gap
      if (key !== "cut" && (structural || explicit || B.explicitFlash) && prevNon && !prevNon.structural && B.from - prevNon.frame < T.minGapFrames) {
        const P = shots[prevNon.idx]!;
        P.transition = { kind: "cut", accent: { type: "none" } };
        P.tkey = "cut";
        P.tsource = "none";
        nonCuts.pop();
      }
      if (OVERLAPS.has(key)) d = clamp(d + (d % 2), 4, 30);
    }

    // build
    if (explicit && key === "flash" && !B.explicitFlash) explicit = takeExplicitFlash(ctx, B.from);
    if (key === "whip") {
      const next: Direction = whipDir.get(ch.act) === "left" ? "right" : "left";
      whipDir.set(ch.act, next);
    }
    B.transition = build(ctx, key, d, B, b?.hook ?? false, explicit, whipDir.get(ch.act) ?? "left");
    B.tkey = keyOf(B.transition);
    B.tsource = B.tkey === "cut" ? "none" : source;
    if (!montageInternal) window.push(B.tkey !== "cut");
    if (B.tkey !== "cut") {
      film.add(B.tkey);
      if (B.tkey !== T.primary && !structural && source !== "montage") {
        const set = actAccents.get(ch.act) ?? new Set<TransitionKey>();
        set.add(B.tkey);
        actAccents.set(ch.act, set);
      }
      nonCuts.push({ frame: B.from, key: B.tkey, structural: structural || explicit || B.explicitFlash, idx: i });
      if (!structural && source !== "montage") {
        quotaNonCut++;
        if (B.tkey === T.primary) primaryCount++;
      }
    }
  }
}

function build(ctx: Ctx, key: TransitionKey, d: number, B: Shot, hook: boolean, explicit: boolean, whip: Direction): Transition {
  const r = ctx.R(`trb:${B.id}`);
  const T = ctx.T;
  const F = ctx.F30;
  const cover = (presentation: Extract<Transition, { kind: "cover" }>["presentation"], frames: number, color: string, peak: number): Transition => ({
    kind: "cover", presentation, durationFrames: clamp(Math.round(frames), 2, 40), direction: "left", color, peak: round2(peak),
  });
  const velocity = (preset: "zoomThrough" | "zoomThroughInverse" | "whip" | "cutTheCurve" | "pushCut", exit: number, entry: number, flash: number, direction: Direction): Transition => ({
    kind: "cut", accent: { type: "velocity", preset, direction, exitFrames: clamp(exit, 0, 20), entryFrames: clamp(entry, 0, 30), flash: round2(clamp(flash, 0, 0.5)) },
  });
  switch (key) {
    case "cut":
      return hook && r() < ctx.P.cutAccent.share
        ? { kind: "cut", accent: { type: "pulse", amt: clamp(ctx.P.cutAccent.pulseAmt, 0, 0.1), frames: Math.max(1, F(8)) } }
        : { kind: "cut", accent: { type: "none" } };
    case "pulse": return { kind: "cut", accent: { type: "pulse", amt: clamp(ctx.P.cutAccent.pulseAmt, 0, 0.1), frames: Math.max(1, F(8)) } };
    case "flash": {
      const frames = clamp(Math.round(lerp(T.flash.frames, r())), 2, 4);
      const peak = explicit ? Math.min(T.flash.explicitMax, 0.8) : Math.min(lerp(T.flash.routine, r()), 0.45, T.flash.cap);
      return cover("flash", frames, "#FFFFFF", peak);
    }
    case "whip": return velocity("whip", F(8), F(8), 0, whip);
    case "zoomThrough": return velocity("zoomThrough", F(6), F(15), 0, "left");
    case "zoomThroughInverse": return velocity("zoomThroughInverse", F(6), F(15), 0, "left");
    case "cutTheCurve": return velocity("cutTheCurve", F(10), F(9), 0, "left");
    case "pushCut": {
      const flash = B.role === "montage" ? (B.snap === "downbeat" ? T.montage.flashPeak : 0) : 0.2;
      return velocity("pushCut", F(5), F(6), flash, "left");
    }
    case "dipToBlack": return cover("dipToBlack", F(Math.round(lerp([30, 40], r()))), "#000000", 1);
    case "dipToWhite": return cover("dipToWhite", F(Math.round(lerp([30, 40], r()))), "#FFFFFF", 1);
    case "lightLeak": return cover("lightLeak", F(Math.round(lerp([15, 30], r()))), "#FFB070", 0.8);
    case "filmBurn": return cover("filmBurn", F(Math.round(lerp([15, 30], r()))), "#FF7A1A", 0.9);
    case "glitch": return cover("glitch", F(Math.round(lerp([4, 8], r()))), "#FFFFFF", 0.8);
    case "paperRip": return cover("paperRip", F(Math.round(lerp([10, 15], r()))), "#F1EEE6", 1);
    case "dotWipe": return cover("dotWipe", F(13), "#000000", 1);
    case "iris": return cover("iris", F(12), "#000000", 1);
    case "whipStreaks": return cover("whipStreaks", F(8), "#FFFFFF", 0.8);
    case "dissolve": case "blurDissolve": case "push": case "wipe":
      return { kind: "overlap", presentation: key, durationFrames: clamp(d + (d % 2), 4, 30), direction: "left" };
  }
}
