// Sherpa providers (mocked native module + gated real models), the Python sidecar dispatcher, faster-whisper
// and whisper.cpp adapters, calibration and the teleprompter.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceSettings } from "@docmaker/core";
import { readWav, readWavHeader, runSidecar } from "@docmaker/core/node";
import { makeScript } from "@docmaker/core/testing";
import { FasterWhisperAligner, SherpaProvider, calibrateVoice, createTtsProvider, synthesizeTrack, teleprompterHtml } from "../src/index";
import { mergeAsrWords, sidecarError } from "../src/align/faster-whisper";
import { tokensToWords } from "../src/align/whisper-cpp";
import { speechOnlyMs } from "../src/calibrate";
import type { SherpaModule } from "../src/providers/sherpa";
import { DATA, makeCtx, silentLogger, tmpDir } from "./helpers";

/** A fake sherpa module: every sentence becomes 50 ms silence + 80 ms of tone per word + 120 ms silence. */
function fakeSherpa(log: { configs: unknown[]; texts: string[] }): SherpaModule {
  class Tts {
    sampleRate = 24000;
    constructor(cfg: unknown) { log.configs.push(cfg); }
    generate(o: { text: string; sid: number; speed: number }) {
      log.texts.push(o.text);
      const n = o.text.split(/\s+/).length;
      const sr = this.sampleRate;
      const s = new Float32Array(Math.round((0.05 + n * 0.08 + 0.12) * sr));
      for (let i = Math.round(0.05 * sr); i < Math.round((0.05 + n * 0.08) * sr); i++) s[i] = 0.3 * Math.sin(i / 3);
      return { samples: s, sampleRate: sr };
    }
    async generateAsync(o: { text: string; sid: number; speed: number }) { return this.generate(o); }
  }
  return { OfflineTts: Tts as unknown as SherpaModule["OfflineTts"] };
}

function withModels(ctx: ReturnType<typeof makeCtx>) {
  const k = path.join(ctx.config.paths.models, "kokoro", "kokoro-multi-lang-v1_0");
  mkdirSync(k, { recursive: true });
  for (const f of ["model.onnx", "voices.bin", "tokens.txt"]) writeFileSync(path.join(k, f), "x");
  const p = path.join(ctx.config.paths.models, "piper", "fr_FR-gilles-low");
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, "fr_FR-gilles-low.onnx"), "x");
  return { k, p };
}

describe("sherpa providers (mocked native module)", () => {
  it("Kokoro: one sentence at a time, silence trimmed, gaps between sentences, estimated word timings", async () => {
    const ctx = makeCtx();
    const { k } = withModels(ctx);
    const log = { configs: [] as unknown[], texts: [] as string[] };
    const p = new SherpaProvider("kokoro", { config: ctx.config, logger: silentLogger, loader: () => fakeSherpa(log) });
    expect(await p.isAvailable()).toEqual({ ok: true, hint: null });
    const words = ["The", "bulb", "sold.", "Then", "it", "crashed."];
    const out = path.join(tmpDir(), "k.wav");
    const r = await p.synthesize({ segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "en", voice: VoiceSettings.parse({ provider: "kokoro", voiceId: "auto" }) }, out, ctx.signal);
    expect(log.texts).toEqual(["The bulb sold.", "Then it crashed."]);
    expect(log.configs[0]).toMatchObject({
      model: { kokoro: { model: path.join(k, "model.onnx"), lexicon: path.join(k, "lexicon-us-en.txt"), lang: "" }, numThreads: 4, provider: "cpu" },
      maxNumSentences: 1,
    });
    expect(r.timingSource).toBe("estimated");
    expect(r.words).toHaveLength(6);
    // sentence 1: 30 ms kept + 3 words of 80 ms; then a 380 ms gap
    expect(r.words![0]!.startMs).toBe(30);
    expect(r.words![2]!.endMs).toBeCloseTo(30 + 240, -1);
    expect(r.words![3]!.startMs).toBeGreaterThan(r.words![2]!.endMs + 380);
    const h = await readWavHeader(out);
    expect(h.sampleRate).toBe(24000);
    expect(Math.abs(h.durationMs - r.durationMs)).toBeLessThanOrEqual(1);
  });

  it("Kokoro FR has only ff_siwis (30); b* voices use the GB lexicon; models missing → hint", async () => {
    const ctx = makeCtx();
    withModels(ctx);
    const log = { configs: [] as unknown[], texts: [] as string[] };
    const p = new SherpaProvider("kokoro", { config: ctx.config, logger: silentLogger, loader: () => fakeSherpa(log) });
    expect(p.resolve("auto", "fr")).toMatchObject({ id: "30", sid: 30 });
    expect(() => p.resolve("16", "fr")).toThrow(/single French voice/);
    await p.synthesize({ segmentId: "CH1-S01", text: "Hi.", ttsWords: ["Hi."], lang: "en", voice: VoiceSettings.parse({ provider: "kokoro", voiceId: "26" }) }, path.join(tmpDir(), "a.wav"), ctx.signal);
    expect(JSON.stringify(log.configs[0])).toContain("lexicon-gb-en.txt");
    expect((await p.listVoices("fr")).map((v) => v.id)).toEqual(["30"]);
    const bare = new SherpaProvider("kokoro", { config: makeCtx().config, logger: silentLogger, loader: () => fakeSherpa(log) });
    expect(await bare.isAvailable()).toMatchObject({ ok: false, hint: expect.stringContaining("setup --voices kokoro") });
    const noMod = new SherpaProvider("piper", { config: ctx.config, logger: silentLogger, loader: () => null });
    expect((await noMod.isAvailable()).ok).toBe(false);
  });

  it("Piper: vits config, curated voices only, denylisted voices refused", async () => {
    const ctx = makeCtx();
    const { p: dir } = withModels(ctx);
    const log = { configs: [] as unknown[], texts: [] as string[] };
    const p = new SherpaProvider("piper", { config: ctx.config, logger: silentLogger, loader: () => fakeSherpa(log) });
    await p.synthesize({ segmentId: "CH1-S01", text: "Bonjour.", ttsWords: ["Bonjour."], lang: "fr", voice: VoiceSettings.parse({ provider: "piper", voiceId: "auto" }) }, path.join(tmpDir(), "p.wav"), ctx.signal);
    expect(log.configs[0]).toMatchObject({ model: { vits: { model: path.join(dir, "fr_FR-gilles-low.onnx"), tokens: path.join(dir, "tokens.txt") } } });
    const ids = (await p.listVoices()).map((v) => v.id);
    expect(ids).toContain("en_US-john-medium");
    expect(ids.some((x) => /ryan|lessac|hfc|semaine|l2arctic/.test(x))).toBe(false);
    expect(() => p.resolve("en_US-ryan-high", "en")).toThrow(/never used/);
    expect(() => p.resolve("en_US-lessac-medium", "en")).toThrow(/never used/);
    await expect(p.synthesize({ segmentId: "CH1-S01", text: "x", ttsWords: ["x"], lang: "fr", voice: VoiceSettings.parse({ provider: "piper", voiceId: "fr_FR-siwis-medium" }) }, path.join(tmpDir(), "q.wav"), ctx.signal))
      .rejects.toMatchObject({ code: "MODEL_MISSING" });
  });

  it("sherpa-onnx-node really loads through createRequire under pnpm", () => {
    const mod = (createTtsProvider("kokoro", { config: makeCtx().config, secrets: {}, logger: silentLogger }) as SherpaProvider);
    expect(mod.id).toBe("kokoro");
    const sherpa = createRequire(path.join(import.meta.dirname, "../src/providers/sherpa.ts"))("sherpa-onnx-node");
    expect(typeof sherpa.OfflineTts).toBe("function");
  });

  const realDir = process.env.DOCMAKER_TEST_SHERPA_MODELS; // e.g. a dir holding kokoro-multi-lang-v1_0/
  it.skipIf(!realDir || !existsSync(path.join(realDir ?? "", "kokoro-multi-lang-v1_0", "model.onnx")))("real Kokoro FR synthesis (gated)", async () => {
    const ctx = makeCtx();
    mkdirSync(path.join(ctx.config.paths.models, "kokoro"), { recursive: true });
    symlinkSync(path.join(realDir!, "kokoro-multi-lang-v1_0"), path.join(ctx.config.paths.models, "kokoro", "kokoro-multi-lang-v1_0"));
    const p = new SherpaProvider("kokoro", { config: ctx.config, logger: silentLogger });
    const words = "En mille six cent trente-sept, tout bascule. Le marché s’effondre.".split(" ");
    const r = await p.synthesize({ segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "fr", voice: VoiceSettings.parse({ provider: "kokoro", voiceId: "auto" }) }, path.join(tmpDir(), "real.wav"), ctx.signal);
    expect(r.durationMs).toBeGreaterThan(2000);
    const w = await readWav(r.audioPath);
    expect(w.sampleRate).toBe(24000);
    expect(r.words!.every((x, i) => i === 0 || x.startMs >= r.words![i - 1]!.startMs)).toBe(true);
    const piperSrc = path.join(realDir!, "vits-piper-fr_FR-siwis-medium");
    if (existsSync(piperSrc)) {
      mkdirSync(path.join(ctx.config.paths.models, "piper"), { recursive: true });
      symlinkSync(piperSrc, path.join(ctx.config.paths.models, "piper", "vits-piper-fr_FR-siwis-medium"));
      const pp = new SherpaProvider("piper", { config: ctx.config, logger: silentLogger });
      const rp = await pp.synthesize({ segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "fr", voice: VoiceSettings.parse({ provider: "piper", voiceId: "fr_FR-siwis-medium" }) }, path.join(tmpDir(), "piper.wav"), ctx.signal);
      expect((await readWav(rp.audioPath)).sampleRate).toBe(22050);
      expect(rp.durationMs).toBeGreaterThan(2000);
    }
  }, 120_000);
});

describe("Python sidecar dispatcher (system python, no ML packages)", () => {
  function pyCtx() {
    const ctx = makeCtx();
    mkdirSync(path.join(ctx.config.paths.pyVenv, "bin"), { recursive: true });
    symlinkSync(execSync("command -v python3").toString().trim(), path.join(ctx.config.paths.pyVenv, "bin", "python"));
    return ctx;
  }
  it("unknown commands and missing packages fail with an error code; the aligner maps TOOL_MISSING", async () => {
    const ctx = pyCtx();
    await expect(runSidecar("nope" as "asr", {}, { config: ctx.config, signal: ctx.signal }).catch((e) => { throw sidecarError(e); }))
      .rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("unknown command") });
    const fw = new FasterWhisperAligner(ctx.config);
    expect((await fw.isAvailable()).ok).toBe(true);
    const wav = path.join(DATA, "fr.txt"); // any existing file: the faster_whisper import fails first
    await expect(fw.transcribe(wav, "fr", "", ctx.signal)).rejects.toMatchObject({ code: "TOOL_MISSING", hint: expect.stringContaining("setup --python") });
  }, 30_000);
  it("validates the input before importing heavy packages", async () => {
    const ctx = pyCtx();
    const fw = new FasterWhisperAligner(ctx.config);
    await expect(fw.transcribe("/nonexistent.wav", "fr", "", ctx.signal)).rejects.toMatchObject({ code: "VALIDATION" });
  }, 30_000);
  it("asr output → words: elisions merged, punctuation pieces attached, NW alignment through a stub runner", async () => {
    const ctx = makeCtx();
    const runner = (async () => ({
      words: [
        { text: " C", startMs: 0, endMs: 100, p: 0.9 }, { text: "'est", startMs: 100, endMs: 300, p: 0.8 },
        { text: " fini", startMs: 300, endMs: 600, p: 0.95 }, { text: ".", startMs: 600, endMs: 610, p: 0.99 },
      ],
      durationSec: 1, rtf: 0.2,
    })) as never;
    const fw = new FasterWhisperAligner(ctx.config, runner);
    expect((await fw.transcribe("/x.wav", "fr", "", ctx.signal)).map((w) => w.text)).toEqual(["C'est", "fini."]);
    const al = await fw.align("/x.wav", ["C’est", "bien", "fini."], "fr", ctx.signal);
    expect(al.map((w) => [w.startMs, w.endMs])).toEqual([[0, 300], [300, 300], [300, 610]]);
    expect(mergeAsrWords([{ text: "'abord", startMs: 0, endMs: 5, p: null }])[0]!.text).toBe("'abord");
  });
});

describe("whisper.cpp tokens → words", () => {
  it("joins sub-word tokens, drops specials/punctuation, start = t_dtw − 120 ms, end = last t_dtw", () => {
    const tok = (text: string, t: number) => ({ text, t_dtw: t, p: 0.9, offsets: { from: t * 10, to: t * 10 + 50 } });
    const words = tokensToWords([{ text: "", offsets: { from: 0, to: 0 }, tokens: [tok("[_BEG_]", 0), tok(" Hol", 50), tok("ly", 60), tok("wood", 70), tok(",", 75), tok(" crash", 100), tok("[_TT_50]", 120)] }]);
    expect(words).toEqual([
      { text: "Hollywood", startMs: 380, endMs: 700, confidence: 0.9 },
      { text: "crash", startMs: 880, endMs: 1000, confidence: 0.9 },
    ]);
  });
});

describe("calibrateVoice", () => {
  it("measures speech-only chars/second (pauses ≥ 250 ms excluded) and caches per voice settings", async () => {
    const ctx = makeCtx();
    const projectDir = tmpDir("cal-");
    const voice = VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1", charsPerSec: 16.5 });
    const { charsPerSec } = await calibrateVoice({ lang: "en", voice, projectDir }, ctx);
    // the synthetic voice speaks ≈ cps·(chars+1)/(chars+1+0.06·cps) — a little under the nominal 16.5
    expect(charsPerSec).toBeGreaterThan(13);
    expect(charsPerSec).toBeLessThan(18);
    const again = await calibrateVoice({ lang: "en", voice, projectDir }, makeCtx());
    expect(again.charsPerSec).toBe(charsPerSec);
    const fast = await calibrateVoice({ lang: "en", voice: { ...voice, charsPerSec: 20 }, projectDir }, ctx);
    expect(fast.charsPerSec).toBeGreaterThan(charsPerSec);
  }, 60_000);
  it("speechOnlyMs excludes long pauses only", () => {
    const sr = 1000;
    const s = new Float32Array(2000);
    for (let i = 100; i < 600; i++) s[i] = 0.5; // 500 ms
    for (let i = 700; i < 900; i++) s[i] = 0.5; // 100 ms gap kept → 300 ms
    for (let i = 1400; i < 1500; i++) s[i] = 0.5; // 500 ms pause excluded → 100 ms
    expect(speechOnlyMs(s, sr)).toBeCloseTo(900, -1);
  });
});

describe("teleprompterHtml", () => {
  it("renders segments as anchors with tts text, stage directions, cps, mirror and outdated flags", () => {
    const script = makeScript({ lang: "fr", chapters: 2, segmentsPerChapter: 2, withClip: true, withBreath: true });
    const segs = script.chapters.flatMap((c) => c.segments);
    const narr = segs.filter((s) => s.type === "narration");
    const html = teleprompterHtml(script, { cps: 15.5, mirror: true, lang: "fr", outdated: [narr[1]!.id] });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('<body class="mirror">');
    expect(html).toContain("const CPS = 15.5;");
    for (const s of narr) expect(html).toContain(`id="${s.id}"`);
    expect(html).toContain(`class="seg outdated" id="${narr[1]!.id}"`);
    expect(html).toContain("suspense"); // cliffhanger device → stage direction
    expect(html).toContain("EXTRAIT");
    expect(html).toContain("RESPIRATION MUSICALE");
    expect(html).not.toMatch(/https?:\/\//); // self-contained
    expect(teleprompterHtml({ ...script, title: "<script>alert(1)</script>" }, { cps: 15, mirror: false, lang: "en" })).not.toContain("<script>alert(1)");
  });
});

describe("synthesizeTrack with a local provider + ASR QA", () => {
  it("aligns estimated timings with the ASR, records WER, and --retry-bad re-synthesises a bad segment once", async () => {
    const script = makeScript({ lang: "en", chapters: 1, segmentsPerChapter: 2 });
    const segs = script.chapters[0]!.segments;
    const run = async (retryBad: boolean) => {
      const ctx = makeCtx();
      withModels(ctx);
      const log = { configs: [] as unknown[], texts: [] as string[] };
      const provider = new SherpaProvider("kokoro", { config: ctx.config, logger: silentLogger, loader: () => fakeSherpa(log) });
      const good = (k: number) => segs[k]!.ttsText.split(" ");
      // calls in order: S01 (garbled first rendition), [S01 retry], S02
      const queue = [good(0).map(() => "zzz"), ...(retryBad ? [good(0)] : []), good(1)];
      const asr = {
        id: "faster-whisper" as const,
        async isAvailable() { return { ok: true, hint: null }; },
        async transcribe() {
          const ws = queue.shift()!;
          return ws.map((text, i) => ({ text, startMs: 40 + i * 90, endMs: 120 + i * 90, confidence: 0.8 }));
        },
        async align(): Promise<never> { throw new Error("unused"); },
      };
      return synthesizeTrack({
        lang: "en", script, voice: VoiceSettings.parse({ provider: "kokoro", voiceId: "16" }), kind: "final", clipNarrated: [], segments: null, previous: null,
        projectDir: tmpDir("k-proj-"), styleCps: 16.5, retryBad, provider, asr,
      }, ctx);
    };
    const bad = await run(false);
    expect(bad.timing.source).toBe("aligned");
    expect(bad.segments[0]!.asrWer).toBe(1);
    expect(bad.segments[1]!.asrWer).toBe(0);
    expect(bad.notes.join(" ")).toMatch(/ASR QA failed for 1 segment.*--retry-bad/);
    expect(bad.license).toMatchObject({ code: "PROVIDER-TERMS", version: "Apache-2.0" });
    const fixed = await run(true);
    expect(fixed.segments[0]!.asrWer).toBe(0);
    expect(fixed.notes.join(" ")).not.toMatch(/QA failed/);
    expect(fixed.segments[0]!.cacheKey).not.toBe(bad.segments[0]!.cacheKey);
  }, 60_000);
});
