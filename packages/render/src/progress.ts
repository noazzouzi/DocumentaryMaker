// Render progress (§12.4): weighted phases (bundle 5 %, chunks 85 %, concat 3 %, post 5 %, mux + gate 2 %),
// renormalised when a phase is skipped, emitted as `progress` events at ≤ 4 Hz (phase ends always go out).
import type { JobEventInput, Lang } from "@docmaker/core";

export type Phase = "bundle" | "chunks" | "concat" | "post" | "mux";
export const PHASE_WEIGHTS: Record<Phase, number> = { bundle: 0.05, chunks: 0.85, concat: 0.03, post: 0.05, mux: 0.02 };
const ORDER: readonly Phase[] = ["bundle", "chunks", "concat", "post", "mux"];

export class ProgressTracker {
  private readonly weights: Record<Phase, number>;
  private readonly done = new Map<Phase, number>();
  private last = -Infinity;
  private lastPct = -1;
  constructor(
    private readonly emit: (e: JobEventInput) => void,
    private readonly lang: Lang | null,
    skipped: readonly Phase[] = [],
    private readonly minIntervalMs = 250,
    private readonly now: () => number = () => performance.now(),
  ) {
    const active = ORDER.filter((p) => !skipped.includes(p));
    const sum = active.reduce((s, p) => s + PHASE_WEIGHTS[p], 0);
    this.weights = Object.fromEntries(ORDER.map((p) => [p, active.includes(p) && sum > 0 ? PHASE_WEIGHTS[p] / sum : 0])) as Record<Phase, number>;
  }
  /** Overall fraction for `phase` at local progress `frac` ∈ [0, 1]. */
  pctOf(phase: Phase, frac: number): number {
    let base = 0;
    for (const p of ORDER) {
      if (p === phase) break;
      base += this.weights[p];
    }
    return Math.max(0, Math.min(1, base + this.weights[phase] * Math.max(0, Math.min(1, frac))));
  }
  update(phase: Phase, frac: number, message: string, detail: Record<string, unknown> = {}, force = false): void {
    const pct = Math.max(this.lastPct, this.pctOf(phase, frac)); // monotonic
    this.done.set(phase, frac);
    const t = this.now();
    if (!force && frac < 1 && t - this.last < this.minIntervalMs) return;
    this.last = t;
    this.lastPct = pct;
    this.emit({ type: "progress", stage: "render", lang: this.lang, pct: Math.round(pct * 10_000) / 10_000, message, detail: { phase, ...detail } });
  }
}
