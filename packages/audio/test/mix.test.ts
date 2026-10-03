import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Timeline, frameToSample48k } from "@docmaker/core";
import type { Anchor, ClipAudio, MusicSection, SfxCue, SfxEntry, SfxManifest, SilenceMark, TimelineAsset } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { ffmpeg, measureEbur128, readWav, writeWav } from "@docmaker/core/node";
import { TruePeakLimiter, ensureSfxPack, equalPowerPan, mixTimeline, syncPointMs } from "../src/index";
import { makeCtx, rmsDb, tmpDir } from "./helpers";

const ctx = makeCtx();
const FPS = 30;
const SECONDS = 12;
const N = SECONDS * FPS;
const L = frameToSample48k(N, FPS);
const P = (f: number): Anchor => ({ ref: "program", edge: "start", offset: f });
const S = (f: number) => frameToSample48k(f, FPS);
let manifest: SfxManifest;
const entry = (id: string): SfxEntry => manifest.entries.find((e) => e.id === id)!;

beforeAll(async () => {
  manifest = await ensureSfxPack("procedural", ctx);
}, 120_000);

function noise(n: number, seed: number, amp: number, env?: (i: number) => number): Float32Array {
  const x = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = amp * (env ? env(i) : 1) * ((s / 4294967296) * 2 - 1);
  }
  return x;
}
const sines = (n: number, amp: number) => {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * (Math.sin((2 * Math.PI * 220 * i) / 48000) + Math.sin((2 * Math.PI * 331 * i) / 48000 + 1) + 0.5 * Math.sin((2 * Math.PI * 447 * i) / 48000 + 2));
  return x;
};

interface Built { t: Timeline; projectDir: string; vo: Float32Array }
/** A 12 s timeline with hand-placed VO spans, a looped music bed, SFX, clip audio and silences. */
async function build(o: { sfx?: (Omit<SfxCue, "start" | "end" | "id" | "assetId" | "category" | "reason" | "sourceItemId" | "priority" | "combo" | "peakOffsetFrames" | "from"> & { sfxId: string })[]; silences?: Omit<SilenceMark, "start" | "end">[]; clip?: boolean; music?: boolean; voAmp?: number } = {}): Promise<Built> {
  const projectDir = tmpDir("audio-mix-");
  const base = makeTimeline({ seconds: SECONDS, fps: FPS, overlays: false, audio: false });
  const assets: Record<string, TimelineAsset> = {};
  const add = async (id: string, rel: string, data: Float32Array[], kind: "wav" | "mp4" = "wav") => {
    assets[id] = { id, kind: kind === "mp4" ? "video" : "audio", ext: kind, mime: kind === "mp4" ? "video/mp4" : "audio/wav", width: null, height: null, durationFrames: null, hasAudio: true, projectRel: rel };
    if (kind === "wav") {
      await mkdir(path.dirname(path.join(projectDir, rel)), { recursive: true });
      await writeWav(path.join(projectDir, rel), { sampleRate: 48000, channels: data.length, data }, "f32");
    }
  };
  // VO program: speech-like noise on [60,150) and [240,300), digital zero elsewhere
  const voSpans: [number, number][] = [[60, 150], [240, 300]];
  const vo = new Float32Array(L);
  for (const [a, b] of voSpans) {
    const seg = noise(S(b) - S(a), a, o.voAmp ?? 0.25, (i) => 0.4 + 0.6 * Math.abs(Math.sin((2 * Math.PI * 4 * i) / 48000)));
    vo.set(seg, S(a));
  }
  const voId = "a".repeat(64);
  await add(voId, "program/en/vo_program.wav", [vo]);
  // music bed (5 s, looped over the whole program)
  const music: MusicSection[] = [];
  if (o.music !== false) {
    const musId = "b".repeat(64);
    const m = sines(5 * 48000, 0.08);
    await add(musId, `media/${musId}.wav`, [m, m.slice()]);
    music.push({ id: "mus:CH1", start: P(0), end: P(N), from: 0, dur: N, assetId: musId, sourceInFrames: 0, loop: true, gainDb: 0, fadeInFrames: 0, fadeOutFrames: 0, endMode: "fade", alignDownbeatAt: null, mood: "tense", energy: "mid", bpm: null });
  }
  // SFX from the procedural pack, frozen into media/ like the engine does
  const sfx: SfxCue[] = [];
  for (const [k, c] of (o.sfx ?? []).entries()) {
    const e = entry(c.sfxId);
    const rel = `media/${e.assetId}.wav`;
    await mkdir(path.join(projectDir, "media"), { recursive: true });
    await copyFile(e.file, path.join(projectDir, rel));
    assets[e.assetId] = { id: e.assetId, kind: "audio", ext: "wav", mime: "audio/wav", width: null, height: null, durationFrames: null, hasAudio: true, projectRel: rel };
    const pof = Math.round((e.peakOffsetMs * FPS) / 1000);
    sfx.push({
      ...c, id: `sfx:t${k}:${e.category}`, start: P(c.eventFrame - pof), end: P(c.eventFrame - pof + c.dur), from: c.eventFrame - pof, assetId: e.assetId, category: e.category,
      peakOffsetFrames: pof, priority: 3, combo: null, reason: "test", sourceItemId: null,
    });
  }
  const clip: ClipAudio[] = [];
  if (o.clip) {
    const clipId = "c".repeat(64);
    const rel = `media/${clipId}.mp4`;
    await mkdir(path.join(projectDir, "media"), { recursive: true });
    await ffmpeg(["-f", "lavfi", "-i", "sine=f=300:d=8:sample_rate=48000", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=8:r=30", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", path.join(projectDir, rel)], { config: ctx.config, signal: ctx.signal });
    assets[clipId] = { id: clipId, kind: "video", ext: "mp4", mime: "video/mp4", width: 64, height: 64, durationFrames: 240, hasAudio: true, projectRel: rel };
    clip.push({ id: "ca:CH1-S02", start: P(30), end: P(150), from: 30, dur: 120, segmentId: "CH1-S02", assetId: clipId, sourceInFrames: 0, gainDb: 0, duckUnderVo: true });
  }
  const t = Timeline.parse({
    ...base,
    assets: { ...base.assets, ...assets },
    audio: {
      voProgram: { assetId: voId, bakedGainDb: 0 }, voSpans, vo: [], music, sfx, clip,
      silences: (o.silences ?? []).map((s) => ({ ...s, start: P(s.from), end: P(s.from + s.dur) })),
      ducking: { musicDuckDb: -12, sfxDuckDb: -4, clipDuckDb: -10, musicUnderClipDb: -12, attackMs: 150, releaseMs: 400, bridgeMs: 600, padBeforeMs: 80, padAfterMs: 120 },
    },
  });
  return { t, projectDir, vo };
}

const stemRels = { vo: "audio/en/stems/vo.wav", music: "audio/en/stems/music.wav", sfx: "audio/en/stems/sfx.wav", clip: "audio/en/stems/clip.wav" };
async function mix(b: Built, o?: { targetLufs?: number; truePeakTarget?: number }) {
  const r = await mixTimeline(b.t, { projectDir: b.projectDir, outMixRel: "audio/en/mix.wav", stemRels, targetLufs: o?.targetLufs ?? -14, truePeakTarget: o?.truePeakTarget ?? -1.5 }, ctx);
  const read = async (rel: string) => (await readWav(path.join(b.projectDir, rel))).data;
  return { r, mix: await read("audio/en/mix.wav"), vo: await read(stemRels.vo), music: await read(stemRels.music), sfx: await read(stemRels.sfx), clip: await read(stemRels.clip) };
}

describe("mixTimeline", () => {
  it("reaches −14 LUFS, writes s24 stereo stems that sum to the master, and ducks music −12 dB under VO", async () => {
    const b = await build({ sfx: [{ sfxId: "procedural:pop/0", eventFrame: 200, dur: 6, gainDb: 0, pan: 0, panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0 }] });
    const out = await mix(b);
    expect(Math.abs(out.r.integratedLufs - -14)).toBeLessThanOrEqual(0.5);
    expect(out.r.truePeakDbtp).toBeLessThanOrEqual(-1.0);
    expect(out.r.limiterMaxGrDb).toBe(0);
    expect(out.r.stems).toEqual(["vo", "music", "sfx", "clip"]);
    for (const x of [out.mix, out.vo, out.music, out.sfx, out.clip]) { expect(x.length).toBe(2); expect(x[0]!.length).toBe(L); }
    const m = await measureEbur128(path.join(b.projectDir, "audio/en/mix.wav"), { config: ctx.config, signal: ctx.signal });
    expect(m.integratedLufs).toBeCloseTo(out.r.integratedLufs, 1);
    // stems sum to the master (limiter idle): s24 quantisation only
    let maxErr = 0;
    for (let c = 0; c < 2; c++) for (let k = 0; k < L; k += 7) {
      const sum = out.vo[c]![k]! + out.music[c]![k]! + out.sfx[c]![k]! + out.clip[c]![k]!;
      maxErr = Math.max(maxErr, Math.abs(sum - out.mix[c]![k]!));
    }
    expect(maxErr).toBeLessThan(5e-6);
    // ducking depth: music RMS inside a VO span (past the attack) vs a VO-free stretch (past the release)
    const ducked = rmsDb(out.music[0]!, S(95), S(135));
    const open = rmsDb(out.music[0]!, S(175), S(215));
    expect(ducked - open).toBeGreaterThan(-12.5);
    expect(ducked - open).toBeLessThan(-11.5);
    // VO is mono → identical channels
    for (let k = S(60); k < S(150); k += 101) expect(out.vo[0]![k]).toBe(out.vo[1]![k]);
  }, 120_000);

  it("lands SFX sync points on the event frame (±1 ms) and mirrors LR whooshes for RL sweeps", async () => {
    const b = await build({
      music: false,
      sfx: [
        { sfxId: "procedural:impact/0", eventFrame: 170, dur: 60, gainDb: 0, pan: 0, panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0 },
        { sfxId: "procedural:pop/1", eventFrame: 20, dur: 6, gainDb: 0, pan: 0, panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0 },
        { sfxId: "procedural:whoosh.light/0", eventFrame: 320, dur: 20, gainDb: 0, pan: 0, panSweep: "RL", loop: false, fadeInFrames: 0, fadeOutFrames: 0 },
      ],
    });
    const out = await mix(b);
    const win = (a: number, n: number) => out.sfx.map((c) => c.slice(a, a + n));
    for (const [id, ev] of [["procedural:impact/0", 170], ["procedural:pop/1", 20]] as const) {
      const e = entry(id);
      const start = S(ev) - Math.round((e.peakOffsetMs * 48000) / 1000);
      const at = start + Math.round((syncPointMs(win(start, Math.round((e.durationMs * 48000) / 1000)), "onset") * 48000) / 1000);
      expect(Math.abs(at - S(ev)) / 48, id).toBeLessThanOrEqual(1);
    }
    // RL sweep on an LR file: energy moves right → left (the file itself sweeps left → right)
    const e = entry("procedural:whoosh.light/0");
    const s0 = S(320) - Math.round((e.peakOffsetMs * 48000) / 1000);
    const n = Math.round((e.durationMs * 48000) / 1000);
    const [l, r] = win(s0, n) as [Float32Array, Float32Array];
    const bal = (a: number, z: number) => rmsDb(r, a, z) - rmsDb(l, a, z);
    expect(bal(0, n / 3)).toBeGreaterThan(0.5);
    expect(bal((2 * n) / 3, n)).toBeLessThan(-0.5);
    const src = (await readWav(e.file)).data;
    const srcBal = (a: number, z: number) => rmsDb(src[1]!, a, z) - rmsDb(src[0]!, a, z);
    expect(srcBal(0, n / 3)).toBeLessThan(-0.5);
  }, 120_000);

  it("keeps silences digital zero (music/SFX and a VO bleep) and loops/fades SFX", async () => {
    const drone = "procedural:drone/0";
    const b = await build({
      sfx: [
        { sfxId: drone, eventFrame: 30, dur: 300, gainDb: -6, pan: 0, panSweep: null, loop: true, fadeInFrames: 30, fadeOutFrames: 30 },
        { sfxId: "procedural:bleep/0", eventFrame: 100, dur: 6, gainDb: 0, pan: 0, panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0 },
      ],
      silences: [
        { id: "sil:reveal:b1", from: 200, dur: 15, reason: "reveal", affects: ["music", "sfx"] },
        { id: "sil:bleep:w1", from: 100, dur: 6, reason: "bleep", affects: ["vo"] },
      ],
    });
    const out = await mix(b);
    for (const k of [S(200), S(207), S(215) - 1]) {
      for (let c = 0; c < 2; c++) { expect(out.music[c]![k]).toBe(0); expect(out.sfx[c]![k]).toBe(0); expect(out.mix[c]![k]).toBe(0); }
    }
    for (let k = S(200); k < S(215); k++) expect(out.mix[0]![k]).toBe(0);
    for (let k = S(100); k < S(106); k++) expect(out.vo[0]![k]).toBe(0);
    expect(rmsDb(out.vo[0]!, S(90), S(99))).toBeGreaterThan(-60); // VO around the bleep is untouched
    expect(rmsDb(out.sfx[0]!, S(100), S(106))).toBeGreaterThan(-60); // the bleep tone plays over the muted word
    // loop: the 8 s drone keeps playing past its file length (cue starts at frame 30 → 8 s ends at frame 270)
    const d = entry(drone);
    expect(d.durationMs).toBe(8000);
    expect(rmsDb(out.sfx[0]!, S(280), S(300))).toBeGreaterThan(-60);
    // fades: in over 30 frames, out over the last 30 frames (cue ends at frame 330)
    const early = rmsDb(out.sfx[0]!, S(30), S(36));
    const mid = rmsDb(out.sfx[0]!, S(170), S(190));
    expect(early).toBeLessThan(mid - 12);
    expect(rmsDb(out.sfx[0]!, S(326), S(330))).toBeLessThan(mid - 14);
    for (let k = S(330); k < L; k += 31) expect(out.sfx[0]![k]).toBe(0);
    // sample-exact loop content at a point with unit gain tables (no VO, no silence)
    const src = (await readWav(d.file)).data[0]!;
    const gain = Math.pow(10, (-6 + out.r.gainDb) / 20);
    // unit SFX table at 175/185/225; −4 dB (sfx duck under the VO span [240, 300)) after the wrap at 280/290
    for (const [f, duck] of [[175, 0], [185, 0], [225, 0], [280, -4], [290, -4]] as const) {
      const k = S(f);
      const local = k - S(30);
      expect(Math.abs(out.sfx[0]![k]! - src[local % src.length]! * gain * Math.pow(10, duck / 20)), `frame ${f}`).toBeLessThan(2e-5);
    }
  }, 120_000);

  it("ducks clip audio −10 dB under VO and engages the true-peak limiter when the gain would overshoot", async () => {
    const b = await build({ clip: true, music: false });
    const out = await mix(b);
    const under = rmsDb(out.clip[0]!, S(95), S(140));
    const free = rmsDb(out.clip[0]!, S(35), S(50));
    expect(under - free).toBeGreaterThan(-10.5);
    expect(under - free).toBeLessThan(-9.5);
    for (let k = S(150) + 10; k < S(160); k++) expect(out.clip[0]![k]).toBe(0);

    // a hot impact over a quiet program: loudness gain + true peak would exceed −1.5 → limiter
    const hot = await build({ music: false, voAmp: 0.02, sfx: [{ sfxId: "procedural:impact/1", eventFrame: 200, dur: 60, gainDb: 12, pan: 0.5, panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0 }] });
    const h = await mix(hot);
    expect(h.r.limiterMaxGrDb).toBeGreaterThan(0);
    expect(h.r.truePeakDbtp).toBeLessThanOrEqual(-1.0);
    expect(Math.abs(h.r.integratedLufs - -14)).toBeLessThanOrEqual(0.5);
  }, 180_000);

  it("pans with constant power at unity centre; the limiter holds its ceiling with exact latency", () => {
    const [l0, r0] = equalPowerPan(0);
    expect(l0).toBeCloseTo(1, 9);
    expect(r0).toBeCloseTo(1, 9);
    for (const p of [-1, -0.7, 0.3, 1]) { const [l, r] = equalPowerPan(p); expect(l * l + r * r).toBeCloseTo(2, 9); }
    const lim = new TruePeakLimiter({ ceilingDbfs: -3, sampleRate: 48000 });
    const n = 48000;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (i > 20000 && i < 20200 ? 1.5 : 0.2) * Math.sin((2 * Math.PI * 1000 * i) / 48000);
    const [a, bb] = lim.process(x, x);
    const [c, d] = lim.flush();
    const yl = new Float32Array([...a, ...c]);
    expect(a.length).toBe(n - lim.delay);
    expect(yl.length).toBe(n);
    expect(bb.length + d.length).toBe(n);
    let pk = 0;
    for (const v of yl) pk = Math.max(pk, Math.abs(v));
    expect(20 * Math.log10(pk)).toBeLessThanOrEqual(-3 + 0.05);
    expect(lim.maxGrDb).toBeGreaterThan(5);
    // the output stream is sample-aligned with the input (the latency is internal); far from the burst it is untouched
    expect(lim.delay).toBe(126);
    expect(Math.abs(yl[5000]! - x[5000]!)).toBeLessThan(1e-6);
    expect(Math.abs(yl[40000]! - x[40000]!)).toBeLessThan(0.01 * Math.abs(x[40000]!) + 1e-6); // 80 ms release: within 1 % after 0.4 s
    expect(Math.abs(yl[20100]!)).toBeLessThan(Math.abs(x[20100]!) + 1e-9);
  });

  it("fails clearly without a VO program and degrades when an SFX file is missing", async () => {
    const b = await build({ sfx: [{ sfxId: "procedural:pop/0", eventFrame: 200, dur: 6, gainDb: 0, pan: 0, panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0 }] });
    const { rm } = await import("node:fs/promises");
    const sfxAsset = b.t.audio.sfx[0]!.assetId;
    await rm(path.join(b.projectDir, b.t.assets[sfxAsset]!.projectRel));
    // the project copy is gone but the installed pack has the same content hash → still mixed
    const fromPack = await mix(b);
    expect(fromPack.sfx[0]!.some((v) => v !== 0)).toBe(true);
    // an SFX known nowhere is skipped (warning), the mix still completes
    const unknown = structuredClone(b.t);
    const ghost = "d".repeat(64);
    unknown.audio.sfx[0]!.assetId = ghost;
    unknown.assets[ghost] = { ...unknown.assets[sfxAsset]!, id: ghost, projectRel: `media/${ghost}.wav` };
    const out = await mix({ ...b, t: unknown });
    expect(out.sfx[0]!.every((v) => v === 0)).toBe(true);
    await rm(path.join(b.projectDir, "program/en/vo_program.wav"));
    await expect(mix(b)).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
  }, 120_000);
});
