import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Aligner, Lang, WordTiming } from "@docmaker/core";
import { VoiceSettings, VoiceTrack, spokenText, tokenizeDisplay } from "@docmaker/core";
import { readWav, writeWav } from "@docmaker/core/node";
import { makeScript } from "@docmaker/core/testing";
import { detectRetakes, importRecording } from "../src/index";
import { detectSilences } from "../src/audio/silence";
import { buildSynthPlan } from "../src/providers/synthetic";
import { renderSynth } from "../src/providers/synth-dsp";
import { makeCtx, tmpDir } from "./helpers";

/** A stand-in ASR for synthetic speech: every sound island between ≥ 40 ms silences is the next expected word. */
class IslandAsr implements Aligner {
  readonly id = "faster-whisper" as const;
  calls: string[] = [];
  constructor(private readonly spoken: Map<string, string[]>) {}
  async isAvailable() { return { ok: true, hint: null }; }
  async transcribe(audioPath: string): Promise<WordTiming[]> {
    this.calls.push(audioPath);
    const key = [...this.spoken.keys()].find((k) => path.basename(audioPath).startsWith(k))!;
    const words = this.spoken.get(key)!;
    const w = await readWav(audioPath);
    const s = w.data[0]!;
    const sil = detectSilences(s, w.sampleRate, { thresholdDb: -50, minMs: 40 });
    const islands: [number, number][] = [];
    let cur = 0;
    for (const x of sil) { if (x.startMs > cur) islands.push([cur, x.startMs]); cur = x.endMs; }
    const dur = (s.length * 1000) / w.sampleRate;
    if (cur < dur - 1) islands.push([cur, dur]);
    return words.slice(0, islands.length).map((text, i) => ({ text, startMs: Math.round(islands[i]![0]), endMs: Math.round(islands[i]![1]), confidence: 0.9 }));
  }
  async align(): Promise<WordTiming[]> { throw new Error("unused"); }
}

async function speak(file: string, words: string[], seed = 1) {
  const { plan } = buildSynthPlan(words, { cps: 15, f0: 140, seed });
  await writeWav(file, { sampleRate: 48000, channels: 1, data: [renderSynth(plan)] }, "s16");
}

const lang: Lang = "en";
const script = makeScript({ lang, chapters: 1, segmentsPerChapter: 3 });
const segs = script.chapters[0]!.segments;
const words = (k: number) => tokenizeDisplay(spokenText(segs[k]!, "vo")).map((d) => d.text);

describe("detectRetakes", () => {
  it("drops the earlier attempt of a 4-gram repeated within 30 s, keeps the last", () => {
    const w = ["the", "prices", "doubled", "in", "the", "prices", "doubled", "in", "weeks"].map((text, i) => ({ text, startMs: i * 400, file: 0 }));
    const r = detectRetakes(w);
    expect(r.runs).toEqual([[0, 4]]);
    expect(r.keep).toEqual([false, false, false, false, true, true, true, true, true]);
  });
  it("ignores repeats farther than 30 s apart, across files, or that the script itself contains", () => {
    const far = ["a", "b", "c", "d", "a", "b", "c", "d"].map((text, i) => ({ text, startMs: i < 4 ? i * 100 : 40_000 + i * 100, file: 0 }));
    expect(detectRetakes(far).runs).toEqual([]);
    const files = ["a", "b", "c", "d", "a", "b", "c", "d"].map((text, i) => ({ text, startMs: i * 100, file: i < 4 ? 0 : 1 }));
    expect(detectRetakes(files).runs).toEqual([]);
    const rep = ["again", "and", "again", "and", "again", "and", "again", "and"];
    expect(detectRetakes(rep.map((text, i) => ({ text, startMs: i * 100, file: 0 })), [...rep, ...rep]).runs).toEqual([]);
  });
});

describe("importRecording — global mode", () => {
  it("cuts segments at silences, removes a retake, aligns words, reports missing segments", async () => {
    const dir = tmpDir("rec-src-");
    const projectDir = tmpDir("rec-proj-");
    // spoken: S01, a false start of S02 (5 words), S02 in full; S03 never recorded
    const spoken = [...words(0), ...words(1).slice(0, 5), ...words(1)];
    await speak(path.join(dir, "take1.wav"), spoken);
    const asr = new IslandAsr(new Map([["take1", spoken]]));
    const ctx = makeCtx();
    const t = await importRecording({ lang, script, files: [path.join(dir, "take1.wav")], mode: "global", aligner: "auto", previous: null, projectDir, pickup: null, asr }, ctx);
    expect(() => VoiceTrack.parse(t)).not.toThrow();
    expect(t.provider).toBe("recording");
    expect(t.kind).toBe("final");
    expect(t.license.code).toBe("USER-OWNED");
    expect(t.missingSegmentIds).toEqual([segs[2]!.id]);
    expect(t.notes.join(" ")).toMatch(/1 retake/);
    expect(existsSync(path.join(projectDir, "voice/en/recordings/take1.wav"))).toBe(true);
    const [s1, s2] = t.segments;
    expect(s1!.segmentId).toBe(segs[0]!.id);
    expect(s2!.segmentId).toBe(segs[1]!.id);
    for (const s of t.segments) {
      expect(s.words.map((w) => w.text)).toEqual(words(segs.findIndex((x) => x.id === s.segmentId)));
      expect(s.words.every((w) => w.source === "aligned")).toBe(true);
      expect(s.words[0]!.startMs).toBeGreaterThan(20); // some lead silence is kept before the first word
      expect(s.words[s.words.length - 1]!.endMs).toBeLessThanOrEqual(s.durationMs);
      expect(s.asrWer).toBe(0);
      // every word start is audible in the segment file
      const w = await readWav(path.join(projectDir, s.file));
      const sil = detectSilences(w.data[0]!, 48000, { thresholdDb: -50, minMs: 40 });
      for (const word of s.words) expect(sil.some((x) => word.startMs > x.startMs + 15 && word.startMs < x.endMs - 15)).toBe(false);
    }
    // the retake is cut out: S02's file holds one attempt (≈ its words), not two
    const s2Span = s2!.words[s2!.words.length - 1]!.endMs - s2!.words[0]!.startMs;
    expect(s2!.durationMs).toBeLessThan(s2Span + 1000);
  }, 60_000);

  it("fills missing segments with pickup TTS (pickup: true) and refuses without an ASR", async () => {
    const dir = tmpDir("rec-src-");
    const projectDir = tmpDir("rec-proj-");
    const spoken = [...words(0), ...words(2)];
    await speak(path.join(dir, "a.wav"), spoken, 4);
    const asr = new IslandAsr(new Map([["a", spoken]]));
    const pickup = { provider: "synthetic" as const, voice: VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-f1" }) };
    const t = await importRecording({ lang, script, files: [path.join(dir, "a.wav")], mode: "global", aligner: "auto", previous: null, projectDir, pickup, asr }, makeCtx());
    expect(t.missingSegmentIds).toEqual([]);
    expect(t.segments.map((s) => [s.segmentId, s.pickup])).toEqual([[segs[0]!.id, false], [segs[1]!.id, true], [segs[2]!.id, false]]);
    expect(t.notes.join(" ")).toMatch(/PICKUP TTS \(synthetic\) for 1 segment/);
    for (const s of t.segments) expect(existsSync(path.join(projectDir, s.file))).toBe(true);
    // no ASR installed (offline home) → TOOL_MISSING with the setup hint
    await expect(importRecording({ lang, script, files: [path.join(dir, "a.wav")], mode: "global", aligner: "auto", previous: null, projectDir, pickup: null }, makeCtx()))
      .rejects.toMatchObject({ code: "TOOL_MISSING", hint: expect.stringContaining("setup --python") });
  }, 60_000);
});

describe("importRecording — per-segment mode", () => {
  it("replaces only the re-recorded segment of the previous take (new take id)", async () => {
    const dir = tmpDir("rec-src-");
    const projectDir = tmpDir("rec-proj-");
    const all = [...words(0), ...words(1), ...words(2)];
    await speak(path.join(dir, "full.wav"), all, 2);
    const first = await importRecording({ lang, script, files: [path.join(dir, "full.wav")], mode: "global", aligner: "auto", previous: null, projectDir, pickup: null, asr: new IslandAsr(new Map([["full", all]])) }, makeCtx());
    expect(first.missingSegmentIds).toEqual([]);
    const id = segs[1]!.id;
    await speak(path.join(dir, `${id}.wav`), words(1), 9);
    const asr = new IslandAsr(new Map([[id, words(1)]]));
    const second = await importRecording({ lang, script, files: [path.join(dir, `${id}.wav`)], mode: "per-segment", aligner: "auto", previous: first, projectDir, pickup: null, asr }, makeCtx());
    expect(second.id).not.toBe(first.id);
    // a file from elsewhere is stored in recordings/ under its own name (never as a shadowing <id>-<n> copy)
    expect(existsSync(path.join(projectDir, `voice/en/recordings/${id}.wav`))).toBe(true);
    expect(existsSync(path.join(projectDir, `voice/en/recordings/${id}-1.wav`))).toBe(false);
    for (const s of second.segments) {
      const old = first.segments.find((x) => x.segmentId === s.segmentId)!;
      if (s.segmentId === id) expect(s.sha256).not.toBe(old.sha256);
      else expect(s.sha256).toBe(old.sha256);
    }
    expect(second.segments.find((s) => s.segmentId === id)!.words.every((w) => w.source === "aligned")).toBe(true);
  }, 60_000);

  it("a re-uploaded segment replaces the earlier take (files in recordings/ are used in place, newest wins)", async () => {
    const projectDir = tmpDir("rec-proj-");
    const recDir = path.join(projectDir, "voice/en/recordings");
    mkdirSync(recDir, { recursive: true });
    const id = segs[0]!.id;
    // what the voice stage does: every audio file of recordings/ is passed to importRecording
    const scan = () => readdirSync(recDir).filter((f) => /\.(wav|flac)$/.test(f)).sort().map((f) => path.join(recDir, f));
    const run = async () => {
      const asr = new IslandAsr(new Map([[id, words(0)]]));
      const t = await importRecording({ lang, script, files: scan(), mode: "per-segment", aligner: "auto", previous: null, projectDir, pickup: null, asr }, makeCtx());
      return { take: t.segments.find((s) => s.segmentId === id)!, asr };
    };
    // take 1 uploaded as recordings/<id>.wav, imported
    await speak(path.join(recDir, `${id}.wav`), words(0), 11);
    const one = await run();
    expect(readdirSync(recDir).filter((f) => f.startsWith(id))).toEqual([`${id}.wav`]);
    // retake uploaded at the same name (the upload replaces the file), imported again → the new take is used
    await speak(path.join(recDir, `${id}.wav`), words(0), 12);
    const two = await run();
    expect(readdirSync(recDir).filter((f) => f.startsWith(id))).toEqual([`${id}.wav`]);
    expect(two.take.sha256).not.toBe(one.take.sha256);
    expect(two.take.durationMs).not.toBe(one.take.durationMs);
    // a third take uploaded with another extension: same rank (no -n), the most recently written file wins
    await new Promise((r) => setTimeout(r, 30));
    await speak(path.join(recDir, `${id}.flac`), words(0), 13);
    const three = await run();
    expect(three.asr.calls.map((c) => path.basename(c))).toEqual([`${id}.flac.wav`]);
    expect(three.take.sha256).not.toBe(two.take.sha256);
    // an explicit -n version still outranks an un-numbered file
    await new Promise((r) => setTimeout(r, 30));
    await speak(path.join(recDir, `${id}-2.wav`), words(0), 14);
    await new Promise((r) => setTimeout(r, 30));
    await speak(path.join(recDir, `${id}.wav`), words(0), 15);
    const four = await run();
    expect(four.asr.calls.map((c) => path.basename(c))).toEqual([`${id}-2.wav.wav`]);
  }, 90_000);

  it("works without an ASR (estimated timings + note) and validates file names", async () => {
    const dir = tmpDir("rec-src-");
    const projectDir = tmpDir("rec-proj-");
    const id = segs[0]!.id;
    await speak(path.join(dir, `${id}-3.wav`), words(0), 5);
    const t = await importRecording({ lang, script, files: [path.join(dir, `${id}-3.wav`)], mode: "per-segment", aligner: "auto", previous: null, projectDir, pickup: null }, makeCtx());
    expect(t.segments).toHaveLength(1);
    expect(t.missingSegmentIds).toEqual([segs[1]!.id, segs[2]!.id]);
    expect(t.notes.join(" ")).toMatch(/estimated/);
    const s = t.segments[0]!;
    expect(s.words).toHaveLength(words(0).length);
    expect(s.words[s.words.length - 1]!.endMs).toBeLessThanOrEqual(s.durationMs);
    await speak(path.join(dir, "random.wav"), ["x"], 1);
    await expect(importRecording({ lang, script, files: [path.join(dir, "random.wav")], mode: "per-segment", aligner: "auto", previous: null, projectDir, pickup: null }, makeCtx()))
      .rejects.toMatchObject({ code: "VALIDATION" });
  }, 60_000);
});
