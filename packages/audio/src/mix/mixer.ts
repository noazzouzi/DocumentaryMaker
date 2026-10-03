// mixTimeline (§11.5): the offline mixer. Gains come from core computeGainTables (the Player preview uses the same
// tables), interpolated per sample and smoothed (5 ms one-pole); silences are applied as exact sample masks so they are
// digital zero. Rendering is block-based (10 s, yielding to the event loop per block) and runs twice: pass 1 measures
// the raw master, pass 2 applies the loudness gain (+ the true-peak limiter when needed) and writes the mix and stems.
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, computeGainTables, dbToGain, frameToSample48k } from "@docmaker/core";
import type { LoudnessDoc, SfxEntry, Timeline } from "@docmaker/core";
import { createWavWriter, measureEbur128 } from "@docmaker/core/node";
import type { WavData } from "@docmaker/core/node";
import { installedEntriesById } from "../sfx/packs";
import { SR, checkAbort, loadAudio48k, withTempDir, writeAtomically, yieldToLoop } from "../util";
import type { AudioCtx } from "../util";
import { TruePeakLimiter } from "./limiter";
import { equalPowerPan, shouldMirror } from "./pan";

export const MIX_BLOCK = 10 * SR;
const SMOOTH_MS = 5;
const DECLICK = Math.round(0.0025 * SR); // 2.5 ms ramps at hard item edges and around silences
const LIMITER_MARGIN_DB = 0.3;
const STEMS = ["vo", "music", "sfx", "clip"] as const;
type Stem = (typeof STEMS)[number];
type Table = "music" | "sfx" | "clip" | "vo";

export interface MixInput { projectDir: string; outMixRel: string; stemRels: Record<Stem, string>; targetLufs: number; truePeakTarget: number }
export type MixResult = Omit<LoudnessDoc, "schemaVersion" | "lang">;

interface Stereo { L: Float32Array; R: Float32Array; length: number }
interface Item {
  src: Stereo; start: number; end: number; srcOffset: number; loop: boolean;
  gL: number; gR: number; mirror: boolean;
  fadeIn: number; fadeOut: number; // samples (item envelope)
  declickIn: boolean; declickOut: boolean;
  table: Table | null; // gain table multiplied in (null: silence mask of `maskOf` only)
  maskOf: Table | null;
}

const toStereo = (w: WavData): Stereo => ({ L: w.data[0]!, R: w.data[1] ?? w.data[0]!, length: w.data[0]!.length });
const f2s = (frames: number, fps: number) => Math.round(frameToSample48k(frames, fps));

/** Merged silence spans in samples per table. */
function silenceSpans(t: Timeline): Record<Table, [number, number][]> {
  const out: Record<Table, [number, number][]> = { music: [], sfx: [], clip: [], vo: [] };
  for (const s of t.audio.silences) {
    const a = f2s(Math.max(0, s.from), t.fps), b = f2s(Math.min(t.durationInFrames, s.from + s.dur), t.fps);
    if (b <= a) continue;
    for (const k of s.affects) out[k].push([a, b]);
  }
  for (const k of Object.keys(out) as Table[]) {
    const v = out[k].sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const s of v) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else merged.push([s[0], s[1]]);
    }
    out[k] = merged;
  }
  return out;
}

/** 0 inside spans, 2.5 ms linear ramps just outside them (no clicks), 1 elsewhere. */
function fillMask(out: Float32Array, b0: number, spans: readonly [number, number][]): void {
  out.fill(1);
  const b1 = b0 + out.length;
  for (const [s, e] of spans) {
    if (e + DECLICK <= b0 || s - DECLICK >= b1) continue;
    for (let n = Math.max(b0, s - DECLICK); n < Math.min(b1, e + DECLICK); n++) {
      let v: number;
      if (n < s) v = (s - n) / DECLICK;
      else if (n < e) v = 0;
      else v = (n - e + 1) / DECLICK;
      if (v < out[n - b0]!) out[n - b0] = v;
    }
  }
}

/** Renders the program block by block; deterministic (state is reset per pass). */
class Renderer {
  private readonly smooth: Record<Table, number> = { music: NaN, sfx: NaN, clip: NaN, vo: NaN };
  private readonly a = 1 - Math.exp(-1 / ((SMOOTH_MS / 1000) * SR));
  constructor(
    private readonly t: Timeline,
    private readonly tables: Record<Table, Float32Array>, // unsilenced gain tables (per frame)
    private readonly spans: Record<Table, [number, number][]>,
    private readonly vo: Float32Array | null,
    private readonly items: Record<Exclude<Stem, "vo">, Item[]>,
  ) {}

  /** Per-sample gain of a table: frame interpolation → 5 ms smoother → exact silence mask. */
  private gains(k: Table, b0: number, len: number): { g: Float32Array; mask: Float32Array } {
    const T = this.tables[k];
    const N = T.length;
    const fps = this.t.fps;
    const mask = new Float32Array(len);
    fillMask(mask, b0, this.spans[k]);
    const g = new Float32Array(len);
    let y = this.smooth[k];
    for (let i = 0; i < len; i++) {
      const x = ((b0 + i) * fps) / SR;
      const f = Math.floor(x);
      const t0 = T[Math.min(N - 1, f)] ?? 1;
      const t1 = T[Math.min(N - 1, f + 1)] ?? 1;
      const v = (t0 + (t1 - t0) * (x - f)) * mask[i]!;
      if (Number.isNaN(y)) y = v;
      y += this.a * (v - y);
      g[i] = y * mask[i]!;
    }
    this.smooth[k] = y;
    return { g, mask };
  }

  private addItems(list: readonly Item[], b0: number, outL: Float32Array, outR: Float32Array, G: Partial<Record<Table, { g: Float32Array; mask: Float32Array }>>): void {
    const b1 = b0 + outL.length;
    for (const it of list) {
      if (it.end <= b0 || it.start >= b1) continue;
      const from = Math.max(b0, it.start, 0), to = Math.min(b1, it.end);
      const len = it.src.length;
      if (len === 0) continue;
      const dur = it.end - it.start;
      const gt = it.table ? G[it.table]!.g : null;
      const mk = !it.table && it.maskOf ? G[it.maskOf]!.mask : null;
      const sL = it.mirror ? it.src.R : it.src.L;
      const sR = it.mirror ? it.src.L : it.src.R;
      for (let n = from; n < to; n++) {
        const local = n - it.start;
        let si = it.srcOffset + local;
        if (it.loop) si %= len;
        else if (si >= len) break;
        if (si < 0) continue;
        let env = 1;
        if (it.fadeIn > 0 && local < it.fadeIn) env = local / it.fadeIn;
        if (it.fadeOut > 0 && dur - local <= it.fadeOut) env = Math.min(env, (dur - local) / it.fadeOut);
        if (it.declickIn && local < DECLICK) env *= local / DECLICK;
        if (it.declickOut && dur - local <= DECLICK) env *= (dur - local) / DECLICK;
        const tg = gt ? gt[n - b0]! : mk ? mk[n - b0]! : 1;
        const e = env * tg;
        if (e === 0) continue;
        outL[n - b0]! += sL[si]! * it.gL * e;
        outR[n - b0]! += sR[si]! * it.gR * e;
      }
    }
  }

  block(b0: number, len: number): Record<Stem, [Float32Array, Float32Array]> {
    const G = { music: this.gains("music", b0, len), sfx: this.gains("sfx", b0, len), clip: this.gains("clip", b0, len), vo: this.gains("vo", b0, len) };
    const voL = new Float32Array(len);
    if (this.vo) {
      const v = this.vo, g = G.vo.g;
      for (let i = 0; i < len; i++) { const s = b0 + i; voL[i] = s < v.length ? v[s]! * g[i]! : 0; }
    }
    const out = {
      vo: [voL, voL.slice()] as [Float32Array, Float32Array],
      music: [new Float32Array(len), new Float32Array(len)] as [Float32Array, Float32Array],
      sfx: [new Float32Array(len), new Float32Array(len)] as [Float32Array, Float32Array],
      clip: [new Float32Array(len), new Float32Array(len)] as [Float32Array, Float32Array],
    };
    this.addItems(this.items.music, b0, out.music[0], out.music[1], G);
    this.addItems(this.items.sfx, b0, out.sfx[0], out.sfx[1], G);
    this.addItems(this.items.clip, b0, out.clip[0], out.clip[1], G);
    return out;
  }
}

/** Loads every source and plans items (sample windows, gains, envelopes). */
async function prepare(t: Timeline, i: MixInput, ctx: AudioCtx): Promise<{ vo: Float32Array | null; items: Record<Exclude<Stem, "vo">, Item[]> }> {
  const fps = t.fps;
  const L = f2s(t.durationInFrames, fps);
  const fileOf = (assetId: string): string | null => {
    const a = t.assets[assetId];
    return a ? path.resolve(i.projectDir, a.projectRel) : null;
  };
  const cache = new Map<string, Promise<Stereo | null>>();
  const load = (assetId: string, what: string): Promise<Stereo | null> => {
    let p = cache.get(assetId);
    if (!p) {
      p = (async () => {
        const f = fileOf(assetId);
        if (!f || !existsSync(f)) {
          ctx.logger.warn(`mix: ${what} audio missing; skipped`, { assetId, file: f });
          return null;
        }
        try {
          return toStereo(await loadAudio48k(f, 2, ctx));
        } catch (e) {
          if (e instanceof DocmakerError && e.code === "CANCELED") throw e;
          ctx.logger.warn(`mix: ${what} audio could not be decoded; skipped`, { assetId, file: f, error: String(e) });
          return null;
        }
      })();
      cache.set(assetId, p);
    }
    return p;
  };

  // VO program (required unless the timeline has no voice at all)
  let vo: Float32Array | null = null;
  const voFile = fileOf(t.audio.voProgram.assetId);
  if (voFile && existsSync(voFile)) vo = (await loadAudio48k(voFile, 1, ctx)).data[0]!;
  else if (t.audio.voSpans.length > 0) throw new DocmakerError("UPSTREAM_MISSING", "the VO program is missing", { hint: "re-run the layout stage", details: { file: voFile } });

  const items: Record<Exclude<Stem, "vo">, Item[]> = { music: [], sfx: [], clip: [] };
  for (const m of t.audio.music) {
    const src = await load(m.assetId, `music ${m.id}`);
    if (!src) continue;
    const srcOffset = f2s(m.sourceInFrames, fps);
    items.music.push({
      src, start: f2s(m.from, fps), end: Math.min(L, f2s(m.from + m.dur, fps)), srcOffset: m.loop && src.length ? srcOffset % src.length : srcOffset, loop: m.loop,
      gL: dbToGain(m.gainDb), gR: dbToGain(m.gainDb), mirror: false,
      fadeIn: f2s(m.fadeInFrames, fps), fadeOut: f2s(m.fadeOutFrames, fps),
      declickIn: m.fadeInFrames === 0 && srcOffset > 0, declickOut: m.fadeOutFrames === 0, table: "music", maskOf: null,
    });
  }
  const entries = t.audio.sfx.length ? await installedEntriesById(ctx.config) : new Map<string, SfxEntry>();
  for (const c of t.audio.sfx) {
    const src = await load(c.assetId, `SFX ${c.id}`);
    if (!src) continue;
    const entry = entries.get(c.sfxId);
    // the file's sync point lands exactly on the event: sample-accurate offset from the manifest when available
    const offset = entry && entry.assetId === c.assetId ? Math.round((entry.peakOffsetMs * SR) / 1000) : f2s(c.eventFrame - c.from, fps);
    const start = f2s(c.eventFrame, fps) - offset;
    const loop = c.loop && (entry?.loopable ?? true);
    const lenS = f2s(c.dur, fps);
    const end = Math.min(L, start + (loop ? lenS : Math.min(lenS, src.length)));
    const direction = entry?.direction ?? (c.sfxId.startsWith("procedural:whoosh") ? "LR" : "none");
    const [pl, pr] = equalPowerPan(c.pan);
    const g = dbToGain(c.gainDb);
    items.sfx.push({
      src, start, end, srcOffset: 0, loop, gL: g * pl, gR: g * pr, mirror: shouldMirror(c.panSweep, direction),
      fadeIn: f2s(c.fadeInFrames, fps), fadeOut: f2s(c.fadeOutFrames, fps),
      declickIn: start < 0, declickOut: !loop && c.fadeOutFrames === 0 && end - start < src.length, table: "sfx", maskOf: null,
    });
  }
  for (const c of t.audio.clip) {
    const src = await load(c.assetId, `clip ${c.id}`);
    if (!src) continue;
    const g = dbToGain(c.gainDb);
    items.clip.push({
      src, start: f2s(c.from, fps), end: Math.min(L, f2s(c.from + c.dur, fps)), srcOffset: f2s(c.sourceInFrames, fps), loop: false,
      gL: g, gR: g, mirror: false, fadeIn: 0, fadeOut: 0, declickIn: true, declickOut: true,
      table: c.duckUnderVo ? "clip" : null, maskOf: "clip",
    });
  }
  return { vo, items };
}

export async function mixTimelineImpl(t: Timeline, i: MixInput, ctx: AudioCtx): Promise<MixResult> {
  const L = f2s(t.durationInFrames, t.fps);
  if (L <= 0) throw new DocmakerError("VALIDATION", "mixTimeline: empty timeline");
  ctx.progress(0, "loading mix sources");
  const { vo, items } = await prepare(t, i, ctx);
  computeGainTables(t); // the preview's tables (validates the timeline the same way)
  const unsilenced = computeGainTables({ ...t, audio: { ...t.audio, silences: [] } });
  const tables: Record<Table, Float32Array> = { music: unsilenced.music, sfx: unsilenced.sfx, clip: unsilenced.clip, vo: unsilenced.vo };
  const spans = silenceSpans(t);

  const pass = async (label: string, p0: number, p1: number, sink: (b: Record<Stem, [Float32Array, Float32Array]>, master: [Float32Array, Float32Array]) => Promise<void>) => {
    const r = new Renderer(t, tables, spans, vo, items);
    for (let b0 = 0; b0 < L; b0 += MIX_BLOCK) {
      checkAbort(ctx.signal, "mix");
      const len = Math.min(MIX_BLOCK, L - b0);
      const b = r.block(b0, len);
      const mL = new Float32Array(len), mR = new Float32Array(len);
      for (const s of STEMS) {
        const [x, y] = b[s];
        for (let k = 0; k < len; k++) { mL[k]! += x[k]!; mR[k]! += y[k]!; }
      }
      await sink(b, [mL, mR]);
      ctx.progress(p0 + ((p1 - p0) * (b0 + len)) / L, label);
      await yieldToLoop();
    }
  };

  return withTempDir("docmaker-mix-", async (tmp) => {
    // ---- pass 1: raw master → integrated loudness and true peak
    const raw = path.join(tmp, "master_raw.wav");
    const w1 = await createWavWriter(raw, { sampleRate: SR, channels: 2, format: "f32" });
    let rawPeak = 0;
    try {
      await pass("mixing (measure)", 0.02, 0.4, async (_b, [mL, mR]) => {
        for (let k = 0; k < mL.length; k++) rawPeak = Math.max(rawPeak, Math.abs(mL[k]!), Math.abs(mR[k]!));
        await w1.write([mL, mR]);
      });
    } finally {
      await w1.close();
    }
    const silent = rawPeak === 0;
    const m1 = silent ? null : await measureEbur128(raw, { config: ctx.config, signal: ctx.signal });
    let gainDb = m1 && Number.isFinite(m1.integratedLufs) && m1.integratedLufs > -70 ? i.targetLufs - m1.integratedLufs : 0;
    let useLimiter = !!m1 && m1.truePeakDbtp + gainDb > i.truePeakTarget;

    const mixPath = path.resolve(i.projectDir, i.outMixRel);
    let final = { integratedLufs: -144, truePeakDbtp: -144, lra: 0 };
    let maxGr = 0;
    for (let iter = 0; iter < 3; iter++) {
      const gRounded = Math.round(gainDb * 100) / 100;
      const g = Math.pow(10, gRounded / 20);
      const limiter = useLimiter ? new TruePeakLimiter({ ceilingDbfs: i.truePeakTarget - LIMITER_MARGIN_DB, sampleRate: SR }) : null;
      const tmpOut = Object.fromEntries([["mix", path.join(tmp, "mix.wav")], ...STEMS.map((s) => [s, path.join(tmp, `${s}.wav`)])]) as Record<"mix" | Stem, string>;
      const writers = Object.fromEntries(await Promise.all(Object.entries(tmpOut).map(async ([k, f]) => [k, await createWavWriter(f, { sampleRate: SR, channels: 2, format: "s24" })]))) as Record<"mix" | Stem, Awaited<ReturnType<typeof createWavWriter>>>;
      try {
        await pass("mixing (master)", 0.4 + iter * 0.1, 0.95, async (b, [mL, mR]) => {
          for (const s of STEMS) {
            const [x, y] = b[s];
            for (let k = 0; k < x.length; k++) { x[k] = x[k]! * g; y[k] = y[k]! * g; }
            await writers[s].write([x, y]);
          }
          for (let k = 0; k < mL.length; k++) { mL[k] = mL[k]! * g; mR[k] = mR[k]! * g; }
          if (limiter) {
            const [oL, oR] = limiter.process(mL, mR);
            if (oL.length) await writers.mix.write([oL, oR]);
          } else {
            await writers.mix.write([mL, mR]);
          }
        });
        if (limiter) {
          const [oL, oR] = limiter.flush();
          if (oL.length) await writers.mix.write([oL, oR]);
        }
      } finally {
        for (const w of Object.values(writers)) await w.close();
      }
      maxGr = limiter ? limiter.maxGrDb : 0;
      const m2 = silent ? null : await measureEbur128(tmpOut.mix, { config: ctx.config, signal: ctx.signal });
      final = m2 ? { integratedLufs: m2.integratedLufs, truePeakDbtp: m2.truePeakDbtp, lra: m2.lra } : final;
      gainDb = gRounded;
      // the limiter lowers loudness a little: re-aim the gain (≤ 2 corrections); a TP miss turns the limiter on
      const off = m2 && m2.integratedLufs > -70 ? i.targetLufs - m2.integratedLufs : 0;
      const tpMiss = !!m2 && m2.truePeakDbtp > i.truePeakTarget + 0.05;
      const done = iter === 2 || (Math.abs(off) <= 0.3 && !tpMiss);
      if (done) {
        await writeAtomically(mixPath, (dst) => copyFile(tmpOut.mix, dst));
        for (const s of STEMS) await writeAtomically(path.resolve(i.projectDir, i.stemRels[s]), (dst) => copyFile(tmpOut[s], dst));
        break;
      }
      if (tpMiss) useLimiter = true;
      gainDb += off;
    }
    ctx.progress(1, "mix done");
    return {
      integratedLufs: round2(final.integratedLufs), truePeakDbtp: round2(final.truePeakDbtp), lra: round2(final.lra),
      gainDb, limiterMaxGrDb: round2(maxGr), stems: [...STEMS],
    };
  });
}

const round2 = (x: number) => Math.round(x * 100) / 100;
