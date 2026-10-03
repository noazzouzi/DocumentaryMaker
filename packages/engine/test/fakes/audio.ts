// Fake @docmaker/audio (walking skeleton, §16.5): a tiny deterministic SFX pack, a beat-grid music bed, a VO program
// assembled sample-exactly from the layout, and a "mix" that is the VO program on both channels. Real WAV files.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SfxManifest, frameToSample48k, type LicenseInfo, type SfxCategory, type SfxEntry, type Timeline,
} from "@docmaker/core";
import { readWav, sha256File, twoPassLoudnorm, writeWav } from "@docmaker/core/node";
import type { AudioApi } from "../../src/deps";
import { synthWav } from "./media";

const PROC: LicenseInfo = { code: "PROCEDURAL", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false, attributionText: null, restrictions: [] };
const VERSION = "fake-1";
type Spec = { cat: SfxCategory; sec: number; peak: number; sync: "peak" | "onset"; energy: number; loop?: boolean; f: number };
const SPECS: Spec[] = [
  { cat: "whoosh.light", sec: 0.8, peak: 0.5, sync: "peak", energy: 2, f: 900 }, { cat: "whoosh.whip", sec: 0.4, peak: 0.25, sync: "peak", energy: 3, f: 1400 },
  { cat: "whoosh.up", sec: 1.0, peak: 0.8, sync: "peak", energy: 3, f: 700 }, { cat: "whoosh.heavy", sec: 1.0, peak: 0.6, sync: "peak", energy: 4, f: 300 },
  { cat: "riser", sec: 2.0, peak: 1.9, sync: "peak", energy: 4, f: 400 }, { cat: "impact", sec: 1.2, peak: 0.01, sync: "onset", energy: 5, f: 60 },
  { cat: "impact.soft", sec: 0.8, peak: 0.01, sync: "onset", energy: 3, f: 90 }, { cat: "boom.sub", sec: 1.5, peak: 0.01, sync: "onset", energy: 5, f: 40 },
  { cat: "boom.low", sec: 1.2, peak: 0.01, sync: "onset", energy: 4, f: 55 }, { cat: "thud", sec: 0.5, peak: 0.01, sync: "onset", energy: 3, f: 80 },
  { cat: "pop", sec: 0.15, peak: 0.005, sync: "onset", energy: 2, f: 1200 }, { cat: "click", sec: 0.08, peak: 0.002, sync: "onset", energy: 1, f: 3000 },
  { cat: "tick", sec: 0.06, peak: 0.002, sync: "onset", energy: 1, f: 4000 }, { cat: "ding", sec: 1.0, peak: 0.005, sync: "onset", energy: 2, f: 1760 },
  { cat: "shutter", sec: 0.2, peak: 0.005, sync: "onset", energy: 2, f: 2500 }, { cat: "paper", sec: 0.5, peak: 0.01, sync: "onset", energy: 1, f: 2000 },
  { cat: "keys", sec: 2.0, peak: 0.01, sync: "onset", energy: 1, f: 2800, loop: true }, { cat: "glitch", sec: 0.4, peak: 0.01, sync: "onset", energy: 3, f: 1800 },
  { cat: "bleep", sec: 0.6, peak: 0.01, sync: "onset", energy: 2, f: 1000 }, { cat: "drone", sec: 4.0, peak: 0.01, sync: "onset", energy: 1, f: 110, loop: true },
  { cat: "ambience.room", sec: 4.0, peak: 0.01, sync: "onset", energy: 1, f: 150, loop: true }, { cat: "swell.reverse", sec: 1.5, peak: 1.4, sync: "peak", energy: 3, f: 500 },
];

const packDir = (sfxRoot: string, pack: string) => path.join(sfxRoot, pack, VERSION);

/** Deterministic pseudo-noise (no Math.random). */
const noise = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

async function buildPack(sfxRoot: string, pack: string): Promise<SfxManifest> {
  const dir = packDir(sfxRoot, pack);
  const entries: SfxEntry[] = [];
  for (const s of SPECS) {
    const file = path.join(dir, `${s.cat}-0.wav`);
    await synthWav(file, s.sec, 1, (t, i) => {
      const env = s.sync === "peak" ? Math.exp(-((t - s.peak) ** 2) / 0.02) : Math.exp(-(t - s.peak) * 6) * (t >= s.peak ? 1 : 0);
      const amp = s.loop ? 0.05 : 0.5;
      return amp * (s.loop ? 1 : env) * (0.6 * Math.sin(2 * Math.PI * s.f * t) + 0.4 * noise(i));
    });
    entries.push({
      id: `${pack}:${s.cat}/0`, category: s.cat, variant: 0, pack, file, assetId: await sha256File(file), durationMs: Math.round(s.sec * 1000),
      syncPoint: s.sync, peakOffsetMs: Math.round(s.peak * 1000), peakDbfs: s.loop ? -26 : -7, lufs: s.sec >= 0.4 ? -24 : null, energy: s.energy,
      loopable: s.loop ?? false, direction: s.cat.startsWith("whoosh") ? "LR" : "none", tags: [s.cat], license: PROC,
    });
  }
  const m: SfxManifest = { schemaVersion: 1, pack, version: VERSION, generatedAt: "2026-10-02T00:00:00.000Z", entries };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(m));
  return m;
}

export function makeFakeAudio(): AudioApi {
  return {
    async ensureSfxPack(pack, ctx) {
      const f = path.join(packDir(ctx.config.paths.sfx, pack), "manifest.json");
      try {
        return SfxManifest.parse(JSON.parse(await readFile(f, "utf8")));
      } catch {
        return buildPack(ctx.config.paths.sfx, pack);
      }
    },
    async loadSfxEntries(packs, ctx) {
      const out: SfxEntry[] = [];
      for (const p of packs) out.push(...SfxManifest.parse(JSON.parse(await readFile(path.join(packDir(ctx.config.paths.sfx, p), "manifest.json"), "utf8"))).entries);
      return out.sort((a, b) => (a.id < b.id ? -1 : 1));
    },
    async generateMusic(o, ctx) {
      const beatMs = 60000 / o.bpm;
      const beats = o.bars * 4;
      const durationMs = Math.round(beats * beatMs);
      const wavPath = path.join(ctx.config.paths.music, `fake-${o.mood}-${o.energy}-${o.bpm}-${o.bars}-${o.seed}.wav`);
      await mkdir(path.dirname(wavPath), { recursive: true });
      const base = { "A minor": 220, "D minor": 146.8, "E minor": 164.8, "C major": 261.6 }[o.key];
      await synthWav(wavPath, durationMs / 1000, 2, (t) => {
        const ph = (t * 1000) % beatMs;
        const pulse = Math.exp(-ph / 90);
        return 0.12 * Math.sin(2 * Math.PI * base * t) + 0.06 * Math.sin(2 * Math.PI * base * 1.5 * t) + 0.25 * pulse * Math.sin(2 * Math.PI * 55 * t);
      });
      const beatsMs = Array.from({ length: beats }, (_, i) => Math.round(i * beatMs));
      return { wavPath, beatsMs, downbeatsMs: beatsMs.filter((_, i) => i % 4 === 0), durationMs, bpm: o.bpm };
    },
    async scanMusicLibrary() {
      return [];
    },
    async assembleVoProgram(i) {
      const n = Math.max(1, Math.round((i.layout.durationMs * 48000) / 1000));
      const buf = new Float32Array(n);
      for (const s of i.layout.segments) {
        if (!s.voFile || (s.mode !== "vo" && s.mode !== "clip-narrated")) continue;
        const w = await readWav(path.join(i.projectDir, s.voFile));
        const at = Math.round(frameToSample48k(s.from, i.layout.fps));
        const src = w.data[0]!;
        for (let k = 0; k < src.length && at + k < n; k++) buf[at + k] = src[k]!;
      }
      const out = path.join(i.projectDir, i.outRel);
      await mkdir(path.dirname(out), { recursive: true });
      await writeWav(out, { sampleRate: 48000, channels: 1, data: [buf] }, "s16");
      return { sha256: await sha256File(out), bakedGainDb: 0, durationMs: i.layout.durationMs };
    },
    async mixTimeline(t: Timeline, i, ctx) {
      const n = Math.max(1, Math.round((t.durationInFrames * 48000) / t.fps));
      const vo = new Float32Array(n);
      const voRel = t.assets[t.audio.voProgram.assetId]?.projectRel;
      if (voRel) {
        const w = await readWav(path.join(i.projectDir, voRel));
        vo.set(w.data[0]!.subarray(0, n));
      }
      const silent = new Float32Array(n);
      const write = async (rel: string, d: Float32Array) => {
        const abs = path.join(i.projectDir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeWav(abs, { sampleRate: 48000, channels: 2, data: [d, d.slice()] }, "s16");
      };
      await write(i.stemRels.vo, vo);
      for (const s of ["music", "sfx", "clip"] as const) await write(i.stemRels[s], silent);
      // the master is the VO stem brought to the target loudness (two-pass loudnorm, like the real mixer's last step)
      const out = path.join(i.projectDir, i.outMixRel);
      const r = await twoPassLoudnorm(path.join(i.projectDir, i.stemRels.vo), out, {
        I: i.targetLufs, TP: i.truePeakTarget, LRA: 11, sampleRate: 48000, channels: 2, codec: "pcm_s16le", config: ctx.config, signal: ctx.signal,
      });
      return {
        integratedLufs: r.measured.integratedLufs, truePeakDbtp: r.measured.truePeakDbtp, lra: r.measured.lra, gainDb: 0, limiterMaxGrDb: 0,
        stems: ["vo", "music", "sfx", "clip"],
      };
    },
    densityReport(t) {
      const minutes = Math.max(1, Math.ceil(t.durationInFrames / t.fps / 60));
      const sfxPerMin = Array.from({ length: minutes }, (_, m) => t.audio.sfx.filter((x) => Math.floor(x.from / t.fps / 60) === m).length);
      return { sfxPerMin, impactsPerMin: sfxPerMin.map(() => 0), silentCutShare: 0.5, chapterRmsDb: {} };
    },
  };
}
