// synthesizeTrack(): voiced segments → SegmentTake[] (§8.4, §8.9): segment cache, sequential stitching per chapter,
// post chain, aligner fallback, ASR QA, deterministic take id. Writes WAVs only under projectDir.
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Aligner, CostLine, Lang, Script, SegmentTake, TimingSource, TtsCapabilities, TtsProvider, TtsRequest, VoiceInfo, VoiceSettings, VoiceTrack, WordTiming,
} from "@docmaker/core";
import { DocmakerError, P, VoiceTrack as VoiceTrackSchema, fnv1a32, hashJson } from "@docmaker/core";
import { readWav, sha256File, writeWav } from "@docmaker/core/node";
import { EstimatedAligner } from "./align/estimated";
import { shiftTimings, toTimedWords } from "./align/map";
import { alignScriptToTranscript, wordErrorRate } from "./align/nw";
import { segmentCacheKey, takeIdFor, voiceSettingsHash } from "./hash";
import { voiceLicense } from "./license";
import { decodeTo48kMono, runPostChain } from "./post/chain";
import { ELEVEN_DEFAULT_MODEL, ELEVEN_MODELS, ElevenLabsProvider, STITCH_MAX_AGE_MS, assertVoiceAllowed } from "./providers/elevenlabs";
import { firstAsrAligner } from "./providers/registry";
import { createTtsProvider } from "./providers/registry";
import { SherpaProvider } from "./providers/sherpa";
import { DEFAULT_CPS, SYNTHETIC_VOICES } from "./providers/synthetic";
import { voicedItems, type VoicedItem } from "./segments";
import { chunkAtSentences } from "./text/sentences";
import type { TtsTextOptions } from "./text/tts-text";
import type { SynthesizeTrackInput, VoiceCtx } from "./types";

const META_VERSION = 1;
/** QA thresholds: EN word-exact after normalisation (≤ 5 % WER tolerance for names), FR similarity ≥ 0.92. */
export const QA_MAX_WER: Record<Lang, number> = { en: 0.05, fr: 0.08 };

export interface SegMeta {
  v: number; cacheKey: string; ttsText: string; durationMs: number; leadTrimMs: number; sha256: string;
  words: WordTiming[]; timingSource: TimingSource; providerRequestId: string | null; requestAt: string | null;
  charsBilled: number; asrWer: number | null;
}

export const segCacheDir = (projectDir: string, lang: Lang) => path.join(projectDir, `voice/${lang}/.segcache`);

async function readMeta(file: string): Promise<SegMeta | null> {
  try {
    const m = JSON.parse(await readFile(file, "utf8")) as SegMeta;
    return m.v === META_VERSION ? m : null;
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** Hard-links (or copies) a file, replacing the destination. */
export async function placeFile(src: string, dest: string): Promise<void> {
  if (path.resolve(src) === path.resolve(dest)) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await rm(dest, { force: true });
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

/** Text options used when voice has to build a tts text itself (clip-narrated segments, empty ttsText). */
export function textOptionsFor(voice: VoiceSettings, caps: Pick<TtsCapabilities, "normalizesNumbers">): TtsTextOptions {
  const tagsSupported = voice.provider === "elevenlabs" && /^eleven_v[34]/.test(voice.modelId ?? "");
  return { lexicon: voice.lexicon ?? [], expandNumbers: !caps.normalizesNumbers, stripTags: !tagsSupported };
}

interface Resolved { voice: VoiceSettings; info: VoiceInfo | null }

async function resolveVoice(provider: TtsProvider, voice: VoiceSettings, lang: Lang, personNames: string[]): Promise<Resolved> {
  if (provider instanceof ElevenLabsProvider) {
    const info = await provider.resolveVoice(voice.voiceId, lang);
    assertVoiceAllowed(info, voice, personNames);
    return { voice: { ...voice, voiceId: info.id, modelId: voice.modelId ?? ELEVEN_DEFAULT_MODEL }, info };
  }
  if (provider instanceof SherpaProvider) {
    const r = provider.resolve(voice.voiceId, lang);
    return { voice: { ...voice, voiceId: r.id, modelId: null }, info: null };
  }
  if (provider.id === "synthetic") {
    const known = SYNTHETIC_VOICES.some((v) => v.id === voice.voiceId);
    return { voice: { ...voice, voiceId: known ? voice.voiceId : "synthetic-m1", modelId: null }, info: null };
  }
  return { voice, info: null };
}

async function capsFor(provider: TtsProvider, voice: VoiceSettings): Promise<TtsCapabilities> {
  if (provider instanceof ElevenLabsProvider) return provider.capabilities(voice.modelId ?? ELEVEN_DEFAULT_MODEL);
  return provider.capabilities();
}

interface RawSynth { path: string; words: WordTiming[] | null; source: TimingSource; requestIds: string[]; charsBilled: number }

/** One provider call, or several sentence-aligned chunks concatenated when the text exceeds maxCharsPerRequest. */
async function synthesizeRaw(provider: TtsProvider, caps: TtsCapabilities, req: TtsRequest, dir: string, ctx: VoiceCtx): Promise<RawSynth> {
  const chunks = req.text.length > caps.maxCharsPerRequest ? chunkAtSentences(req.ttsWords, caps.maxCharsPerRequest) : [[0, req.ttsWords.length] as [number, number]];
  if (chunks.length === 1) {
    const out = path.join(dir, `${req.segmentId}.raw`);
    const r = await provider.synthesize(req, out, ctx.signal);
    return { path: r.audioPath, words: r.words, source: r.timingSource, requestIds: r.providerRequestId ? [r.providerRequestId] : [], charsBilled: r.charsBilled };
  }
  const parts: Float32Array[] = [];
  const words: WordTiming[] = [];
  let allTimed = true;
  let offsetMs = 0;
  const ids = [...(req.previousRequestIds ?? [])];
  const own: string[] = [];
  let billed = 0;
  let source: TimingSource = "provider";
  for (const [k, [a, b]] of chunks.entries()) {
    const sub: TtsRequest = {
      ...req, segmentId: req.segmentId, text: req.ttsWords.slice(a, b).join(" "), ttsWords: req.ttsWords.slice(a, b),
      previousText: k === 0 ? req.previousText : req.ttsWords.slice(0, a).join(" "),
      nextText: k === chunks.length - 1 ? req.nextText : req.ttsWords.slice(b).join(" "),
      previousRequestIds: ids.slice(-3),
    };
    const rawPath = path.join(dir, `${req.segmentId}.part${k}.raw`);
    const r = await provider.synthesize(sub, rawPath, ctx.signal);
    source = r.timingSource;
    billed += r.charsBilled;
    if (r.providerRequestId) { ids.push(r.providerRequestId); own.push(r.providerRequestId); }
    const dec = path.join(dir, `${req.segmentId}.part${k}.wav`);
    await decodeTo48kMono(r.audioPath, dec, null, { config: ctx.config, signal: ctx.signal });
    const w = await readWav(dec);
    const s = w.data[0]!;
    parts.push(s);
    if (r.words) words.push(...r.words.map((x) => ({ ...x, startMs: x.startMs + offsetMs, endMs: x.endMs + offsetMs })));
    else allTimed = false;
    offsetMs += (s.length * 1000) / w.sampleRate;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Float32Array(total);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; }
  const joined = path.join(dir, `${req.segmentId}.joined.wav`);
  await writeWav(joined, { sampleRate: 48000, channels: 1, data: [all] }, "f32");
  return { path: joined, words: allTimed ? words : null, source, requestIds: own, charsBilled: billed };
}

interface Built { take: Omit<SegmentTake, "file">; src: string; requestId: string | null; requestAt: string | null }

export async function synthesizeTrack(i: SynthesizeTrackInput, ctx: VoiceCtx): Promise<VoiceTrack> {
  const { lang, projectDir } = i;
  if (i.voice.provider === "recording") {
    throw new DocmakerError("VALIDATION", "recording takes are created with importRecording()", { hint: "docmaker voice import <files>" });
  }
  const baseVoice: VoiceSettings = i.kind === "scratch" && i.voice.provider !== "synthetic"
    ? { ...i.voice, provider: "synthetic", voiceId: "synthetic-m1", modelId: null }
    : i.voice;
  const provider = i.provider && i.provider.id === baseVoice.provider ? i.provider : createTtsProvider(baseVoice.provider, ctx);
  const avail = await provider.isAvailable();
  if (!avail.ok) {
    throw new DocmakerError(baseVoice.provider === "elevenlabs" ? "CONFIG_MISSING_KEY" : "TOOL_MISSING", `voice provider ${baseVoice.provider} is not available`, { hint: avail.hint ?? undefined });
  }
  const cps = baseVoice.charsPerSec ?? (i.styleCps > 0 ? i.styleCps : DEFAULT_CPS[lang]);
  const resolved = await resolveVoice(provider, { ...baseVoice, charsPerSec: baseVoice.provider === "synthetic" ? cps : baseVoice.charsPerSec }, lang, i.personNames ?? []);
  const voice = resolved.voice;
  const caps = await capsFor(provider, voice);
  const settingsHash = voiceSettingsHash(voice);
  const items = voicedItems(i.script, { lang, clipNarrated: i.clipNarrated, textOptions: textOptionsFor(voice, caps) });
  const targets = i.segments ? new Set(i.segments) : null;
  const prevById = new Map((i.previous?.segments ?? []).map((s) => [s.segmentId, s]));
  const cacheDir = segCacheDir(projectDir, lang);
  await mkdir(cacheDir, { recursive: true });
  const tmpRoot = path.join(projectDir, `voice/${lang}/.tmp`);
  await mkdir(tmpRoot, { recursive: true });
  const tmp = await mkdtemp(path.join(tmpRoot, "synth-"));
  const notes: string[] = [];
  const asr = i.asr !== undefined ? i.asr : provider.id === "synthetic" ? null : await firstAsrAligner(ctx).catch(() => null);
  const fallbackAligner: Aligner = asr ?? new EstimatedAligner(ctx.config);
  const built = new Map<string, Built>();
  let charsBilled = 0;
  const stitching = caps.stitching;
  const modelId = voice.modelId ?? (voice.provider === "elevenlabs" ? ELEVEN_DEFAULT_MODEL : null);
  const qaFailed: string[] = [];

  try {
    const byChapter = new Map<string, VoicedItem[]>();
    for (const it of items) byChapter.set(it.chapterId, [...(byChapter.get(it.chapterId) ?? []), it]);
    let done = 0;
    for (const [, chItems] of byChapter) {
      const chainIds: { id: string; at: string | null }[] = [];
      for (const [k, it] of chItems.entries()) {
        if (ctx.signal.aborted) throw new DocmakerError("CANCELED", "voice synthesis canceled");
        const id = it.seg.id;
        const prev = prevById.get(id);
        // reuse segments that were not asked for
        if (targets && !targets.has(id) && prev && existsSync(path.join(projectDir, prev.file))) {
          built.set(id, { take: { ...prev, pickup: prev.pickup ?? false }, src: path.join(projectDir, prev.file), requestId: prev.providerRequestId, requestAt: null });
          if (prev.providerRequestId) chainIds.push({ id: prev.providerRequestId, at: null });
          done++;
          continue;
        }
        const ttsTextHash = hashJson(it.ttsText);
        const keyFor = (ctxKey: string) => segmentCacheKey({ provider: voice.provider, voiceId: voice.voiceId, modelId, settingsHash, ttsTextHash, contextKey: ctxKey });
        // an explicit re-synthesis of an unchanged segment gets the next variant (a new rendition)
        let variant = 0;
        if (targets?.has(id) && prev) {
          for (let v = 0; v < 16; v++) if (keyFor(v ? `v${v}` : "") === prev.cacheKey) { variant = v + 1; break; }
        }
        const synthOnce = async (retry: number): Promise<{ meta: SegMeta; fresh: boolean }> => {
          const ctxKey = [variant ? `v${variant}` : "", retry ? `r${retry}` : ""].filter(Boolean).join(",");
          const cacheKey = keyFor(ctxKey);
          const wavPath = path.join(cacheDir, `${cacheKey}.wav`);
          const metaPath = path.join(cacheDir, `${cacheKey}.json`);
          const cached = await readMeta(metaPath);
          if (cached && existsSync(wavPath) && (await sha256File(wavPath)) === cached.sha256) return { meta: cached, fresh: false };
          const now = Date.now();
          const freshIds = chainIds.filter((x) => x.at !== null && now - Date.parse(x.at) < STITCH_MAX_AGE_MS).map((x) => x.id);
          const req: TtsRequest = {
            segmentId: id, text: it.ttsText, ttsWords: it.ttsWords, lang, voice,
            previousText: k > 0 ? chItems[k - 1]!.ttsText : undefined,
            nextText: k + 1 < chItems.length ? chItems[k + 1]!.ttsText : undefined,
            previousRequestIds: stitching ? freshIds.slice(-3) : undefined,
            seed: fnv1a32(`${voice.voiceId}|${id}|${variant}|${retry}`),
          };
          const raw = await synthesizeRaw(provider, caps, req, tmp, ctx);
          const outTmp = path.join(tmp, `${id}.post.wav`);
          const post = await runPostChain(raw.path, outTmp, { kind: "tts", rawFormat: null }, ctx);
          let words: WordTiming[];
          let source = raw.source;
          let asrWer: number | null = null;
          if (asr && provider.id !== "synthetic") {
            // round-trip ASR: QA for every provider, word timings for providers without native timestamps
            const heard = await asr.transcribe(outTmp, lang, "", ctx.signal);
            asrWer = wordErrorRate(it.ttsWords, heard.map((w) => w.text));
            if (!raw.words || raw.source === "estimated") {
              words = alignScriptToTranscript(it.ttsWords, heard).map(({ matched: _m, ...w }) => w);
              source = "aligned";
            } else {
              words = shiftTimings(raw.words, post.leadTrimMs, post.durationMs);
            }
          } else if (raw.words) {
            words = shiftTimings(raw.words, post.leadTrimMs, post.durationMs);
          } else {
            words = await fallbackAligner.align(outTmp, it.ttsWords, lang, ctx.signal);
            source = fallbackAligner.id === "estimated" ? "estimated" : "aligned";
          }
          const sha = await sha256File(outTmp);
          await rename(outTmp, wavPath);
          const meta: SegMeta = {
            v: META_VERSION, cacheKey, ttsText: it.ttsText, durationMs: post.durationMs, leadTrimMs: post.leadTrimMs, sha256: sha, words,
            timingSource: source, providerRequestId: raw.requestIds[raw.requestIds.length - 1] ?? null, requestAt: raw.requestIds.length ? new Date().toISOString() : null,
            charsBilled: raw.charsBilled, asrWer,
          };
          await writeAtomic(metaPath, JSON.stringify(meta));
          if (raw.charsBilled > 0 && caps.costPer1kCharsUsd > 0) {
            const costUsd = Math.round(((raw.charsBilled / 1000) * caps.costPer1kCharsUsd) * 1e6) / 1e6;
            await ctx.costs.record({
              fingerprint: cacheKey, provider: voice.provider, endpoint: "text-to-speech/with-timestamps", model: modelId, stage: "voice", lang,
              usage: { characters: raw.charsBilled }, costUsd, outputRef: path.relative(projectDir, wavPath).split(path.sep).join("/"),
            });
            ctx.costs.assertWithinBudget("voice", lang);
          }
          return { meta, fresh: true };
        };
        let { meta, fresh } = await synthOnce(0);
        if (fresh) charsBilled += meta.charsBilled;
        if (meta.asrWer !== null && meta.asrWer > QA_MAX_WER[lang]) {
          if (i.retryBad) {
            const second = await synthOnce(1);
            if (second.fresh) charsBilled += second.meta.charsBilled;
            if ((second.meta.asrWer ?? 1) < meta.asrWer) meta = second.meta;
            fresh = true;
          }
          if ((meta.asrWer ?? 0) > QA_MAX_WER[lang]) qaFailed.push(`${id} (WER ${meta.asrWer!.toFixed(2)})`);
        }
        const take: Omit<SegmentTake, "file"> = {
          segmentId: id, mode: it.mode, sha256: meta.sha256, durationMs: meta.durationMs, ttsText: it.ttsText, ttsTextHash,
          cacheKey: meta.cacheKey, leadTrimMs: meta.leadTrimMs,
          words: toTimedWords({ segmentId: id, display: it.display, displayToTts: it.displayToTts, tts: meta.words, source: meta.timingSource, durationMs: meta.durationMs }),
          providerRequestId: meta.providerRequestId, asrWer: meta.asrWer, pickup: false,
        };
        built.set(id, { take, src: path.join(cacheDir, `${meta.cacheKey}.wav`), requestId: meta.providerRequestId, requestAt: meta.requestAt });
        if (meta.providerRequestId) chainIds.push({ id: meta.providerRequestId, at: meta.requestAt });
        done++;
        ctx.progress(done / Math.max(1, items.length), `voice ${lang}: ${id}`, { segmentId: id, cached: !fresh });
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const segs = items.map((it) => built.get(it.seg.id)!).filter(Boolean);
  const takeId = takeIdFor(i.kind, voice.provider, voice.voiceId, settingsHash, segs.map((s) => s.take.cacheKey));
  const segments: SegmentTake[] = [];
  for (const s of segs) {
    const rel = P.takeSegment(lang, takeId, s.take.segmentId);
    await placeFile(s.src, path.join(projectDir, rel));
    segments.push({ ...s.take, file: rel });
  }
  if (caps.tier === "free") notes.push("ElevenLabs free plan: non-commercial use only, attribution required (see credits)");
  if (provider.id === "synthetic") notes.push("SYNTHETIC VOICE: placeholder narration generated offline");
  if (qaFailed.length) notes.push(`ASR QA failed for ${qaFailed.length} segment(s): ${qaFailed.join(", ")}${i.retryBad ? "" : " — re-run with --retry-bad"}`);
  return finalizeTrack({
    id: takeId, kind: i.kind, lang, provider: voice.provider, voiceId: voice.voiceId, modelId, settingsHash,
    license: resolved.info?.license && voice.provider !== "elevenlabs" ? resolved.info.license : voiceLicense(voice.provider, voice.voiceId, caps.tier),
    segments, missingSegmentIds: [], charsBilled,
    costUsd: Math.round((charsBilled / 1000) * caps.costPer1kCharsUsd * 1e6) / 1e6, notes,
  });
}

/** Fills timing summary + createdAt and validates against the schema. */
export function finalizeTrack(t: Omit<VoiceTrack, "schemaVersion" | "createdAt" | "timing">): VoiceTrack {
  const counts = new Map<TimingSource, number>();
  const confs: number[] = [];
  for (const s of t.segments) for (const w of s.words) {
    counts.set(w.source, (counts.get(w.source) ?? 0) + 1);
    if (w.confidence !== null) confs.push(w.confidence);
  }
  const source = [...counts.entries()].filter(([s]) => s !== "interpolated").sort((a, b) => b[1] - a[1])[0]?.[0] ?? (t.provider === "synthetic" ? "synthetic" : "estimated");
  return VoiceTrackSchema.parse({
    schemaVersion: 1, createdAt: new Date().toISOString(), ...t,
    timing: { source, meanConfidence: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000 : null },
  });
}

/** Paid characters of a (re)synthesis; free providers → []. */
export function estimateTtsCost(i: { script: Script; voice: VoiceSettings; segments: string[] | null; previous: VoiceTrack | null }): CostLine[] {
  if (i.voice.provider !== "elevenlabs") return [];
  const model = i.voice.modelId ?? ELEVEN_DEFAULT_MODEL;
  const price = ELEVEN_MODELS[model]?.costPer1k ?? 0.08;
  const targets = i.segments ? new Set(i.segments) : null;
  const sameVoice = i.previous && i.previous.provider === i.voice.provider && i.previous.settingsHash === voiceSettingsHash({ ...i.voice, modelId: model });
  const prev = new Map((i.previous?.segments ?? []).map((s) => [s.segmentId, s]));
  const items = voicedItems(i.script, { lang: i.script.lang, clipNarrated: [], textOptions: { lexicon: i.voice.lexicon ?? [], expandNumbers: false, stripTags: true } });
  let chars = 0;
  for (const it of items) {
    if (targets && !targets.has(it.seg.id)) continue;
    const p = prev.get(it.seg.id);
    if (!targets && sameVoice && p && p.ttsTextHash === hashJson(it.ttsText)) continue; // segment cache hit
    chars += [...it.ttsText].length;
  }
  if (chars === 0) return [];
  return [{
    label: `ElevenLabs ${model} (${i.script.lang})`, provider: "elevenlabs", unit: "characters", quantity: chars,
    unitPriceUsd: price / 1000, totalUsd: Math.round(chars * (price / 1000) * 1e6) / 1e6,
  }];
}
