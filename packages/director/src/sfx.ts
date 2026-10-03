// Step 11c — SFX auto-attach and selection (§9.5): candidates from the final events → silence rule → silent-cut share
// → greedy caps / min gap → variants (no repeat) → placement → fill to the floor.
import {
  COMPONENT_META, framesAt, ids, lerp, type SfxCategory, type SfxCue, type SfxEntry,
} from "@docmaker/core";
import { anchorAt, clamp, cueFrame, cueWord, intensityAt, rateOk, type Ctx, type Shot } from "./ctx";
import type { Fx } from "./fx";
import type { PlannedSilence } from "./music";
import type { Bleep, Ov } from "./overlays";
import { floorWindows } from "./punch";
import type { RevealInfo } from "./reveal";

type Combo = SfxCue["combo"];
export interface SfxCand {
  key: string; sourceItemId: string; category: SfxCategory; n: number | null; event: number; priority: number;
  align: "sync" | "onset"; loopFrames: number | null; durFrames: number | null; fadeIn: number; fadeOut: number;
  combo: Combo; transition: boolean; screenX: number | null; panSweep: "LR" | "RL" | null; gainAdj: number; reason: string;
  anchorWord: string | null; texture: boolean; impactLike: boolean;
}

const IMPACTS = new Set<SfxCategory>(["impact", "impact.soft", "boom.sub", "boom.low", "thud"]);
const FALLBACK: Partial<Record<SfxCategory, SfxCategory[]>> = {
  "impact.soft": ["impact", "thud"], "boom.low": ["boom.sub", "impact"], "boom.sub": ["boom.low", "impact"], thud: ["impact.soft", "impact"],
  "whoosh.heavy": ["whoosh.light"], "whoosh.whip": ["whoosh.light"], "whoosh.up": ["whoosh.light"], "swell.reverse": ["riser"],
  marker: ["click"], notification: ["ding", "pop"], cash: ["ding"], heartbeat: ["thud"], "tape.stop": ["glitch"], "ambience.crowd": ["ambience.room"],
  click: ["tick", "pop"], tick: ["click"], pop: ["click"], ding: ["pop"], keys: ["click"], shutter: ["click"],
};
const INTENT: Record<string, SfxCategory | null> = {
  whoosh: "whoosh.light", impact: "impact", riser: "riser", sub_boom: "boom.sub", record_scratch: "scratch", camera_shutter: "shutter",
  typing: "keys", cash_register: "cash", notification: "notification", heartbeat: "heartbeat", glitch: "glitch", text_pop: "pop", silence_drop: null,
};

export interface SfxEnv {
  shots: readonly Shot[]; overlays: readonly Ov[]; fx: readonly Fx[]; reveals: readonly RevealInfo[]; silences: readonly PlannedSilence[];
  bleeps: readonly Bleep[]; hits: readonly { beatId: string; frame: number }[]; droppedImpacts: ReadonlySet<string>; cleanRanges: readonly [number, number][];
}

function zoneX(ctx: Ctx, o: Ov): number {
  const r = ctx.tok.tokens.layout.zones[o.zone];
  return r.x + r.w / 2;
}

export function sfxCandidates(ctx: Ctx, env: SfxEnv): SfxCand[] {
  const out: SfxCand[] = [];
  const add = (c: Partial<SfxCand> & Pick<SfxCand, "sourceItemId" | "category" | "event" | "priority" | "reason">) => {
    out.push({
      key: "", n: null, align: "sync", loopFrames: null, durFrames: null, fadeIn: 0, fadeOut: 0, combo: null, transition: false, screenX: null, panSweep: null,
      gainAdj: 0, anchorWord: null, texture: false, impactLike: IMPACTS.has(c.category), ...c,
    });
  };
  const { shots } = env;
  // A. transitions
  let montageCount = 0;
  for (let i = 1; i < shots.length; i++) {
    const A = shots[i - 1]!, B = shots[i]!;
    const t = B.transition;
    const ev = B.from;
    const montageInternal = B.role === "montage" && A.beatId === B.beatId;
    if (montageInternal) {
      if (B.snap !== "none") {
        montageCount++;
        const lastSnapped = !shots.slice(i + 1).some((x) => x.beatId === B.beatId && x.snap !== "none");
        if (lastSnapped) add({ sourceItemId: B.id, category: "impact.soft", event: ev, priority: 2, reason: "montage last cut", transition: true });
        else if (montageCount % 2 === 0) add({ sourceItemId: B.id, category: "whoosh.light", event: ev, priority: 2, reason: "montage downbeat cut", transition: true });
      }
      continue;
    }
    montageCount = 0;
    if (t.kind === "cut" && t.accent.type === "velocity") {
      const p = t.accent.preset;
      if (p === "whip") add({ sourceItemId: B.id, category: "whoosh.whip", event: ev, priority: 3, reason: "whip cut", transition: true, panSweep: t.accent.direction === "left" ? "RL" : "LR" });
      else if (p === "zoomThrough" || p === "zoomThroughInverse") add({ sourceItemId: B.id, category: "whoosh.up", event: ev, priority: 3, reason: "zoom-through cut", transition: true });
      else add({ sourceItemId: B.id, category: "whoosh.light", event: ev, priority: 2, reason: `${p} cut`, transition: true });
    } else if (t.kind === "cover") {
      const d = t.durationFrames;
      const start = ev - Math.floor(d / 2);
      switch (t.presentation) {
        case "glitch": add({ sourceItemId: B.id, category: "glitch", event: Math.max(0, start), align: "onset", priority: 3, reason: "glitch cover", transition: true }); break;
        case "flash": if (t.peak > ctx.T.flash.cap) add({ sourceItemId: B.id, category: "shutter", event: ev, priority: 3, reason: "explicit flash", transition: true }); break;
        case "dipToBlack": case "dipToWhite": add({ sourceItemId: B.id, category: "boom.low", event: Math.max(0, start + Math.round(0.4 * d)), priority: 4, reason: "act boundary dip", transition: true }); break;
        case "lightLeak": case "filmBurn": add({ sourceItemId: B.id, category: "swell.reverse", event: ev, priority: 3, reason: `${t.presentation} cover`, transition: true }); break;
        case "paperRip": add({ sourceItemId: B.id, category: "paper", event: ev, priority: 3, reason: "paper rip", transition: true }); break;
        default: break;
      }
    } else if (t.kind === "cut" && A.beatId !== B.beatId) {
      const b = B.beatId ? ctx.beatById.get(B.beatId) : undefined;
      if (b && b.energy >= 4 && B.from !== b.ch.from) add({ sourceItemId: B.id, category: "whoosh.light", event: ev, priority: 1, reason: "cut into a high-energy beat", transition: true });
    }
    if (B.zoomCut) add({ sourceItemId: B.id, category: "whoosh.light", event: ev, priority: 2, reason: "zoom cut", transition: true });
  }
  // B. punches (amt ≥ 0.2), C. SHOCK plates
  let lastPunchWhoosh = -Infinity;
  for (const f of [...env.fx].sort((a, b) => a.from - b.from)) {
    if ((f.role === "punch" || f.role === "fillPunch") && f.amt >= 0.2 && f.from - lastPunchWhoosh >= ctx.S(ctx.P.punch.whooshMinGapSec)) {
      add({ sourceItemId: f.id, category: "whoosh.light", event: f.from, priority: 2, reason: "punch-in", anchorWord: f.anchorWord });
      lastPunchWhoosh = f.from;
    }
    if (f.role === "plate") add({ sourceItemId: f.id, category: "impact", event: f.from, priority: 5, reason: "SHOCK plate", anchorWord: f.anchorWord });
  }
  // D. RevealSequence
  for (const r of env.reveals) {
    const ref = `sil:reveal:${r.beat.id}`;
    if (r.hasSilence) add({ sourceItemId: ref, category: "riser", event: r.S0, priority: 4, reason: "reveal riser (ends at the silence)", combo: "reveal", anchorWord: r.wordId });
    add({ sourceItemId: ref, category: "impact", event: r.a, priority: 5, reason: "reveal impact", combo: "reveal", anchorWord: r.wordId });
  }
  // E. TENSION_BUILD, L. musicCue build / hit
  for (const b of ctx.beats) {
    const tension = b.cueTypes.has("TENSION_BUILD");
    if (tension || b.plan.musicCue === "build") {
      if (b.end - b.from >= ctx.S(6) || b.plan.musicCue === "build") add({ sourceItemId: b.id, category: "riser", event: b.end, priority: 3, reason: tension ? "tension build" : "music build" });
      else add({ sourceItemId: b.id, category: "drone", event: b.from, align: "onset", loopFrames: b.end - b.from, fadeIn: ctx.F30(15), fadeOut: ctx.F30(20), priority: 2, reason: "tension drone" });
    }
    if (b.energy <= 2 && b.end - b.from >= ctx.S(8) && b.seg.mode === "vo") {
      add({ sourceItemId: b.id, category: "ambience.room", event: b.from, align: "onset", loopFrames: b.end - b.from, fadeIn: ctx.F30(30), fadeOut: ctx.F30(30), priority: 1, reason: "quiet narration room tone" });
    }
  }
  for (const h of env.hits) {
    if (env.droppedImpacts.has(`hit:${h.beatId}`)) continue;
    add({ sourceItemId: h.beatId, category: "impact", event: h.frame, priority: 4, reason: "music hit" });
  }
  // F. chapter boundaries / chapter cards / title sting (one impact per chapter start)
  for (const ch of ctx.chapters) {
    if (ch.idx === 0) continue;
    const card = env.overlays.find((o) => (o.component === "ChapterCard" || o.component === "TitleSting") && o.from === ch.from);
    if (card || ctx.T.chapterBoundary === "cut+impact") add({ sourceItemId: card?.id ?? `mk:chapter:${ch.id}`, category: "impact", event: ch.from, priority: 5, reason: "chapter boundary" });
  }
  // G/H. overlay entries and VO-synced sub-beats
  for (const o of env.overlays) {
    const x = zoneX(ctx, o);
    const enter = (cat: SfxCategory, pr: number, extra: Partial<SfxCand> = {}) => add({ sourceItemId: o.id, category: cat, event: o.from, priority: pr, reason: `${o.component} entry`, screenX: x, anchorWord: o.anchorWord, ...extra });
    const at = (rel: number, cat: SfxCategory, pr: number, n: number | null, extra: Partial<SfxCand> = {}) => {
      if (rel < 0 || rel >= o.dur) return;
      add({ sourceItemId: o.id, category: cat, event: o.from + rel, priority: pr, n, reason: `${o.component} sub-beat`, screenX: x, ...extra });
    };
    const p = o.props as Record<string, unknown>;
    switch (o.component) {
      case "ChapterCard": case "TitleSting": case "SourceLabel": case "Letterbox": case "CensorBar": break;
      case "LowerThird": enter("pop", 2); break;
      case "SocialPost": at(p.revealAt as number, "notification", 2, null); break;
      case "ArticleHighlight": enter("paper", 2); at(p.highlightAt as number, "marker", 2, null); break;
      case "DocumentCard": enter("paper", 2); if (p.stamp) at(p.stampAt as number, "thud", 2, null); break;
      case "HeadlineStack": {
        const items = p.items as { at: number }[];
        items.forEach((it, k) => at(it.at, k === items.length - 1 ? "impact" : "paper", 2, k));
        break;
      }
      case "Stamp": enter("thud", 4, { combo: "click-whoosh" }); enter("click", 4, { combo: "click-whoosh" }); break;
      case "KeywordSlam": enter("boom.sub", 5); break;
      case "MapPin": enter("whoosh.light", 2); (p.places as { at: number }[]).forEach((pl, k) => at(pl.at, "pop", 2, k)); break;
      case "DateStamp": enter("keys", 2, { align: "onset", loopFrames: Math.max(1, Math.min(o.dur, ctx.F30(2 * [...String(p.text)].length))) }); break;
      case "QuoteCard": enter("paper", 2); break;
      case "FreezeLabel": enter("shutter", 4); enter("impact", 4); break;
      case "PhotoBurst": {
        const items = p.items as { at: number }[];
        items.forEach((it, k) => at(it.at, "shutter", 2, k));
        const last = items[items.length - 1]!.at;
        if (last > ctx.F30(10)) add({ sourceItemId: o.id, category: "riser", event: o.from + last, priority: 2, reason: "photo burst riser", combo: "riser-impact" });
        at(last, "impact", 2, null, { combo: "riser-impact" });
        break;
      }
      case "EvidenceBoard": {
        const moves = p.moves as { at: number; focus: number }[];
        const items = p.items as { x: number; y: number; at: number }[];
        let prev: { x: number; y: number } = { x: 1920, y: 1080 };
        moves.forEach((m, k) => {
          const tgt = m.focus >= 0 && items[m.focus] ? items[m.focus]! : { x: 1920, y: 1080 };
          const travel = Math.hypot(tgt.x - prev.x, tgt.y - prev.y) / 2; // board px → frame px (3840 → 1920)
          if (k > 0 && travel >= ctx.X.heavyWhooshMinMovePx) at(m.at, "whoosh.heavy", 2, k);
          prev = tgt;
        });
        items.forEach((it, k) => at(it.at, "click", 2, k));
        break;
      }
      case "CommentPile": (p.items as { at: number }[]).slice(0, 6).forEach((it, k) => at(it.at, "pop", 2, k)); break;
      case "NumberCounter": {
        const enterF = ctx.F30(COMPONENT_META.NumberCounter.enter30);
        const count = clamp(o.dur - enterF - ctx.F30(15), Math.min(o.dur - enterF, ctx.F30(45)), ctx.F30(90));
        const step = ctx.F30(3);
        const n = Math.min(12, Math.floor(count / step));
        for (let k = 0; k < n; k++) at(enterF + k * step, "tick", 1, k, { gainAdj: -6, texture: true });
        at(enterF + count, "ding", 3, null);
        break;
      }
      case "TimelineGraphic": (p.events as { at: number }[]).forEach((e, k) => at(e.at, "tick", 2, k)); break;
      case "BarChart": enter("tick", 2); break;
      default: {
        const cat = COMPONENT_META[o.component].defaultSfx[0];
        if (cat) enter(cat, 2);
      }
    }
  }
  // I. bleeps (exactly the word, with the VO silence)
  for (const bl of env.bleeps) add({ sourceItemId: `sil:bleep:${bl.wordId}`, category: "bleep", event: bl.from, align: "onset", durFrames: bl.dur, priority: 5, reason: "bleep", anchorWord: bl.wordId });
  // K. beat sfx intents: +1 to a matching candidate in the beat, else a new candidate at the beat start
  for (const b of ctx.beats) {
    for (const intent of b.plan.sfx) {
      const cat = INTENT[intent];
      if (!cat || (cat === "scratch" && !ctx.X.allowComedic)) continue;
      const match = out.find((c) => c.category === cat && c.event >= b.from && c.event < b.end);
      if (match) match.priority = Math.min(5, match.priority + 1);
      else add({ sourceItemId: b.id, category: cat, event: b.wordEnd > b.wordStart ? b.onset : b.from, priority: 2, reason: `beat sfx intent ${intent}` });
    }
  }
  // IRONY comedic scratch (only with comedic packs)
  if (ctx.X.allowComedic) {
    for (const b of ctx.beats) b.cues.forEach((c, k) => { if (c.type === "IRONY") add({ sourceItemId: b.id, category: "scratch", event: cueFrame(ctx, b, k), priority: 2, reason: "irony", anchorWord: cueWord(ctx, b, k)?.id ?? null }); });
  }
  // keys
  const count = new Map<string, number>();
  for (const c of out) {
    const base = c.n === null ? ids.sfx(c.sourceItemId, c.category) : ids.sfx(c.sourceItemId, c.category, c.n);
    const k = count.get(base) ?? 0;
    count.set(base, k + 1);
    c.key = k === 0 ? base : ids.sfx(c.sourceItemId, c.category, (c.n ?? 0) + 100 * k);
  }
  return out;
}

export interface SfxResult { items: SfxCue[]; transitionCuts: number; boundaries: number }

export function selectSfx(ctx: Ctx, env: SfxEnv, cands: SfxCand[]): SfxResult {
  const X = ctx.X;
  const byCat = new Map<SfxCategory, SfxEntry[]>();
  for (const e of [...ctx.I.sfx].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const arr = byCat.get(e.category) ?? [];
    arr.push(e);
    byCat.set(e.category, arr);
  }
  const resolveCat = (c: SfxCategory): SfxCategory | null => {
    if (byCat.has(c)) return c;
    for (const f of FALLBACK[c] ?? []) if (byCat.has(f)) return f;
    return null;
  };
  const useCount = new Map<SfxCategory, number>();
  const accepted: { c: SfxCand; e: SfxEntry; from: number; dur: number; peak: number; cat: SfxCategory }[] = [];
  const boundaries = Math.max(0, env.shots.length - 1);
  const maxTransition = Math.floor((1 - X.silentCutShare) * boundaries);
  const silentSfx = env.silences.filter((s) => s.affects.includes("sfx"));
  const inClean = (f: number) => env.cleanRanges.some(([a, b]) => f >= a && f < b);

  const place = (c: SfxCand, e: SfxEntry): { from: number; dur: number; peak: number } | null => {
    const peak = c.align === "onset" ? 0 : Math.round((e.peakOffsetMs * ctx.fps) / 1000);
    let event = c.event;
    let from = event - peak;
    if (from < 0) {
      if (-from > ctx.F30(6) || c.priority >= 5) return null;
      event -= from; from = 0;
    }
    if (from >= ctx.N) return null;
    let dur = c.durFrames ?? (c.loopFrames !== null && e.loopable ? c.loopFrames : Math.ceil((e.durationMs * ctx.fps) / 1000));
    dur = Math.max(1, Math.min(ctx.N - from, dur));
    return { from, dur, peak };
  };
  const audibleOk = (c: SfxCand, from: number, dur: number) => {
    if (c.combo === "reveal") return true;
    for (const s of silentSfx) {
      if (from < s.end && s.from < from + dur) {
        if (from === s.end && c.priority >= X.firstAfterSilenceMinPriority) continue;
        return false;
      }
    }
    return true;
  };
  const designed = (a: SfxCand, b: SfxCand) =>
    (a.combo !== null && a.combo === b.combo) || a.sourceItemId === b.sourceItemId
    || (a.category === "riser" && b.impactLike) || (b.category === "riser" && a.impactLike);

  const ROLL = new Set<SfxCategory>(["tick", "keys", "pop", "shutter", "click"]);
  const LONG = new Set<SfxCategory>(["riser", "drone", "swell.reverse", "ambience.room", "ambience.crowd"]);
  const rollLast = new Map<string, number>();
  const heads: { f: number; impact: boolean }[] = []; // density events (rolls of one item count once)
  const acceptedKeys = new Set<string>();
  // seams hidden under an opaque full-frame card: a cut whoosh would play over a static card
  const cards = env.overlays.filter((o) => COMPONENT_META[o.component].fullFrame && COMPONENT_META[o.component].band === "graphics");
  const hiddenSeam = (f: number) => cards.some((o) => o.from + framesAt(ctx.fps, COMPONENT_META[o.component].enter30) <= f - ctx.F30(4)
    && o.from + o.dur - framesAt(ctx.fps, COMPONENT_META[o.component].exit30) >= f + ctx.F30(4));
  const tryAccept = (c: SfxCand, texture: boolean): boolean => {
    const cat = resolveCat(c.category);
    if (!cat || acceptedKeys.has(c.key)) return false;
    if (c.transition && hiddenSeam(c.event)) return false;
    // a build (riser, reverse swell) needs a payoff: none in the last 2 s of the programme, the audio would end mid-build
    if ((cat === "riser" || cat === "swell.reverse") && c.combo !== "reveal" && c.event > ctx.N - ctx.S(2)) return false;
    if ((c.impactLike || texture) && c.priority < 5 && inClean(c.event)) return false;
    const entries = byCat.get(cat)!;
    const idx0 = ((useCount.get(cat) ?? 0) + Math.floor(ctx.R(`sfxv:${c.key}`)() * entries.length)) % entries.length;
    const e = entries[idx0]!;
    const pl = place(c, e);
    if (!pl) return false;
    if (!audibleOk(c, pl.from, pl.dur)) return false;
    if (LONG.has(cat) && accepted.some((a) => a.cat === cat && a.from < pl.from + pl.dur && pl.from < a.from + a.dur)) return false;
    const rollKey = `${c.sourceItemId}|${cat}`;
    const rollMember = ROLL.has(cat) && rollLast.has(rollKey) && Math.abs(rollLast.get(rollKey)! - c.event) <= ctx.fps;
    const intensity = intensityAt(ctx, c.event);
    // §9.5 step 4: the per-minute and impact caps hold for every SFX, priority 5 included (structural impacts compete
    // among themselves in rank order, see `ordered`); a bleep is a censor tone, not an accent, and is never capped
    if (!rollMember && cat !== "bleep") {
      if (!rateOk(ctx, heads.map((h) => h.f), c.event, X.perMin[1] * intensity)) return false;
      if (IMPACTS.has(cat) && !rateOk(ctx, heads.filter((h) => h.impact).map((h) => h.f), c.event, X.impactsPerMin[1] * intensity)) return false;
    }
    // a reveal riser builds into its impact: without the impact it would build into nothing
    if (c.combo === "reveal" && !IMPACTS.has(cat) && !accepted.some((a) => a.c.combo === "reveal" && a.c.sourceItemId === c.sourceItemId && IMPACTS.has(a.cat))) return false;
    if (accepted.some((a) => Math.abs(a.c.event - c.event) < X.minGapFrames && !designed(a.c, c))) return false;
    if (c.transition && accepted.filter((a) => a.c.transition).length >= maxTransition && c.priority < 5) return false;
    accepted.push({ c, e, from: pl.from, dur: pl.dur, peak: pl.peak, cat });
    acceptedKeys.add(c.key);
    if (!rollMember) heads.push({ f: c.event, impact: IMPACTS.has(cat) });
    if (ROLL.has(cat)) rollLast.set(rollKey, c.event);
    useCount.set(cat, (useCount.get(cat) ?? 0) + 1);
    return true;
  };

  // capped priority-5 impacts compete in this order: bleeps (uncapped), reveal payoffs, SHOCK plates, then the rest
  const rank5 = (c: SfxCand) => (c.priority < 5 ? 0 : c.category === "bleep" ? 4 : c.combo === "reveal" ? 3 : c.reason === "SHOCK plate" ? 2 : 1);
  // 1–4: deterministic order; transition candidates beyond the silent-cut share drop lowest priority first
  const trans = cands.filter((c) => c.transition).sort((a, b) => b.priority - a.priority || ctx.R(`sfxdrop:${a.key}`)() - ctx.R(`sfxdrop:${b.key}`)() || (a.key < b.key ? -1 : 1));
  const keepTrans = new Set(trans.slice(0, maxTransition).map((c) => c.key));
  const ordered = cands.filter((c) => !c.transition || keepTrans.has(c.key) || c.priority >= 5)
    .sort((a, b) => b.priority - a.priority || rank5(b) - rank5(a) || a.event - b.event || (a.key < b.key ? -1 : 1));
  // phase A: priority ≥ 2
  for (const c of ordered) if (c.priority >= 2) tryAccept(c, false);
  // phase B: about (1 − silentCutShare) of cuts carry an SFX — cut whooshes get the budget before detail sounds
  const has = (f: number) => accepted.some((a) => Math.abs(a.c.event - f) < X.minGapFrames);
  const energyOf = (sourceId: string) => ctx.beatById.get(env.shots.find((s) => s.id === sourceId)?.beatId ?? "")?.energy ?? 0;
  const soundedIn = (a: number, b: number) => env.shots.slice(1).filter((s) => s.from >= a && s.from < b && accepted.some((x) => x.c.event >= s.from - 2 && x.c.event <= s.from + 3)).length;
  if (X.fillToMin) {
    // per 60-s block, so the sounded cuts spread evenly instead of piling up in high-energy passages
    const block = ctx.S(60);
    for (let b0 = 0; b0 < ctx.N; b0 += block) {
      const b1 = Math.min(ctx.N, b0 + block);
      const cuts = env.shots.slice(1).filter((s) => s.from >= b0 && s.from < b1 && s.role !== "montage");
      const wantB = Math.round((1 - X.silentCutShare) * cuts.length);
      let have = soundedIn(b0, b1);
      const cutTex = cuts.map((s) => mkTexture(s.id, "whoosh.light", s.from, "texture: cut", true))
        .sort((a, b) => energyOf(b.sourceItemId) - energyOf(a.sourceItemId) || ctx.R(`sfxtex:${a.key}`)() - ctx.R(`sfxtex:${b.key}`)());
      for (const t of cutTex) {
        if (have >= wantB || accepted.filter((a) => a.c.transition).length >= maxTransition) break;
        if (has(t.event)) continue;
        if (tryAccept(t, true)) have++;
      }
    }
  }
  // phase C: the remaining (priority 1) detail sounds
  for (const c of ordered) if (c.priority < 2) tryAccept(c, false);

  // 7. fill (acts ≥ exempt): whoosh.light on energy ≥ 3 cuts, pops on overlay entries without SFX, ticks under counters
  if (X.fillToMin) {
    const textures: SfxCand[] = [];
    for (let i = 1; i < env.shots.length; i++) {
      const B = env.shots[i]!;
      if (B.role !== "montage" && energyOf(B.id) >= 3) textures.push(mkTexture(B.id, "whoosh.light", B.from, "texture: cut", true));
    }
    for (const o of env.overlays) {
      if (COMPONENT_META[o.component].band === "hud" || accepted.some((a) => a.c.sourceItemId === o.id)) continue;
      textures.push({ ...mkTexture(o.id, "pop", o.from, "texture: overlay entry", false), screenX: zoneX(ctx, o) });
    }
    for (const [w0, w1] of floorWindows(ctx)) {
      const minI = Math.min(...ctx.chapters.filter((c) => c.from < w1 && c.end > w0).map((c) => ctx.Bu.actIntensity[c.act] ?? 1));
      const floor = Math.ceil(X.perMin[0] * minI - 1e-9);
      for (const t of textures) {
        if (heads.filter((h) => h.f >= w0 && h.f < w1).length >= floor) break;
        if (t.event < w0 || t.event >= w1 || has(t.event)) continue;
        tryAccept(t, true);
      }
    }
  }

  // 5 (cont.). never the same file twice in a row (time order)
  accepted.sort((a, b) => a.from - b.from || (a.c.key < b.c.key ? -1 : 1));
  for (let i = 1; i < accepted.length; i++) {
    const p = accepted[i - 1]!, x = accepted[i]!;
    if (!X.noRepeat || p.e.assetId !== x.e.assetId) continue;
    const entries = byCat.get(x.cat)!;
    if (entries.length < 2) continue;
    const nextAsset = accepted[i + 1]?.e.assetId;
    const k = entries.indexOf(x.e);
    for (let d = 1; d < entries.length; d++) {
      const cand = entries[(k + d) % entries.length]!;
      if (cand.assetId !== p.e.assetId && cand.assetId !== nextAsset) {
        const pl = place(x.c, cand);
        if (pl) { x.e = cand; x.from = pl.from; x.dur = pl.dur; x.peak = pl.peak; }
        break;
      }
    }
  }

  // 6. placement → SfxCue
  const items: SfxCue[] = accepted.map(({ c, e, from, dur, peak }) => {
    const pk = X.peakDb[e.category] ?? [-22, -16];
    const r = ctx.R(`sfxg:${c.key}`);
    const gainDb = Math.round(((pk[0] + pk[1]) / 2 - e.peakDbfs + (r() * 3 - 1.5) + c.gainAdj) * 100) / 100;
    const pan = Math.round(clamp(((c.screenX ?? 960) - 960) / 1400, -0.7, 0.7) * 100) / 100;
    const whoosh = e.category.startsWith("whoosh");
    const hint = c.anchorWord ? { word: c.anchorWord } : {};
    const loop = c.loopFrames !== null && e.loopable && dur > Math.ceil((e.durationMs * ctx.fps) / 1000);
    return {
      id: c.key, start: anchorAt(ctx, from, hint), end: anchorAt(ctx, from + dur, hint), from, dur, sfxId: e.id, assetId: e.assetId, category: e.category,
      eventFrame: from + peak, peakOffsetFrames: peak, gainDb, pan, panSweep: whoosh ? c.panSweep ?? (e.direction === "RL" ? "RL" : e.direction === "LR" ? "LR" : null) : null,
      loop, fadeInFrames: Math.min(c.fadeIn, dur), fadeOutFrames: Math.min(c.fadeOut, dur), priority: clamp(Math.round(c.priority), 1, 5), combo: c.combo, reason: c.reason,
      sourceItemId: c.sourceItemId,
    };
  });
  return { items: items.sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1)), transitionCuts: accepted.filter((a) => a.c.transition).length, boundaries };
}

function mkTexture(source: string, cat: SfxCategory, event: number, reason: string, transition: boolean): SfxCand {
  return {
    key: ids.sfx(source, cat), sourceItemId: source, category: cat, n: null, event, priority: 1, align: "sync", loopFrames: null, durFrames: null,
    fadeIn: 0, fadeOut: 0, combo: null, transition, screenX: null, panSweep: null, gainAdj: 0, reason, anchorWord: null, texture: true, impactLike: false,
  };
}

export { lerp };
