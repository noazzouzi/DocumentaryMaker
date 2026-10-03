// assembleVoProgram (§11.4): segment WAVs placed sample-exactly at frameToSample48k(segment.from), REVEAL insertions as
// digital silence inside the segment, digital zero elsewhere; then −16 LUFS baked in Node with a −1.5 dBFS sample-peak guard.
import { existsSync } from "node:fs";
import path from "node:path";
import { DocmakerError, frameToSample48k } from "@docmaker/core";
import type { ProgramLayout } from "@docmaker/core";
import { createWavWriter, measureEbur128, sha256File } from "@docmaker/core/node";
import { SR, audioLength48k, checkAbort, loadAudio48k, toDb, withTempDir, writeAtomically, yieldToLoop } from "../util";
import type { AudioCtx } from "../util";

export const VO_TARGET_LUFS = -16;
export const VO_PEAK_GUARD_DBFS = -1.5;
const BLOCK = 10 * SR;

/** One contiguous copy: source samples [srcFrom, srcTo) of `file` written at program sample `dst`. */
export interface VoPart { segmentId: string; file: string; dst: number; srcFrom: number; srcTo: number }

/** Lays out every copy (pure; exported for tests and the NLE exporter's cross-checks). */
export function planVoParts(layout: Pick<ProgramLayout, "fps" | "segments">, projectDir: string, lengths: ReadonlyMap<string, number>): VoPart[] {
  const parts: VoPart[] = [];
  for (const seg of layout.segments) {
    if (!seg.voFile) continue;
    const file = path.resolve(projectDir, seg.voFile);
    const n = lengths.get(file) ?? 0;
    const start = Math.round(frameToSample48k(seg.from, layout.fps));
    let src = 0;
    let shift = 0; // inserted silence so far
    for (const ins of [...seg.insertions].sort((a, b) => a.splitAtMs - b.splitAtMs)) {
      const split = Math.min(n, Math.max(src, Math.round((ins.splitAtMs * SR) / 1000)));
      if (split > src) parts.push({ segmentId: seg.segmentId, file, dst: start + src + shift, srcFrom: src, srcTo: split });
      src = split;
      shift += Math.round((ins.ms * SR) / 1000);
    }
    if (n > src) parts.push({ segmentId: seg.segmentId, file, dst: start + src + shift, srcFrom: src, srcTo: n });
  }
  return parts.sort((a, b) => a.dst - b.dst || (a.segmentId < b.segmentId ? -1 : 1));
}

/** Streams the program in 10 s blocks; segment audio is decoded lazily and dropped once its parts are written. */
async function renderProgram(parts: readonly VoPart[], L: number, ctx: AudioCtx, sink: (block: Float32Array) => Promise<void>): Promise<void> {
  const cache = new Map<string, Float32Array>();
  const lastUse = new Map<string, number>();
  for (const p of parts) lastUse.set(p.file, Math.max(lastUse.get(p.file) ?? 0, p.dst + (p.srcTo - p.srcFrom)));
  for (let b0 = 0; b0 < L; b0 += BLOCK) {
    checkAbort(ctx.signal, "VO program assembly");
    const b1 = Math.min(L, b0 + BLOCK);
    const block = new Float32Array(b1 - b0);
    for (const p of parts) {
      const pEnd = p.dst + (p.srcTo - p.srcFrom);
      if (pEnd <= b0 || p.dst >= b1) continue;
      let src = cache.get(p.file);
      if (!src) {
        src = (await loadAudio48k(p.file, 1, ctx)).data[0]!;
        cache.set(p.file, src);
      }
      const from = Math.max(b0, p.dst), to = Math.min(b1, pEnd);
      const off = p.srcFrom - p.dst;
      for (let k = from; k < to; k++) block[k - b0]! += src[k + off]!;
    }
    for (const [f, end] of lastUse) if (end <= b1) cache.delete(f);
    await sink(block);
    ctx.progress(b1 / L, "assembling the VO program");
    await yieldToLoop();
  }
}

export async function assembleVoProgramImpl(i: { layout: Omit<ProgramLayout, "voProgram">; projectDir: string; outRel: string }, ctx: AudioCtx): Promise<{ sha256: string; bakedGainDb: number; durationMs: number }> {
  const { layout, projectDir } = i;
  const L = Math.round(frameToSample48k(layout.durationInFrames, layout.fps));
  const lengths = new Map<string, number>();
  for (const seg of layout.segments) {
    if (!seg.voFile) continue;
    const file = path.resolve(projectDir, seg.voFile);
    if (!existsSync(file)) throw new DocmakerError("UPSTREAM_MISSING", `VO segment audio missing: ${seg.voFile}`, { hint: "re-run the voice stage" });
    if (!lengths.has(file)) lengths.set(file, await audioLength48k(file, ctx));
  }
  const parts = planVoParts(layout, projectDir, lengths);
  // sanity: overlaps sum, overruns are cut (both mean the layout and the take disagree)
  for (let k = 1; k < parts.length; k++) {
    const prev = parts[k - 1]!;
    if (prev.dst + (prev.srcTo - prev.srcFrom) > parts[k]!.dst) ctx.logger.warn("VO parts overlap; samples are summed", { a: prev.segmentId, b: parts[k]!.segmentId });
  }
  const last = parts[parts.length - 1];
  if (last && last.dst + (last.srcTo - last.srcFrom) > L) ctx.logger.warn("VO audio runs past the program end; cut", { segmentId: last.segmentId });

  return withTempDir("docmaker-vo-", async (tmpDir) => {
    // pass 1: raw program (f32) → loudness + sample peak
    const raw = path.join(tmpDir, "vo_raw.wav");
    const w1 = await createWavWriter(raw, { sampleRate: SR, channels: 1, format: "f32" });
    let peak = 0;
    try {
      await renderProgram(parts, L, ctx, async (block) => {
        for (let k = 0; k < block.length; k++) { const a = Math.abs(block[k]!); if (a > peak) peak = a; }
        await w1.write([block]);
      });
    } finally {
      await w1.close();
    }
    let bakedGainDb = 0;
    if (peak > 0) {
      const m = await measureEbur128(raw, { config: ctx.config, signal: ctx.signal });
      const loud = Number.isFinite(m.integratedLufs) && m.integratedLufs > -70 ? VO_TARGET_LUFS - m.integratedLufs : VO_PEAK_GUARD_DBFS - toDb(peak);
      bakedGainDb = Math.round(Math.min(loud, VO_PEAK_GUARD_DBFS - toDb(peak)) * 100) / 100;
    }
    // pass 2: the same program with the (rounded) gain baked in, s24 mono
    const g = Math.pow(10, bakedGainDb / 20);
    const out = path.resolve(projectDir, i.outRel);
    await writeAtomically(out, async (tmp) => {
      const w2 = await createWavWriter(tmp, { sampleRate: SR, channels: 1, format: "s24" });
      try {
        await renderProgram(parts, L, ctx, async (block) => {
          for (let k = 0; k < block.length; k++) block[k] = block[k]! * g;
          await w2.write([block]);
        });
      } finally {
        await w2.close();
      }
    });
    return { sha256: await sha256File(out), bakedGainDb, durationMs: Math.round((L * 1000) / SR) };
  });
}
