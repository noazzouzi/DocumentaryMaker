// Shot boundaries for clip passages (§7.7 "shot-boundary snap ±0.5 s via cuts.py or scdet"). Detection never fails the stage:
// the sidecar `cuts` command when the Python venv exists, else ffmpeg's scdet filter, else no snapping.
import { existsSync } from "node:fs";
import path from "node:path";
import { isDocmakerError } from "@docmaker/core";
import type { Logger, RuntimeConfig } from "@docmaker/core";
import { run, runSidecar } from "@docmaker/core/node";

export const SNAP_TOLERANCE_MS = 500;
const SCDET_THRESHOLD = 10;

type CutsCtx = { config: RuntimeConfig; signal: AbortSignal; logger?: Pick<Logger, "debug"> };

/** Parses ffmpeg scdet log lines ("lavfi.scd.score: 21.6, lavfi.scd.time: 1.5") → source-clock ms (offset added). */
export function parseScdet(stderr: string, offsetMs: number): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)) {
    const t = Math.round(Number(m[2]) * 1000) + offsetMs;
    if (Number.isFinite(t)) out.push(t);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Hard cuts (ms, source clock) inside [fromMs, toMs] of `file`. */
export async function detectCuts(file: string, fromMs: number, toMs: number, ctx: CutsCtx): Promise<number[]> {
  const from = Math.max(0, Math.round(fromMs));
  const to = Math.max(from, Math.round(toMs));
  if (existsSync(path.join(ctx.config.paths.pyVenv, "bin", "python"))) {
    try {
      const r = await runSidecar<{ cuts: { t: number }[] }>("cuts", { video: file, ffmpeg: ctx.config.ffmpeg, fromMs: from, toMs: to, fps: 25 }, { config: ctx.config, signal: ctx.signal, timeoutMs: 120_000 });
      return r.cuts.map((c) => Math.round(c.t * 1000)).filter((t) => t >= from && t <= to).sort((a, b) => a - b);
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      ctx.logger?.debug("cuts sidecar failed; trying scdet", { error: (e as Error).message });
    }
  }
  const r = await run(ctx.config.ffmpeg, [
    "-hide_banner", "-nostdin", "-ss", (from / 1000).toFixed(3), "-to", (to / 1000).toFixed(3), "-i", file,
    "-an", "-vf", `scdet=threshold=${SCDET_THRESHOLD}`, "-f", "null", "-",
  ], { signal: ctx.signal });
  if (r.code !== 0) {
    ctx.logger?.debug("scdet failed; no shot snapping", { code: r.code });
    return [];
  }
  return parseScdet(r.stderr, from).filter((t) => t > from && t <= to);
}

/**
 * Moves the passage edges onto nearby shot boundaries (±tolerance) without cutting into the matched words:
 * the start snaps to a cut at or before the first matched word, the end to a cut at or after the last one.
 */
export function snapToCuts(w: { startMs: number; endMs: number }, match: { startMs: number; endMs: number }, cuts: readonly number[], tolMs = SNAP_TOLERANCE_MS): { startMs: number; endMs: number } {
  const best = (target: number, ok: (c: number) => boolean) => {
    let pick: number | null = null;
    for (const c of cuts) if (Math.abs(c - target) <= tolMs && ok(c) && (pick === null || Math.abs(c - target) < Math.abs(pick - target))) pick = c;
    return pick;
  };
  const s = best(w.startMs, (c) => c <= match.startMs);
  const e = best(w.endMs, (c) => c >= match.endMs);
  const startMs = s ?? w.startMs;
  const endMs = e ?? w.endMs;
  return endMs > startMs ? { startMs, endMs } : { startMs: w.startMs, endMs: w.endMs };
}
