// pickAssets (§7.6): greedy per slot with a reuse penalty (−0.30 per use within the last 6 beats; identity beats exempt).
import type { BeatPlan, Candidate, CandidateRecord, CandidateScore } from "@docmaker/core";
import { keyOf } from "./rank";

export const REUSE_PENALTY = 0.3;
export const REUSE_WINDOW_BEATS = 6;

export function pickAssets(i: { plan: BeatPlan; ranked: { record: CandidateRecord; score: CandidateScore }[]; shots: number; recentUse: ReadonlyMap<string, number> }): { candidate: Candidate; score: CandidateScore; slot: number }[] {
  const identity = i.plan.personIds.length > 0;
  const adjusted = i.ranked.map((r, idx) => {
    const uses = i.recentUse.get(keyOf(r.record.candidate)) ?? 0;
    const total = identity ? r.score.total : Math.max(0, r.score.total - REUSE_PENALTY * uses);
    return { r, idx, total };
  });
  adjusted.sort((a, b) => b.total - a.total || a.idx - b.idx);
  const out: { candidate: Candidate; score: CandidateScore; slot: number }[] = [];
  const used = new Set<string>();
  for (const a of adjusted) {
    if (out.length >= i.shots) break;
    const k = keyOf(a.r.record.candidate);
    if (used.has(k)) continue;
    used.add(k);
    out.push({ candidate: a.r.record.candidate, score: { ...a.r.score, total: Math.round(a.total * 1000) / 1000 }, slot: out.length });
  }
  return out;
}

/** Sliding window of asset uses over the last N beats (keys = provider:providerAssetId). */
export class RecentUse {
  private readonly window: string[][] = [];
  constructor(private readonly size = REUSE_WINDOW_BEATS) {}
  push(keys: string[]): void {
    this.window.push(keys);
    while (this.window.length > this.size) this.window.shift();
  }
  map(): Map<string, number> {
    const m = new Map<string, number>();
    for (const beat of this.window) for (const k of beat) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }
}
