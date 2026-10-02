// Fx cue envelope (§10.6), the Timeline form of the prototype cueEnv (src/lib/motion.ts, MIT, makevoid).
//   t = f − cue.from
//   f < from − pre → 0 ;  f < from → q², q = (f − (from − pre) + 1)/(pre + 1) ;  t ≥ dur → 0
//   hit : decay != null ? exp(−decay·t/fps) : (1 − t/max(dur,1))^curve
//   span: zoom → min(1, easeOutExpo((t+1)/max(fade,1)))  (snap in, hold, no fade-out: "hold to the cut")
//         else → min(1, (t+1)/max(fade,1), (dur − t)/max(fade,1))
import type { FxCue } from "@docmaker/core";
import { easeOutExpo } from "../lib/easing";

export type EnvCue = Pick<FxCue, "fx" | "from" | "dur" | "pre" | "shape" | "curve" | "fade" | "decay">;

export function env(cue: EnvCue, f: number, fps: number): number {
  const pre = Math.max(0, cue.pre);
  if (f < cue.from - pre) return 0;
  if (f < cue.from) {
    const q = (f - (cue.from - pre) + 1) / (pre + 1);
    return q * q;
  }
  const t = f - cue.from;
  if (t >= cue.dur) return 0;
  if (cue.shape === "hit") {
    if (cue.decay != null) return Math.exp((-cue.decay * t) / Math.max(1, fps));
    const base = Math.max(0, 1 - t / Math.max(cue.dur, 1));
    return Math.pow(base, cue.curve > 0 ? cue.curve : 1);
  }
  const fade = Math.max(cue.fade, 1);
  if (cue.fx === "zoom") return Math.min(1, easeOutExpo((t + 1) / fade));
  return Math.max(0, Math.min(1, (t + 1) / fade, (cue.dur - t) / fade));
}

/** True when the cue can contribute at frame f (cheap pre-filter before env()). */
export const cueLive = (cue: Pick<FxCue, "from" | "dur" | "pre">, f: number): boolean => f >= cue.from - Math.max(0, cue.pre) && f < cue.from + cue.dur;

/** Pulse cut accent: scale = 1 + amt·(1 − t/frames)² for t ∈ [0, frames). */
export function pulseScale(p: { from: number; dur: number; amt: number }, f: number): number {
  const t = f - p.from;
  if (t < 0 || t >= p.dur) return 1;
  const k = 1 - t / Math.max(1, p.dur);
  return 1 + p.amt * k * k;
}
