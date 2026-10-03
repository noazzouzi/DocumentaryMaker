// Small shared helpers (internal).
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DocmakerError, normWord } from "@docmaker/core";

export const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "tif", "tiff", "gif", "bmp", "avif", "heic"]);
export const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "ts", "mts", "ogv", "wmv", "flv"]);
export const AUDIO_EXTS = new Set(["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aif", "aiff", "wma"]);

export function extOf(file: string): string {
  return path.extname(file).slice(1).toLowerCase();
}

export function kindOfExt(ext: string): "image" | "video" | "audio" | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  return null;
}

export function mimeOfExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "mp4":
      return "video/mp4";
    case "wav":
      return "audio/wav";
    case "webp":
      return "image/webp";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

/** Extension from a MIME type (download responses). */
export function extOfMime(mime: string): string | null {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/tiff": "tif", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/mpeg": "mpg",
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/ogg": "ogg",
  };
  return map[m] ?? null;
}

export async function makeTmpDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `docmaker-${prefix}-`));
}

export async function rmrf(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
}

export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export const nowIso = (): string => new Date().toISOString();

/** normWord tokens of a text, ≥ minLen chars (punctuation-only tokens dropped). */
export function tokensOf(text: string, minLen = 2): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s/_|,;:()[\]{}"“”«»!?]+/u)) {
    const n = normWord(raw);
    if (n.length >= minLen) out.push(n);
  }
  return out;
}

const STOP = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "la", "le", "les", "de", "des", "du", "un", "une", "et", "ou", "en", "au", "aux", "sur", "dans", "par", "pour", "avec",
]);
/** Content tokens of a query (stopwords dropped). */
export function queryTokens(text: string): string[] {
  return [...new Set(tokensOf(text).filter((t) => !STOP.has(t)))];
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
export const clamp01 = (x: number): number => clamp(x, 0, 1);

/** Strip HTML tags and decode the common entities (Commons Artist/Credit fields). */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DocmakerError("CANCELED", "canceled");
}

/** A signal that never aborts (for helpers that require one). */
export const NEVER_ABORT: AbortSignal = new AbortController().signal;

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
