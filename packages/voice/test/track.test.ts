import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceSettings, VoiceTrack, hashJson, spokenText, tokenizeDisplay, type Script } from "@docmaker/core";
import { readWavHeader, sha256File } from "@docmaker/core/node";
import { makeScript } from "@docmaker/core/testing";
import type { TtsRequest } from "@docmaker/core";
import { SyntheticProvider, editedAfterTake, estimateTtsCost, synthesizeTrack, takeIdFor, voiceLicense, voiceSettingsHash } from "../src/index";
import { makeCtx, tmpDir } from "./helpers";

const synthVoice = VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1" });

function input(script: Script, projectDir: string, over: Partial<Parameters<typeof synthesizeTrack>[0]> = {}): Parameters<typeof synthesizeTrack>[0] {
  return {
    lang: script.lang, script, voice: synthVoice, kind: "scratch", clipNarrated: [], segments: null, previous: null, projectDir,
    styleCps: 16.5, retryBad: false, ...over,
  };
}

describe("synthesizeTrack — synthetic scratch take (M1)", () => {
  const script = makeScript({ lang: "en", chapters: 2, segmentsPerChapter: 2, withClip: true, withBreath: true });
  const projectDir = tmpDir("voice-proj-");
  const ctx = makeCtx();
  let first: VoiceTrack;

  it("produces a schema-valid take with one segment per narration segment, files under the take dir", async () => {
    first = await synthesizeTrack(input(script, projectDir), ctx);
    expect(() => VoiceTrack.parse(first)).not.toThrow();
    expect(first.id).toMatch(/^scratch-[a-f0-9]{12}$/);
    expect(first.kind).toBe("scratch");
    expect(first.provider).toBe("synthetic");
    expect(first.license).toMatchObject({ code: "PROCEDURAL", restrictions: ["synthetic"] });
    expect(first.timing.source).toBe("synthetic");
    expect(first.charsBilled).toBe(0);
    expect(first.costUsd).toBe(0);
    const narration = script.chapters.flatMap((c) => c.segments).filter((s) => s.type === "narration");
    expect(first.segments.map((s) => s.segmentId)).toEqual(narration.map((s) => s.id));
    for (const s of first.segments) {
      const file = path.join(projectDir, s.file);
      expect(s.file).toBe(`voice/en/${first.id}/seg/${s.segmentId}.wav`);
      expect(existsSync(file)).toBe(true);
      expect(await sha256File(file)).toBe(s.sha256);
      const h = await readWavHeader(file);
      expect(h).toMatchObject({ sampleRate: 48000, channels: 1, bitsPerSample: 16 });
      expect(Math.abs(h.durationMs - s.durationMs)).toBeLessThanOrEqual(1);
      expect(s.leadTrimMs).toBe(90);
      const seg = narration.find((n) => n.id === s.segmentId)!;
      const display = tokenizeDisplay(spokenText(seg, "vo"));
      expect(s.words.map((w) => w.wordId)).toEqual(display.map((d) => `${s.segmentId}:${d.idx}`));
      expect(s.words.map((w) => w.text)).toEqual(display.map((d) => d.text));
      expect(s.words[0]!.startMs).toBe(30); // 120 ms lead − 90 ms trim
      for (let k = 0; k < s.words.length; k++) {
        const w = s.words[k]!;
        expect(w.endMs).toBeGreaterThan(w.startMs);
        expect(w.endMs).toBeLessThanOrEqual(s.durationMs);
        if (k) expect(w.startMs).toBeGreaterThan(s.words[k - 1]!.endMs);
      }
      expect(s.ttsTextHash).toBe(hashJson(s.ttsText));
      expect(s.pickup).toBe(false);
    }
  }, 60_000);

  it("an all-cache-hit re-run reproduces the same take id without re-synthesising", async () => {
    const cacheFile = path.join(projectDir, "voice/en/.segcache", `${first.segments[0]!.cacheKey}.wav`);
    const mtime = statSync(cacheFile).mtimeMs;
    const c2 = makeCtx();
    const again = await synthesizeTrack(input(script, projectDir), c2);
    expect(again.id).toBe(first.id);
    expect(again.segments.map((s) => s.sha256)).toEqual(first.segments.map((s) => s.sha256));
    expect(statSync(cacheFile).mtimeMs).toBe(mtime);
    expect(c2.events.length).toBe(first.segments.length);
  }, 60_000);

  it("re-synthesising one segment gives it a new rendition and reuses the others", async () => {
    const target = first.segments[1]!.segmentId;
    const t = await synthesizeTrack(input(script, projectDir, { segments: [target], previous: first }), ctx);
    expect(t.id).not.toBe(first.id);
    for (const s of t.segments) {
      const old = first.segments.find((x) => x.segmentId === s.segmentId)!;
      if (s.segmentId === target) {
        expect(s.cacheKey).not.toBe(old.cacheKey);
        expect(s.sha256).not.toBe(old.sha256);
      } else {
        expect(s.cacheKey).toBe(old.cacheKey);
        expect(s.sha256).toBe(old.sha256);
      }
      expect(existsSync(path.join(projectDir, s.file))).toBe(true);
    }
  }, 60_000);

  it("a scratch take is always synthetic, even when the project voice is ElevenLabs", async () => {
    const el = VoiceSettings.parse({ provider: "elevenlabs", voiceId: "auto" });
    const t = await synthesizeTrack(input(script, projectDir, { voice: el }), ctx);
    expect(t.provider).toBe("synthetic");
    expect(t.voiceId).toBe("synthetic-m1");
  }, 60_000);

  it("a final synthetic take uses the take- prefix; a different cps changes timing and the id", async () => {
    const fin = await synthesizeTrack(input(script, projectDir, { kind: "final" }), ctx);
    expect(fin.id).toMatch(/^take-/);
    const slow = await synthesizeTrack(input(script, projectDir, { kind: "final", styleCps: 12 }), ctx);
    expect(slow.id).not.toBe(fin.id);
    expect(slow.segments[0]!.durationMs).toBeGreaterThan(fin.segments[0]!.durationMs);
  }, 60_000);
});

describe("synthesizeTrack — clip-narrated (FR narrator reads the translation)", () => {
  it("voices the clip's subtitleTranslation with mode clip-narrated", async () => {
    const script = makeScript({ lang: "fr", chapters: 2, segmentsPerChapter: 2, withClip: true });
    const clip = script.chapters.flatMap((c) => c.segments).find((s) => s.type === "clip")!;
    const t = await synthesizeTrack(input(script, tmpDir("voice-proj-"), { clipNarrated: [clip.id] }), makeCtx());
    const s = t.segments.find((x) => x.segmentId === clip.id)!;
    expect(s.mode).toBe("clip-narrated");
    expect(s.words.map((w) => w.text)).toEqual(tokenizeDisplay(clip.subtitleTranslation).map((d) => d.text));
    expect(s.ttsText).toContain("fièvre");
  }, 60_000);
});

describe("ids, hashes, licences, costs", () => {
  it("takeIdFor is deterministic and independent of segment order", () => {
    const a = takeIdFor("final", "elevenlabs", "v1", "h", ["b", "a", "c"]);
    expect(a).toBe(takeIdFor("final", "elevenlabs", "v1", "h", ["c", "b", "a"]));
    expect(a).toMatch(/^take-[a-f0-9]{12}$/);
    expect(takeIdFor("scratch", "elevenlabs", "v1", "h", ["a", "b", "c"]).slice(8)).toBe(a.slice(5));
    expect(takeIdFor("final", "elevenlabs", "v2", "h", ["a"])).not.toBe(takeIdFor("final", "elevenlabs", "v1", "h", ["a"]));
  });
  it("voiceSettingsHash ignores lexicon/consent/pickup, and cps except for the synthetic voice", () => {
    const base = VoiceSettings.parse({ provider: "elevenlabs", voiceId: "x" });
    expect(voiceSettingsHash({ ...base, lexicon: [{ match: "a", say: "b", caseSensitive: false }], pickupProvider: "kokoro" })).toBe(voiceSettingsHash(base));
    expect(voiceSettingsHash({ ...base, charsPerSec: 14 })).toBe(voiceSettingsHash(base));
    expect(voiceSettingsHash({ ...base, stability: 0.9 })).not.toBe(voiceSettingsHash(base));
    expect(voiceSettingsHash({ ...synthVoice, charsPerSec: 14 })).not.toBe(voiceSettingsHash({ ...synthVoice, charsPerSec: 16 }));
  });
  it("voiceLicense per provider", () => {
    expect(voiceLicense("recording", "me", null)).toMatchObject({ code: "USER-OWNED", commercialOk: true });
    expect(voiceLicense("elevenlabs", "v", "free")).toMatchObject({ code: "PROVIDER-TERMS", commercialOk: false, attributionRequired: true, restrictions: ["nc", "synthetic"] });
    expect(voiceLicense("elevenlabs", "v", "creator")).toMatchObject({ commercialOk: true, attributionRequired: false });
    expect(voiceLicense("piper", "fr_FR-siwis-medium", null)).toMatchObject({ code: "CC-BY", attributionRequired: true });
    expect(voiceLicense("piper", "fr_FR-siwis-medium", null).attributionText).toContain("SIWIS");
    expect(voiceLicense("piper", "fr_FR-upmc-medium", null)).toMatchObject({ code: "CC-BY-SA" });
    expect(voiceLicense("piper", "fr_FR-gilles-low", null)).toMatchObject({ code: "CC0", attributionRequired: false });
    expect(voiceLicense("piper", "en_US-ryan-high", null)).toMatchObject({ commercialOk: false, restrictions: ["nc", "sa", "synthetic"] });
    expect(voiceLicense("kokoro", "16", null)).toMatchObject({ code: "PROVIDER-TERMS", version: "Apache-2.0" });
    expect(voiceLicense("synthetic", "synthetic-f1", null).code).toBe("PROCEDURAL");
  });
  it("estimateTtsCost bills ElevenLabs characters only, skipping unchanged segments of the same voice", () => {
    const script = makeScript({ lang: "en", chapters: 1, segmentsPerChapter: 3 });
    const segs = script.chapters[0]!.segments;
    const chars = segs.reduce((a, s) => a + [...s.ttsText].length, 0);
    const el = VoiceSettings.parse({ provider: "elevenlabs", voiceId: "abc" });
    const [line] = estimateTtsCost({ script, voice: el, segments: null, previous: null });
    expect(line).toMatchObject({ provider: "elevenlabs", unit: "characters", quantity: chars });
    expect(line!.totalUsd).toBeCloseTo((chars / 1000) * 0.08, 6);
    expect(estimateTtsCost({ script, voice: synthVoice, segments: null, previous: null })).toEqual([]);
    const only = estimateTtsCost({ script, voice: el, segments: [segs[0]!.id], previous: null });
    expect(only[0]!.quantity).toBe([...segs[0]!.ttsText].length);
    const prev = {
      provider: "elevenlabs", settingsHash: voiceSettingsHash({ ...el, modelId: "eleven_multilingual_v2" }),
      segments: segs.slice(0, 2).map((s) => ({ segmentId: s.id, ttsTextHash: hashJson(s.ttsText) })),
    } as unknown as VoiceTrack;
    expect(estimateTtsCost({ script, voice: el, segments: null, previous: prev })[0]!.quantity).toBe([...segs[2]!.ttsText].length);
  });
});

describe("editedAfterTake", () => {
  it("lists segments whose tts text changed and narration not covered by the take", async () => {
    const script = makeScript({ lang: "en", chapters: 1, segmentsPerChapter: 3 });
    const projectDir = tmpDir("voice-proj-");
    const take = await synthesizeTrack(input(script, projectDir, { segments: null }), makeCtx());
    expect(editedAfterTake(script, take)).toEqual([]);
    const edited = structuredClone(script);
    const s1 = edited.chapters[0]!.segments[1]!;
    s1.displayText = `${s1.displayText} Again.`;
    s1.ttsText = s1.displayText;
    // whitespace-only differences are not edits
    edited.chapters[0]!.segments[0]!.ttsText = `  ${edited.chapters[0]!.segments[0]!.ttsText.replace(/ /g, "  ")} `;
    edited.chapters[0]!.segments.push({ ...s1, id: "CH1-S09", displayText: "A new line.", ttsText: "A new line." });
    expect(editedAfterTake(edited, take)).toEqual([s1.id, "CH1-S09"]);
    expect(editedAfterTake(edited, { ...take, missingSegmentIds: ["CH1-S09"] })).toEqual([s1.id]);
  }, 60_000);
});

describe("synthesizeTrack — request chunking above maxCharsPerRequest", () => {
  it("splits at sentence ends, concatenates the audio and offsets the word timings", async () => {
    class SmallSynth extends SyntheticProvider {
      calls: string[] = [];
      override async capabilities() { return { ...(await super.capabilities()), maxCharsPerRequest: 70 }; }
      override async synthesize(req: TtsRequest, out: string, signal: AbortSignal) { this.calls.push(req.text); return super.synthesize(req, out, signal); }
    }
    const script = makeScript({ lang: "en", chapters: 1, segmentsPerChapter: 1 });
    const seg = script.chapters[0]!.segments[0]!;
    expect(seg.ttsText.length).toBeGreaterThan(70);
    const provider = new SmallSynth({ repoRoot: null, useWorker: "never" });
    const t = await synthesizeTrack(input(script, tmpDir("voice-proj-"), { kind: "final", provider }), makeCtx());
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    expect(provider.calls.every((c) => c.length <= 70)).toBe(true);
    expect(provider.calls.join(" ")).toBe(seg.ttsText);
    const s = t.segments[0]!;
    expect(s.words).toHaveLength(tokenizeDisplay(seg.displayText).length);
    for (let k = 1; k < s.words.length; k++) expect(s.words[k]!.startMs).toBeGreaterThan(s.words[k - 1]!.endMs);
    expect(s.words[s.words.length - 1]!.endMs).toBeLessThanOrEqual(s.durationMs);
  }, 60_000);
});
