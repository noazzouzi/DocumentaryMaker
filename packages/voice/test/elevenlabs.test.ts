import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceSettings } from "@docmaker/core";
import { ffmpeg } from "@docmaker/core/node";
import { makeScript } from "@docmaker/core/testing";
import { ElevenLabsProvider, assertVoiceAllowed, synthesizeTrack, type ElevenLabsLike } from "../src/index";
import { pcmToWav, type ElevenTtsBody, type ElevenVoice } from "../src/providers/elevenlabs";
import { makeCtx, silentLogger, tmpDir } from "./helpers";

const SR = 44100;
const LEAD_S = 0.1;
const CHAR_S = 0.05;

/** s16le PCM: 100 ms silence, then a tone during every non-space character (silence on spaces). */
function fakePcm(text: string): Buffer {
  const chars = [...text];
  const n = Math.round((LEAD_S + chars.length * CHAR_S + 0.2) * SR);
  const b = Buffer.alloc(n * 2);
  chars.forEach((c, i) => {
    if (/\s/.test(c)) return;
    const a = Math.round((LEAD_S + i * CHAR_S) * SR), e = Math.round((LEAD_S + (i + 1) * CHAR_S) * SR);
    for (let s = a; s < e; s++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 220 * s) / SR)), s * 2);
  });
  return b;
}

interface Call { voiceId: string; body: ElevenTtsBody }
function mockClient(o: { tier?: string; voices?: ElevenVoice[]; failPcm?: number; mp3?: Buffer; fail?: unknown } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const client: ElevenLabsLike & { calls: Call[] } = {
    calls,
    textToSpeech: {
      convertWithTimestamps(voiceId, body) {
        return {
          async withRawResponse() {
            calls.push({ voiceId, body });
            if (o.fail) throw o.fail;
            if (body.outputFormat === "pcm_44100" && o.failPcm) throw Object.assign(new Error("output_format requires Pro"), { statusCode: o.failPcm });
            const chars = [...body.text];
            const audio = body.outputFormat === "pcm_44100" ? fakePcm(body.text) : o.mp3!;
            n++;
            return {
              data: {
                audioBase64: audio.toString("base64"),
                alignment: {
                  characters: chars,
                  characterStartTimesSeconds: chars.map((_, i) => LEAD_S + i * CHAR_S),
                  characterEndTimesSeconds: chars.map((_, i) => LEAD_S + (i + 1) * CHAR_S),
                },
              },
              rawResponse: { headers: { get: (h: string) => (h === "request-id" ? `req-${n}` : null) } },
            };
          },
        };
      },
    },
    voices: {
      async search() { return { voices: o.voices ?? [{ voiceId: "fr1", name: "Claire", category: "premade", labels: { language: "fr" } }, { voiceId: "en1", name: "Adam", category: "premade", labels: { language: "en" } }] }; },
      async get(id) {
        const v = (o.voices ?? []).find((x) => x.voiceId === id);
        if (!v) throw Object.assign(new Error("not found"), { statusCode: 404 });
        return v;
      },
    },
    user: { subscription: { async get() { return { tier: o.tier ?? "pro" }; } } },
  };
  return client;
}

const el = (over: Partial<VoiceSettings> = {}) => VoiceSettings.parse({ provider: "elevenlabs", voiceId: "en1", ...over });
const script = makeScript({ lang: "en", chapters: 2, segmentsPerChapter: 5 });

function provider(ctx: ReturnType<typeof makeCtx>, client: ElevenLabsLike) {
  return new ElevenLabsProvider({ apiKey: null, client, config: { ...ctx.config, offline: false }, logger: silentLogger });
}
const voices: ElevenVoice[] = [{ voiceId: "en1", name: "Adam", category: "premade", labels: { language: "en" } }];

describe("ElevenLabs provider (mocked SDK)", () => {
  it("stitches sequentially per chapter with previousRequestIds.slice(-3), records receipts, reuses the cache", async () => {
    const ctx = makeCtx();
    const client = mockClient({ voices });
    const projectDir = tmpDir("el-proj-");
    const input = { lang: "en" as const, script, voice: el(), kind: "final" as const, clipNarrated: [], segments: null, previous: null, projectDir, styleCps: 16.5, retryBad: false, provider: provider(ctx, client), asr: null };
    const take = await synthesizeTrack(input, ctx);
    expect(client.calls).toHaveLength(10);
    const ch1 = client.calls.slice(0, 5).map((c) => c.body);
    expect(ch1[0]!.previousRequestIds).toBeUndefined();
    expect(ch1[0]!.previousText).toBeUndefined();
    expect(ch1[0]!.nextText).toBe(script.chapters[0]!.segments[1]!.ttsText);
    expect(ch1[1]!.previousRequestIds).toEqual(["req-1"]);
    expect(ch1[1]!.previousText).toBeUndefined(); // ignored by the API when ids are sent
    expect(ch1[3]!.previousRequestIds).toEqual(["req-1", "req-2", "req-3"]);
    expect(ch1[4]!.previousRequestIds).toEqual(["req-2", "req-3", "req-4"]);
    // a new chapter starts a new stitching chain
    expect(client.calls[5]!.body.previousRequestIds).toBeUndefined();
    expect(ch1.every((b) => b.modelId === "eleven_multilingual_v2" && b.languageCode === undefined && b.outputFormat === "pcm_44100")).toBe(true);
    expect(ch1[0]!.voiceSettings).toMatchObject({ stability: 0.45, similarityBoost: 0.8, style: 0.15, useSpeakerBoost: true, speed: 1 });
    expect(take.provider).toBe("elevenlabs");
    expect(take.timing.source).toBe("provider");
    expect(take.segments.map((s) => s.providerRequestId)).toEqual(Array.from({ length: 10 }, (_, i) => `req-${i + 1}`));
    const chars = script.chapters.flatMap((c) => c.segments).reduce((a, s) => a + [...s.ttsText].length, 0);
    expect(take.charsBilled).toBe(chars);
    expect(take.costUsd).toBeCloseTo((chars / 1000) * 0.08, 6);
    expect(ctx.costs.receipts).toHaveLength(10);
    expect(ctx.costs.receipts[0]).toMatchObject({ provider: "elevenlabs", stage: "voice", lang: "en", usage: { characters: [...script.chapters[0]!.segments[0]!.ttsText].length } });
    expect(ctx.costs.budgetChecks).toBe(10);
    // provider timings, shifted by the lead trim (100 ms lead → 70 ms trimmed)
    const s0 = take.segments[0]!;
    expect(s0.leadTrimMs).toBe(70);
    expect(s0.words[0]).toMatchObject({ startMs: 30, source: "provider" });
    expect(take.license).toMatchObject({ code: "PROVIDER-TERMS", commercialOk: true });
    // all cache hits: no new calls, same take id, nothing billed
    const ctx2 = makeCtx();
    const again = await synthesizeTrack({ ...input, provider: provider(ctx2, client) }, ctx2);
    expect(client.calls).toHaveLength(10);
    expect(again.id).toBe(take.id);
    expect(again.charsBilled).toBe(0);
    expect(ctx2.costs.receipts).toHaveLength(0);
  }, 60_000);

  it("falls back from pcm_44100 to mp3_44100_128 on a tier 4xx and corrects the MP3 priming offset", async () => {
    const ctx = makeCtx();
    const dir = tmpDir("el-mp3-");
    const text = script.chapters[0]!.segments[0]!.ttsText;
    await import("node:fs/promises").then((fs) => fs.writeFile(path.join(dir, "a.wav"), pcmToWav(fakePcm(text), SR)));
    // no Xing/LAME header: the decoder cannot remove the encoder delay (like a raw streamed MP3)
    await ffmpeg(["-i", path.join(dir, "a.wav"), "-c:a", "libmp3lame", "-b:a", "128k", "-write_xing", "0", path.join(dir, "a.mp3")], { config: ctx.config, signal: ctx.signal });
    const client = mockClient({ voices, failPcm: 403, mp3: await readFile(path.join(dir, "a.mp3")) });
    const p = provider(ctx, client);
    const words = text.split(/\s+/);
    const r = await p.synthesize({ segmentId: "CH1-S01", text, ttsWords: words, lang: "en", voice: el() }, path.join(dir, "out.raw"), ctx.signal);
    expect(client.calls.map((c) => c.body.outputFormat)).toEqual(["pcm_44100", "mp3_44100_128"]);
    expect(r.words).toHaveLength(words.length);
    // the encoder delay (≈ 25–50 ms) shifts the audio: word times move with it
    const shift = r.words![0]!.startMs - LEAD_S * 1000;
    expect(shift).toBeGreaterThanOrEqual(15);
    expect(shift).toBeLessThanOrEqual(60);
    // the provider remembers the fallback
    await p.synthesize({ segmentId: "CH1-S02", text, ttsWords: words, lang: "en", voice: el() }, path.join(dir, "out2.raw"), ctx.signal);
    expect(client.calls[2]!.body.outputFormat).toBe("mp3_44100_128");
  }, 60_000);

  it("free tier → non-commercial licence + attribution note; creator tier asks for MP3 directly", async () => {
    const ctx = makeCtx();
    const dir = tmpDir("el-free-");
    const mp3Src = path.join(dir, "a.wav");
    await import("node:fs/promises").then((fs) => fs.writeFile(mp3Src, pcmToWav(fakePcm("hello world"), SR)));
    await ffmpeg(["-i", mp3Src, "-c:a", "libmp3lame", path.join(dir, "a.mp3")], { config: ctx.config, signal: ctx.signal });
    const mp3 = await readFile(path.join(dir, "a.mp3"));
    const small = makeScript({ lang: "en", chapters: 1, segmentsPerChapter: 1 });
    const free = mockClient({ voices, tier: "free", mp3 });
    const t = await synthesizeTrack({ lang: "en", script: small, voice: el(), kind: "final", clipNarrated: [], segments: null, previous: null, projectDir: tmpDir("el-proj-"), styleCps: 16.5, retryBad: false, provider: provider(ctx, free), asr: null }, ctx);
    expect(free.calls[0]!.body.outputFormat).toBe("mp3_44100_128");
    expect(t.license).toMatchObject({ commercialOk: false, attributionRequired: true, restrictions: ["nc", "synthetic"] });
    expect(t.notes.join(" ")).toMatch(/free plan/);
    const caps = await provider(ctx, mockClient({ tier: "creator" })).capabilities();
    expect(caps).toMatchObject({ tier: "creator", stitching: true, nativeWordTimestamps: true, normalizesNumbers: true, maxCharsPerRequest: 10_000 });
    expect((await provider(ctx, mockClient()).capabilities("eleven_v3")).stitching).toBe(false);
  }, 60_000);

  it("eleven_v3: no stitching fields; languageCode is sent for non-multilingual_v2 models", async () => {
    const ctx = makeCtx();
    const client = mockClient({ voices });
    const p = provider(ctx, client);
    await p.synthesize({ segmentId: "CH1-S01", text: "Hello there.", ttsWords: ["Hello", "there."], lang: "en", voice: el({ modelId: "eleven_v3" }), previousRequestIds: ["a", "b"], previousText: "x", nextText: "y" }, path.join(tmpDir(), "o.raw"), ctx.signal);
    const b = client.calls[0]!.body;
    expect(b.previousRequestIds).toBeUndefined();
    expect(b.previousText).toBeUndefined();
    expect(b.nextText).toBeUndefined();
    expect(b.languageCode).toBe("en");
  });

  it("refuses cloned voices without consent and voices named after people of the story", async () => {
    const ctx = makeCtx();
    const cloned: ElevenVoice[] = [{ voiceId: "c1", name: "My Narrator", category: "cloned" }, { voiceId: "c2", name: "Johnny Depp clone", category: "professional" }];
    const base = { lang: "en" as const, script: makeScript({ chapters: 1, segmentsPerChapter: 1 }), kind: "final" as const, clipNarrated: [], segments: null, previous: null, projectDir: tmpDir("el-proj-"), styleCps: 16.5, retryBad: false, asr: null };
    await expect(synthesizeTrack({ ...base, voice: el({ voiceId: "c1" }), provider: provider(ctx, mockClient({ voices: cloned })) }, ctx))
      .rejects.toMatchObject({ code: "POLICY_DENIED", message: expect.stringContaining("consent") });
    const consent = { declaredAt: "2026-10-02T00:00:00.000Z", statement: "This is my own voice, cloned with my consent." };
    await expect(synthesizeTrack({ ...base, voice: el({ voiceId: "c2", cloneConsent: consent }), personNames: ["Johnny Depp", "Amber Heard"], provider: provider(ctx, mockClient({ voices: cloned })) }, ctx))
      .rejects.toMatchObject({ code: "POLICY_DENIED", message: expect.stringMatching(/person of the story/) });
    const ok = await synthesizeTrack({ ...base, voice: el({ voiceId: "c1", cloneConsent: consent }), personNames: ["Johnny Depp"], provider: provider(ctx, mockClient({ voices: cloned })) }, ctx);
    expect(ok.voiceId).toBe("c1");
    // premade voices are never blocked by name coincidences
    expect(() => assertVoiceAllowed({ id: "x", name: "Johnny", cloned: false }, { cloneConsent: null }, ["Johnny Depp"])).not.toThrow();
  }, 60_000);

  it("voiceId auto → first premade voice labelled with the language", async () => {
    const ctx = makeCtx();
    const client = mockClient();
    const info = await provider(ctx, client).resolveVoice("auto", "fr");
    expect(info).toMatchObject({ id: "fr1", name: "Claire", provider: "elevenlabs", cloned: false });
    expect((await provider(ctx, client).listVoices("en")).map((v) => v.id)).toEqual(["en1"]);
  });

  it("maps API errors; offline and missing key are explicit", async () => {
    const ctx = makeCtx();
    const p = provider(ctx, mockClient({ voices, fail: Object.assign(new Error("Too many requests"), { statusCode: 429 }) }));
    await expect(p.synthesize({ segmentId: "CH1-S01", text: "a", ttsWords: ["a"], lang: "en", voice: el() }, path.join(tmpDir(), "o"), ctx.signal))
      .rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT", retryable: true });
    const off = new ElevenLabsProvider({ apiKey: null, client: mockClient(), config: ctx.config, logger: silentLogger });
    expect((await off.isAvailable()).ok).toBe(false);
    const nokey = new ElevenLabsProvider({ apiKey: null, config: { ...ctx.config, offline: false }, logger: silentLogger });
    expect(await nokey.isAvailable()).toMatchObject({ ok: false, hint: expect.stringContaining("ELEVENLABS_API_KEY") });
    await expect(synthesizeTrack({ lang: "en", script, voice: el(), kind: "final", clipNarrated: [], segments: null, previous: null, projectDir: tmpDir(), styleCps: 16.5, retryBad: false, provider: nokey, asr: null }, ctx))
      .rejects.toMatchObject({ code: "CONFIG_MISSING_KEY" });
  });
});
