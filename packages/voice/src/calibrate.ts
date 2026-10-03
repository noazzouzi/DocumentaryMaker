// calibrateVoice (§8.7): speak a fixed ≈ 600-char paragraph, measure speech-only time (pauses ≥ 250 ms excluded)
// → charsPerSec. The engine stores it in project.voice[lang].charsPerSec; results are cached per voice settings.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Lang, VoiceSettings } from "@docmaker/core";
import { DocmakerError, fnv1a32 } from "@docmaker/core";
import { readWav } from "@docmaker/core/node";
import { detectRmsSilences, soundBounds } from "./audio/silence";
import { voiceSettingsHash } from "./hash";
import { decodeTo48kMono } from "./post/chain";
import { ElevenLabsProvider, ELEVEN_DEFAULT_MODEL } from "./providers/elevenlabs";
import { createTtsProvider } from "./providers/registry";
import { SherpaProvider } from "./providers/sherpa";
import { DEFAULT_CPS } from "./providers/synthetic";
import { CALIBRATION_TEXT } from "./text/calibration";
import { buildTtsText } from "./text/tts-text";
import { textOptionsFor } from "./track";
import type { VoiceCtx } from "./types";

export const MIN_PAUSE_MS = 250;

/** Speech-only duration: first→last sound minus every internal pause ≥ 250 ms (−45 dB RMS). */
export function speechOnlyMs(samples: Float32Array, sampleRate: number): number {
  const b = soundBounds(samples, -45);
  if (!b) return 0;
  const a = (b.first * 1000) / sampleRate, z = ((b.last + 1) * 1000) / sampleRate;
  const pauses = detectRmsSilences(samples, sampleRate, { thresholdDb: -45, minMs: MIN_PAUSE_MS })
    .map((p) => Math.max(0, Math.min(z, p.endMs) - Math.max(a, p.startMs)));
  return Math.max(0, z - a - pauses.reduce((x, y) => x + y, 0));
}

export async function calibrateVoice(i: { lang: Lang; voice: VoiceSettings; projectDir: string }, ctx: VoiceCtx): Promise<{ charsPerSec: number }> {
  if (i.voice.provider === "recording") {
    throw new DocmakerError("VALIDATION", "a recording voice is calibrated from your own recording, not synthesised");
  }
  const provider = createTtsProvider(i.voice.provider, ctx);
  const avail = await provider.isAvailable();
  if (!avail.ok) throw new DocmakerError(i.voice.provider === "elevenlabs" ? "CONFIG_MISSING_KEY" : "TOOL_MISSING", `voice provider ${i.voice.provider} is not available`, { hint: avail.hint ?? undefined });
  let voice: VoiceSettings = { ...i.voice, charsPerSec: i.voice.provider === "synthetic" ? (i.voice.charsPerSec ?? DEFAULT_CPS[i.lang]) : null };
  if (provider instanceof ElevenLabsProvider) voice = { ...voice, voiceId: (await provider.resolveVoice(voice.voiceId, i.lang)).id, modelId: voice.modelId ?? ELEVEN_DEFAULT_MODEL };
  if (provider instanceof SherpaProvider) voice = { ...voice, voiceId: provider.resolve(voice.voiceId, i.lang).id };
  const dir = path.join(i.projectDir, `voice/${i.lang}/.calibration`);
  await mkdir(dir, { recursive: true });
  const key = voiceSettingsHash(voice).slice(0, 16);
  const cacheFile = path.join(dir, `${key}.json`);
  if (existsSync(cacheFile)) {
    try {
      const c = JSON.parse(await readFile(cacheFile, "utf8")) as { charsPerSec: number };
      if (c.charsPerSec > 0) return { charsPerSec: c.charsPerSec };
    } catch { /* recompute */ }
  }
  const text = CALIBRATION_TEXT[i.lang];
  const caps = provider instanceof ElevenLabsProvider ? await provider.capabilities(voice.modelId ?? ELEVEN_DEFAULT_MODEL) : await provider.capabilities();
  const tts = buildTtsText(text, i.lang, textOptionsFor(voice, caps));
  const raw = path.join(dir, `${key}.raw`);
  const wav = path.join(dir, `${key}.wav`);
  try {
    ctx.progress(0.1, `calibrating ${voice.provider} ${voice.voiceId}`);
    const r = await provider.synthesize({ segmentId: "CH1-S01", text: tts.ttsText, ttsWords: tts.ttsWords, lang: i.lang, voice, seed: fnv1a32("calibration") }, raw, ctx.signal);
    if (r.charsBilled > 0 && caps.costPer1kCharsUsd > 0) {
      await ctx.costs.record({
        fingerprint: voiceSettingsHash(voice), provider: voice.provider, endpoint: "text-to-speech/calibration", model: voice.modelId, stage: "voice", lang: i.lang,
        usage: { characters: r.charsBilled }, costUsd: Math.round((r.charsBilled / 1000) * caps.costPer1kCharsUsd * 1e6) / 1e6, outputRef: null,
      });
      ctx.costs.assertWithinBudget("voice", i.lang);
    }
    await decodeTo48kMono(r.audioPath, wav, null, ctx);
    const w = await readWav(wav);
    const ms = speechOnlyMs(w.data[0]!, w.sampleRate);
    if (ms <= 0) throw new DocmakerError("PROVIDER_ERROR", "calibration produced silence");
    const charsPerSec = Math.round(([...text].length / (ms / 1000)) * 100) / 100;
    await writeFile(cacheFile, JSON.stringify({ charsPerSec, speechMs: Math.round(ms), chars: [...text].length, provider: voice.provider, voiceId: voice.voiceId }));
    ctx.progress(1, `calibrated: ${charsPerSec} chars/s`);
    return { charsPerSec };
  } finally {
    await rm(raw, { force: true });
    await rm(wav, { force: true });
  }
}
