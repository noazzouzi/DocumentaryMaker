// RevealSequence planning (§9.3 step 6, §9.6): the first REVEAL cue of each chapter.
import { lerp } from "@docmaker/core";
import { cueFrame, cueWord, takeExplicitFlash, type BeatCtx, type Ctx } from "./ctx";

export interface RevealInfo {
  chapterId: string; beat: BeatCtx; k: number; a: number; wordId: string | null;
  S0: number; silenceLen: number; hasSilence: boolean;
  flashExplicit: boolean; // false when the explicit-flash budget (per 60 s) is already used
}

/** Minimum silence that still reads as a "drop" before the reveal; shorter gaps degrade to impact + flash only. */
const MIN_SILENCE30 = 6;

export function planReveals(ctx: Ctx): RevealInfo[] {
  const out: RevealInfo[] = [];
  for (const ch of ctx.chapters) {
    let found: { b: BeatCtx; k: number } | null = null;
    for (const b of ch.beats) {
      const k = b.cues.findIndex((c) => c.type === "REVEAL");
      if (k >= 0) { found = { b, k }; break; }
    }
    if (!found) continue;
    const { b, k } = found;
    const a = cueFrame(ctx, b, k);
    const w = cueWord(ctx, b, k);
    const wi = w ? ctx.wordIndex.get(w.id)! : -1;
    const prev = wi > 0 ? ctx.words[wi - 1]! : null;
    const lastEnd = prev ? prev.from + prev.dur : ch.from;
    const want = ctx.S(lerp(ctx.M.dropBeforeRevealSec, ctx.R(`rvl:${b.id}`)()));
    const silenceLen = Math.max(0, Math.min(want, a - lastEnd - ctx.F30(2)));
    const hasSilence = silenceLen >= ctx.F30(MIN_SILENCE30) && a - silenceLen >= 0;
    out.push({
      chapterId: ch.id, beat: b, k, a, wordId: w ? w.id : null, S0: hasSilence ? a - silenceLen : a, silenceLen: hasSilence ? silenceLen : 0, hasSilence,
      flashExplicit: takeExplicitFlash(ctx, a),
    });
  }
  return out;
}

/** quiet(F) = [F − S(lerp(quietBeforeClimaxSec, .5)), F): no punches right before a climax. */
export function quietZones(ctx: Ctx, climaxFrames: readonly number[]): [number, number][] {
  const q = ctx.S(lerp(ctx.P.quietBeforeClimaxSec, 0.5));
  return climaxFrames.map((f) => [f - q, f] as [number, number]);
}
