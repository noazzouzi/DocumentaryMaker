// whisper.cpp fallback ASR (§8.5, M3) through @remotion/install-whisper-cpp. Always `-nfa` (flash attention
// silently disables DTW timestamps), never splitOnWord. Word start = first-token t_dtw − 120 ms, end = last-token t_dtw.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Aligner, Lang, RuntimeConfig, WordTiming } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { ffmpeg } from "@docmaker/core/node";
import { alignScriptToTranscript } from "./nw";

export const WHISPER_CPP_VERSION = "1.8.2";
export const WHISPER_CPP_MODEL = "small" as const;
const DTW_LEAD_MS = 120;

export interface WhisperToken { text: string; t_dtw: number; p: number; offsets: { from: number; to: number } }
export interface WhisperItem { text: string; offsets: { from: number; to: number }; tokens: WhisperToken[] }

export function whisperCppDir(config: RuntimeConfig): string {
  return path.join(config.paths.models, "whisper", "cpp");
}
function executable(dir: string): string {
  return path.join(dir, "build", "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
}

/** whisper.cpp tokens → words: a token starting with a space opens a word; special and punctuation-only tokens are dropped. */
export function tokensToWords(items: readonly WhisperItem[]): WordTiming[] {
  const words: WordTiming[] = [];
  for (const item of items) {
    for (const tok of item.tokens) {
      const t = tok.text;
      if (!t.trim() || /^\s*\[_/.test(t) || /^\s*\[.*\]\s*$/.test(t)) continue;
      const at = tok.t_dtw >= 0 ? tok.t_dtw * 10 : tok.offsets.from;
      if (/^\s*[.,!?;:…»«"“”]+\s*$/u.test(t)) continue;
      const last = words[words.length - 1];
      if (!t.startsWith(" ") && last) {
        last.text += t;
        last.endMs = Math.max(last.endMs, at);
      } else {
        words.push({ text: t.trim(), startMs: Math.max(0, at - DTW_LEAD_MS), endMs: at, confidence: Math.max(0, Math.min(1, tok.p)) });
      }
    }
  }
  for (const w of words) if (w.endMs < w.startMs) w.endMs = w.startMs;
  return words;
}

type TranscribeFn = (o: Record<string, unknown>) => Promise<{ transcription: WhisperItem[] }>;

export class WhisperCppAligner implements Aligner {
  readonly id = "whisper-cpp" as const;
  constructor(private readonly config: RuntimeConfig, private readonly transcribeImpl?: TranscribeFn) {}

  async isAvailable() {
    const dir = whisperCppDir(this.config);
    const ok = existsSync(executable(dir)) && existsSync(path.join(dir, `ggml-${WHISPER_CPP_MODEL}.bin`));
    return ok ? { ok: true, hint: null } : { ok: false, hint: "run `docmaker setup --whisper` to build whisper.cpp 1.8.2 and download the small model" };
  }

  async transcribe(audioPath: string, lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[]> {
    const dir = whisperCppDir(this.config);
    const tmp = await mkdtemp(path.join(os.tmpdir(), "docmaker-wcpp-"));
    try {
      const wav16 = path.join(tmp, "in16k.wav"); // absolute 16 kHz mono s16 (the binary runs in another cwd)
      await ffmpeg(["-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav16], { config: this.config, signal });
      const impl = this.transcribeImpl ?? ((await import("@remotion/install-whisper-cpp")).transcribe as unknown as TranscribeFn);
      const args: string[] = ["-nfa"];
      if (namesPrompt) args.push("--prompt", namesPrompt);
      const out = await impl({
        inputPath: wav16, whisperPath: dir, whisperCppVersion: WHISPER_CPP_VERSION, model: WHISPER_CPP_MODEL, modelFolder: dir,
        tokenLevelTimestamps: true, additionalArgs: args, language: lang, printOutput: false, signal,
      }).catch((e: unknown) => {
        if (signal.aborted) throw new DocmakerError("CANCELED", "whisper.cpp canceled");
        throw new DocmakerError("INTERNAL", `whisper.cpp failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      });
      return tokensToWords(out.transcription);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async align(audioPath: string, ttsWords: string[], lang: Lang, signal: AbortSignal): Promise<WordTiming[]> {
    const asr = await this.transcribe(audioPath, lang, "", signal);
    return alignScriptToTranscript(ttsWords, asr).map(({ matched: _m, ...w }) => w);
  }
}

/** setup helper: builds whisper.cpp 1.8.2 and downloads the small model into <models>/whisper/cpp. */
export async function installWhisperCppRuntime(config: RuntimeConfig, signal: AbortSignal): Promise<string> {
  const { installWhisperCpp, downloadWhisperModel } = await import("@remotion/install-whisper-cpp");
  const dir = whisperCppDir(config);
  await installWhisperCpp({ to: dir, version: WHISPER_CPP_VERSION, printOutput: false, signal });
  await downloadWhisperModel({ model: WHISPER_CPP_MODEL, folder: dir, printOutput: false, signal });
  return dir;
}
