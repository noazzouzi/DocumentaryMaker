// Step 6 — REVEALS, SHOCKS, FX (§9.3): reveal flash, SHOCK plate (punch + shake), impact shakes on slams and
// chapter/title cards (target "all"), montage beat punches. Punches live in punch.ts.
import { fnv1a32, ids, lerp, type FxCue, type FxKind } from "@docmaker/core";
import { cueFrame, cueWord, type Ctx, type Shot } from "./ctx";
import type { OvState } from "./overlays";
import type { RevealInfo } from "./reveal";
import { CLS } from "./overlays/state";

export type FxRole = "punch" | "fillPunch" | "plate" | "plateShake" | "impactShake" | "revealFlash" | "beatPunch" | "cardPunch" | "fadeOut";
export interface Fx extends Omit<FxCue, "start" | "end"> {
  role: FxRole; anchorWord: string | null; cls: number; dropped: boolean; sourceOv: string | null; beatId: string | null;
}

export class FxBook {
  readonly items: Fx[] = [];
  private used = new Set<string>();
  /** fx:<sourceId>:<kind>, made unique when a source carries two cues of one kind. */
  id(source: string, kind: FxKind): string {
    let id = ids.fx(source, kind);
    for (let n = 2; this.used.has(id); n++) id = ids.fx(`${source}~${n}`, kind);
    this.used.add(id);
    return id;
  }
  add(ctx: Ctx, source: string, o: Omit<Fx, "id" | "dropped" | "seed" | "pre" | "decay" | "hz" | "ampY" | "rotDeg" | "x" | "y" | "color" | "curve" | "fade" | "sourceOv" | "beatId"> & Partial<Fx>): Fx | null {
    const from = Math.max(0, Math.min(ctx.N - 1, Math.round(o.from)));
    const dur = Math.min(ctx.N - from, Math.round(o.dur));
    if (dur < 1) return null;
    const id = this.id(source, o.fx);
    const fx: Fx = {
      id, from, dur, fx: o.fx, shape: o.shape, pre: o.pre ?? 0, curve: o.curve ?? 1, fade: o.fade ?? 0, amt: Math.round(o.amt * 10000) / 10000,
      decay: o.decay ?? null, hz: o.hz ?? null, ampY: o.ampY ?? null, rotDeg: o.rotDeg ?? null, x: o.x ?? null, y: o.y ?? null, color: o.color ?? null,
      seed: o.seed ?? fnv1a32(id), target: o.target, role: o.role, anchorWord: o.anchorWord, cls: o.cls, dropped: false,
      sourceOv: o.sourceOv ?? null, beatId: o.beatId ?? null,
    };
    this.items.push(fx);
    return fx;
  }
  live(): Fx[] { return this.items.filter((f) => !f.dropped); }
}

/** Reveal flashes (when no cut was snapped onto the reveal word) and SHOCK plates. */
export function climaxFx(ctx: Ctx, book: FxBook, reveals: readonly RevealInfo[], snapped: ReadonlySet<string>): void {
  for (const r of reveals) {
    if (snapped.has(r.beat.id)) continue;
    const explicit = r.flashExplicit;
    book.add(ctx, r.wordId ?? r.beat.id, {
      fx: "flash", shape: "hit", amt: explicit ? Math.min(0.8, ctx.T.flash.explicitMax) : Math.min(0.45, ctx.T.flash.cap), from: r.a, dur: ctx.F30(3), curve: 2, color: "#FFFFFF", target: "picture",
      role: "revealFlash", anchorWord: r.wordId, cls: CLS.structural, beatId: r.beat.id,
    });
  }
  const P = ctx.P.plate;
  for (const b of ctx.beats) {
    b.cues.forEach((c, k) => {
      if (c.type !== "SHOCK") return;
      const a = cueFrame(ctx, b, k) + Math.round((P.anchorOffsetMs * ctx.fps) / 1000);
      const w = cueWord(ctx, b, k);
      const src = w?.id ?? `${b.id}:${k}`;
      book.add(ctx, src, { fx: "punch", shape: "hit", amt: P.punch, decay: P.decay, from: a, dur: ctx.S(P.windowSec), target: "picture+followers", role: "plate", anchorWord: w?.id ?? null, cls: CLS.structural, beatId: b.id });
      book.add(ctx, src, { fx: "shake", shape: "hit", amt: P.shakeX, ampY: P.shakeY, hz: P.hz, decay: 9, from: a, dur: ctx.S(0.6), target: "picture", role: "plateShake", anchorWord: w?.id ?? null, cls: CLS.structural, beatId: b.id });
    });
  }
}

/** impactShake on slam entries (KeywordSlam, FreezeLabel, HeadlineStack items) and ChapterCard / TitleSting entries. */
export function impactShakes(ctx: Ctx, book: FxBook, st: OvState): void {
  const I = ctx.P.impactShake;
  for (const o of st.items) {
    if (o.dropped) continue;
    const frames: number[] = [];
    if (o.component === "KeywordSlam" || o.component === "FreezeLabel" || o.component === "ChapterCard" || o.component === "TitleSting") frames.push(o.from);
    if (o.component === "HeadlineStack") {
      for (const it of (o.props.items as { at: number }[])) if (it.at < o.dur) frames.push(o.from + it.at);
    }
    frames.forEach((f, n) => {
      const r = ctx.R(`shk:${o.id}:${n}`);
      book.add(ctx, n === 0 ? o.id : `${o.id}:${n}`, {
        fx: "shake", shape: "hit", amt: lerp(I.ampPx, r()), rotDeg: Math.round(lerp(I.rotDeg, r()) * 100) / 100, from: f, dur: ctx.F30(Math.round(lerp(I.frames, r()))),
        curve: 2, target: "all", role: "impactShake", anchorWord: o.anchorWord, cls: o.cls, sourceOv: o.id, beatId: o.beatId,
      });
    });
  }
}

/** Montage: a beat punch (zoom hit) on every snapped cut. */
export function montagePunches(ctx: Ctx, book: FxBook, shots: readonly Shot[]): void {
  const bp = ctx.P.montage.beatPunch;
  for (const s of shots) {
    if (s.role !== "montage" || s.snap === "none") continue;
    book.add(ctx, s.id, {
      fx: "zoom", shape: "hit", amt: bp.amt, from: s.from, dur: Math.min(ctx.F30(bp.frames), s.end - s.from), curve: bp.curve,
      x: s.src.focal.x, y: s.src.focal.y, target: "picture+followers", role: "beatPunch", anchorWord: null, cls: CLS.structural, beatId: s.beatId,
    });
  }
}

/**
 * Programme end: the picture (and the graphics, unless a safe-messaging card must stay readable) fades to black over the
 * last 0.5–1.5 s — after the last narrated word when there is room — so the film never ends on a hard cut.
 */
export function outroFade(ctx: Ctx, book: FxBook, keepGraphics: boolean): Fx | null {
  const last = ctx.words[ctx.words.length - 1];
  const tail = last ? ctx.N - 1 - (last.from + last.dur) : ctx.S(1.5);
  const pre = Math.max(ctx.S(0.5), Math.min(ctx.S(1.5), tail));
  return book.add(ctx, "program:end", {
    fx: "dark", shape: "span", amt: 1, pre, fade: 1, from: ctx.N - 1, dur: 1, target: keepGraphics ? "picture" : "all",
    role: "fadeOut", anchorWord: null, cls: CLS.structural, beatId: null,
  });
}