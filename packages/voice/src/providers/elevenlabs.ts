// ElevenLabs TTS with timestamps (§8.3; SDK @elevenlabs/elevenlabs-js 2.70.0). Port of $SP/tts/node/voice.ts.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Lang, Logger, RuntimeConfig, TtsCapabilities, TtsProvider, TtsRequest, TtsResult, VoiceInfo, VoiceSettings, WordTiming } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { readWav } from "@docmaker/core/node";
import { alignKey, alignScriptToTranscript, charAlignmentToWords } from "../align/nw";
import { soundBounds } from "../audio/silence";
import { voiceLicense } from "../license";
import { decodeTo48kMono } from "../post/chain";

// ---- the subset of the SDK we use (the real client satisfies it; tests pass a mock)
export interface ElevenAlignment { characters: string[]; characterStartTimesSeconds: number[]; characterEndTimesSeconds: number[] }
export interface ElevenTtsBody {
  text: string; modelId?: string; languageCode?: string; outputFormat?: string;
  voiceSettings?: { stability?: number; similarityBoost?: number; style?: number; useSpeakerBoost?: boolean; speed?: number };
  previousRequestIds?: string[]; previousText?: string; nextText?: string; seed?: number; applyTextNormalization?: "auto" | "on" | "off";
}
export interface ElevenVoice { voiceId: string; name?: string; category?: string; labels?: Record<string, string> }
export interface ElevenLabsLike {
  textToSpeech: {
    convertWithTimestamps(voiceId: string, body: ElevenTtsBody, opts?: { abortSignal?: AbortSignal; timeoutInSeconds?: number; maxRetries?: number }): {
      withRawResponse(): Promise<{ data: { audioBase64: string; alignment?: ElevenAlignment | null; normalizedAlignment?: ElevenAlignment | null }; rawResponse: { headers: { get(name: string): string | null } } }>;
    };
  };
  voices: {
    search(req?: { pageSize?: number; nextPageToken?: string }): Promise<{ voices: ElevenVoice[]; hasMore?: boolean; nextPageToken?: string }>;
    get(voiceId: string): Promise<ElevenVoice>;
  };
  user: { subscription: { get(): Promise<{ tier: string }> } };
  forcedAlignment?: { create(req: { file: unknown; text: string }): Promise<{ words: { text: string; start: number; end: number; loss: number }[] }> };
}

export const ELEVEN_DEFAULT_MODEL = "eleven_multilingual_v2";
export const ELEVEN_MODELS: Record<string, { maxChars: number; stitching: boolean; costPer1k: number }> = {
  eleven_multilingual_v2: { maxChars: 10_000, stitching: true, costPer1k: 0.08 },
  eleven_v3: { maxChars: 5_000, stitching: false, costPer1k: 0.08 },
  eleven_v4: { maxChars: 10_000, stitching: true, costPer1k: 0.08 },
  eleven_flash_v2_5: { maxChars: 40_000, stitching: true, costPer1k: 0.04 },
  eleven_turbo_v2_5: { maxChars: 40_000, stitching: true, costPer1k: 0.04 },
};
const modelInfo = (m: string) => ELEVEN_MODELS[m] ?? { maxChars: 5_000, stitching: true, costPer1k: 0.08 };
const PCM_TIERS = new Set(["pro", "scale", "business", "growing_business", "enterprise"]);
const CLONED_CATEGORIES = new Set(["cloned", "professional", "famous"]);
const PCM_FORMAT = "pcm_44100";
const MP3_FORMAT = "mp3_44100_128";
/** Request ids older than this cannot be used for stitching (API limit: 2 h). */
export const STITCH_MAX_AGE_MS = 2 * 3600_000 - 5 * 60_000;

/** s16le mono PCM → WAV bytes. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm, pcm.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** Tokens of person names/aliases (≥ 3 letters) used to refuse voices named after FactSheet people. */
export function personTokens(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) for (const t of n.split(/[\s\-_.,]+/u)) { const k = alignKey(t); if ([...k].length >= 3) out.add(k); }
  return out;
}

/** Throws POLICY_DENIED for a cloned voice without consent or a voice named after a FactSheet person. */
export function assertVoiceAllowed(v: Pick<VoiceInfo, "id" | "name" | "cloned">, settings: Pick<VoiceSettings, "cloneConsent">, personNames: readonly string[]): void {
  const persons = personTokens(personNames);
  const hit = v.name.split(/[\s\-_.,()]+/u).map(alignKey).find((t) => persons.has(t));
  if (hit && v.cloned) {
    throw new DocmakerError("POLICY_DENIED", `voice "${v.name}" matches a person of the story ("${hit}"): cloning people from the story is never allowed`, { hint: "choose another voice" });
  }
  if (v.cloned && !settings.cloneConsent) {
    throw new DocmakerError("POLICY_DENIED", `voice "${v.name}" is a cloned voice: a consent declaration is required`, { hint: "declare consent for this cloned voice in the voice settings (cloneConsent)" });
  }
}

function langMatches(label: string | undefined, lang: Lang): boolean {
  if (!label) return false;
  const l = label.toLowerCase();
  return l === lang || l.startsWith(`${lang}-`) || l.startsWith(`${lang}_`) || (lang === "en" ? l.startsWith("english") : l.startsWith("french") || l.startsWith("fran"));
}

function mapError(e: unknown, what: string): DocmakerError {
  const status = (e as { statusCode?: number }).statusCode;
  const msg = e instanceof Error ? e.message : String(e);
  if ((e as { name?: string }).name === "AbortError" || /abort/i.test(msg)) return new DocmakerError("CANCELED", `${what} canceled`);
  if (status === 401) return new DocmakerError("CONFIG_MISSING_KEY", `ElevenLabs rejected the API key (${what})`, { hint: "check ELEVENLABS_API_KEY", cause: e });
  if (status === 429) return new DocmakerError("PROVIDER_RATE_LIMIT", `ElevenLabs rate limit (${what})`, { retryable: true, cause: e });
  return new DocmakerError("PROVIDER_ERROR", `ElevenLabs ${what} failed${status ? ` (HTTP ${status})` : ""}: ${msg.slice(0, 300)}`, { retryable: status === undefined || status >= 500, cause: e });
}

export interface ElevenLabsProviderOptions {
  apiKey: string | null;
  config: RuntimeConfig;
  logger: Logger;
  client?: ElevenLabsLike;
}

export class ElevenLabsProvider implements TtsProvider {
  readonly id = "elevenlabs" as const;
  private client: ElevenLabsLike | null;
  private tier: string | null | undefined; // undefined = not fetched yet
  private format: string | null = null;
  private voiceCache = new Map<string, ElevenVoice>();

  constructor(private readonly o: ElevenLabsProviderOptions) {
    this.client = o.client ?? (o.apiKey ? (new ElevenLabsClient({ apiKey: o.apiKey }) as unknown as ElevenLabsLike) : null);
  }

  private need(): ElevenLabsLike {
    if (this.o.config.offline) throw new DocmakerError("OFFLINE", "ElevenLabs is unavailable offline");
    if (!this.client) throw new DocmakerError("CONFIG_MISSING_KEY", "ELEVENLABS_API_KEY is not set", { hint: "docmaker keys set elevenlabs" });
    return this.client;
  }

  async isAvailable() {
    if (!this.client) return { ok: false, hint: "set ELEVENLABS_API_KEY (docmaker keys set elevenlabs)" };
    if (this.o.config.offline) return { ok: false, hint: "offline mode: ElevenLabs needs the network" };
    return { ok: true, hint: null };
  }

  /** Subscription tier ("free", "creator", "pro", …); null when it cannot be read. */
  async getTier(): Promise<string | null> {
    if (this.tier !== undefined) return this.tier;
    try {
      this.tier = (await this.need().user.subscription.get()).tier?.toLowerCase() ?? null;
    } catch (e) {
      this.o.logger.warn("elevenlabs: could not read the subscription tier", { error: e instanceof Error ? e.message : String(e) });
      this.tier = null;
    }
    return this.tier;
  }

  async capabilities(modelId: string = ELEVEN_DEFAULT_MODEL): Promise<TtsCapabilities> {
    const m = modelInfo(modelId);
    return {
      languages: ["en", "fr"], nativeWordTimestamps: true, stitching: m.stitching, maxCharsPerRequest: m.maxChars, voiceCloning: true,
      normalizesNumbers: true, costPer1kCharsUsd: m.costPer1k, tier: this.client ? await this.getTier() : null,
    };
  }

  private toInfo(v: ElevenVoice, lang: Lang, tier: string | null): VoiceInfo {
    const g = (v.labels?.gender ?? "").toLowerCase();
    return {
      id: v.voiceId, name: v.name ?? v.voiceId, lang, gender: g === "male" || g === "female" ? g : "unknown", provider: "elevenlabs",
      license: voiceLicense("elevenlabs", v.voiceId, tier), cloned: CLONED_CATEGORIES.has((v.category ?? "").toLowerCase()),
    };
  }

  private async allVoices(): Promise<ElevenVoice[]> {
    const c = this.need();
    const out: ElevenVoice[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await c.voices.search({ pageSize: 100, ...(token ? { nextPageToken: token } : {}) }).catch((e) => { throw mapError(e, "voice search"); });
      out.push(...r.voices);
      if (!r.hasMore || !r.nextPageToken) break;
      token = r.nextPageToken;
    }
    for (const v of out) this.voiceCache.set(v.voiceId, v);
    return out;
  }

  async listVoices(lang?: Lang): Promise<VoiceInfo[]> {
    const tier = await this.getTier();
    const voices = await this.allVoices();
    return voices
      .filter((v) => !lang || !v.labels?.language || langMatches(v.labels.language, lang))
      .map((v) => this.toInfo(v, lang ?? (langMatches(v.labels?.language, "fr") ? "fr" : "en"), tier));
  }

  /** "auto" → first premade voice labelled with the language, else the first labelled narration, else the first premade. */
  async resolveVoice(voiceId: string, lang: Lang): Promise<VoiceInfo> {
    const tier = await this.getTier();
    if (voiceId === "auto" || voiceId === "") {
      const voices = await this.allVoices();
      const premade = voices.filter((v) => (v.category ?? "premade") === "premade");
      const pick = premade.find((v) => langMatches(v.labels?.language, lang))
        ?? voices.find((v) => /narrat/i.test(`${v.labels?.use_case ?? ""} ${v.labels?.usecase ?? ""} ${v.labels?.description ?? ""}`))
        ?? premade[0] ?? voices[0];
      if (!pick) throw new DocmakerError("PROVIDER_ERROR", "ElevenLabs returned no voices");
      return this.toInfo(pick, lang, tier);
    }
    let v = this.voiceCache.get(voiceId);
    if (!v) {
      v = await this.need().voices.get(voiceId).catch((e) => { throw mapError(e, `voice ${voiceId}`); });
      this.voiceCache.set(voiceId, v);
    }
    return this.toInfo(v, lang, tier);
  }

  private async chooseFormat(): Promise<string> {
    if (this.format) return this.format;
    const tier = await this.getTier();
    this.format = tier === null || PCM_TIERS.has(tier) ? PCM_FORMAT : MP3_FORMAT;
    return this.format;
  }

  async synthesize(req: TtsRequest, outPath: string, signal: AbortSignal): Promise<TtsResult> {
    const c = this.need();
    const modelId = req.voice.modelId ?? ELEVEN_DEFAULT_MODEL;
    const m = modelInfo(modelId);
    const ids = m.stitching ? (req.previousRequestIds ?? []).slice(-3) : [];
    const body = (outputFormat: string): ElevenTtsBody => ({
      text: req.text,
      modelId,
      ...(modelId === ELEVEN_DEFAULT_MODEL ? {} : { languageCode: req.lang }),
      outputFormat,
      voiceSettings: {
        stability: req.voice.stability, similarityBoost: req.voice.similarityBoost, style: req.voice.style, useSpeakerBoost: true,
        speed: Math.min(1.2, Math.max(0.7, req.voice.speed ?? 1)),
      },
      ...(ids.length ? { previousRequestIds: ids } : {}),
      ...(!ids.length && m.stitching && req.previousText ? { previousText: req.previousText } : {}),
      ...(m.stitching && req.nextText ? { nextText: req.nextText } : {}),
      ...(req.seed !== undefined ? { seed: req.seed >>> 0 } : {}),
      applyTextNormalization: "auto",
    });
    const call = (fmt: string) => c.textToSpeech.convertWithTimestamps(req.voice.voiceId, body(fmt), { abortSignal: signal, timeoutInSeconds: 300, maxRetries: 2 }).withRawResponse();
    let fmt = await this.chooseFormat();
    let res: Awaited<ReturnType<typeof call>>;
    try {
      res = await call(fmt);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      if (fmt === PCM_FORMAT && status >= 400 && status < 500 && status !== 401 && status !== 404 && status !== 429) {
        this.o.logger.warn("elevenlabs: pcm_44100 refused (tier); falling back to mp3_44100_128", { status });
        this.format = fmt = MP3_FORMAT;
        try {
          res = await call(fmt);
        } catch (e2) {
          throw mapError(e2, "text-to-speech");
        }
      } else {
        throw mapError(e, "text-to-speech");
      }
    }
    const bytes = Buffer.from(res.data.audioBase64, "base64");
    let words: WordTiming[] | null = null;
    const a = res.data.alignment;
    if (a && a.characters.length) {
      const raw = charAlignmentToWords(req.text, a.characters, a.characterStartTimesSeconds, a.characterEndTimesSeconds);
      words = raw.length === req.ttsWords.length ? raw : alignScriptToTranscript(req.ttsWords, raw).map(({ matched: _m, ...w }) => w);
    }
    let durationMs: number;
    if (fmt === PCM_FORMAT) {
      await writeFile(outPath, pcmToWav(bytes, 44100));
      durationMs = Math.round((bytes.length / 2 / 44100) * 1000);
    } else {
      await writeFile(outPath, bytes);
      const probe = await this.mp3Onset(outPath, signal);
      durationMs = probe.durationMs;
      // MP3 encoder priming delays the audio: shift words when the onset trails the first aligned char by 15–60 ms
      if (words && words.length && probe.onsetMs !== null) {
        const delta = probe.onsetMs - words[0]!.startMs;
        if (delta >= 15 && delta <= 60) words = words.map((w) => ({ ...w, startMs: w.startMs + delta, endMs: w.endMs + delta }));
      }
    }
    return {
      segmentId: req.segmentId, audioPath: outPath, durationMs, words, timingSource: "provider",
      providerRequestId: res.rawResponse.headers.get("request-id"), charsBilled: [...req.text].length,
    };
  }

  private async mp3Onset(file: string, signal: AbortSignal): Promise<{ onsetMs: number | null; durationMs: number }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "docmaker-el-"));
    try {
      const wavPath = path.join(dir, "d.wav");
      await decodeTo48kMono(file, wavPath, null, { config: this.o.config, signal });
      const w = await readWav(wavPath);
      const s = w.data[0]!;
      const b = soundBounds(s, -50);
      return { onsetMs: b ? Math.round((b.first * 1000) / w.sampleRate) : null, durationMs: Math.round((s.length * 1000) / w.sampleRate) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Paid forced alignment (M3, ≈ $0.22/h): exact script words on an existing recording. */
  async forcedAlign(audioPath: string, text: string): Promise<WordTiming[]> {
    const c = this.need();
    if (!c.forcedAlignment) throw new DocmakerError("TOOL_MISSING", "this ElevenLabs client has no forced alignment");
    const r = await c.forcedAlignment.create({ file: createReadStream(audioPath), text }).catch((e) => { throw mapError(e, "forced alignment"); });
    return r.words.filter((w) => w.text.trim() !== "").map((w) => ({
      text: w.text.trim(), startMs: Math.max(0, Math.round(w.start * 1000)), endMs: Math.max(0, Math.round(w.end * 1000)),
      confidence: Math.max(0, Math.min(1, 1 - w.loss)),
    }));
  }
}
