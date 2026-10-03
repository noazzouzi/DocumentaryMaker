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

// ---- relevance matching (ranking only): ordinals, centuries and decades share one spelling on both sides
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  premier: 1, deuxieme: 2, troisieme: 3, quatrieme: 4, cinquieme: 5, sixieme: 6, septieme: 7, huitieme: 8, neuvieme: 9, dixieme: 10,
  onzieme: 11, douzieme: 12, treizieme: 13, quatorzieme: 14, quinzieme: 15, seizieme: 16, "dix-septieme": 17, "dix-huitieme": 18,
  "dix-neuvieme": 19, vingtieme: 20,
};
const ROMAN: Record<string, number> = { xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21 };
const ordinal = (n: number) => `${n}th`;

/** Canonical spelling of an ordinal/century token ("seventeenth", "17e", "xviie", "1600s" → "17th"), else the token itself. */
export function canonToken(t: string): string {
  if (ORDINAL_WORDS[t] !== undefined) return ordinal(ORDINAL_WORDS[t]!);
  let m = /^(\d{1,2})(st|nd|rd|th|e|eme|ème|er|re)$/.exec(t);
  if (m) return ordinal(Number(m[1]));
  m = /^([xvi]+)(e|eme|ème)$/.exec(t);
  if (m && ROMAN[m[1]!] !== undefined) return ordinal(ROMAN[m[1]!]!);
  m = /^(1\d|20)00s$/.exec(t);
  if (m) return ordinal(Number(m[1]) + 1);
  return t;
}

/** Candidate-side match tokens: canonical tokens plus, for every year, its century ("1637" → "17th") and decade ("1630s"). */
export function matchTokens(text: string): string[] {
  const out = new Set<string>();
  for (const t of tokensOf(text)) {
    const c = canonToken(t);
    out.add(c);
    const y = /^c?(1[0-9]\d{2}|20\d{2})s?$/.exec(t);
    if (y) {
      const year = Number(y[1]);
      out.add(ordinal(Math.floor(year / 100) + 1));
      out.add(`${Math.floor(year / 10) * 10}s`);
      out.add(String(year));
    }
  }
  return [...out];
}

/** Query-side match tokens: content tokens (stopwords dropped) in canonical spelling. */
export function matchQueryTokens(text: string): string[] {
  return [...new Set(tokensOf(text).filter((t) => !STOP.has(t)).map(canonToken))];
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

/** Placeholder names Commons templates emit ({{Anonymous}}, {{Unknown|author}}, "Unidentified painter"…). */
const PLACEHOLDER_AUTHOR = /^(?:anonymous|anonyme|anonym|anoniem|unknown(?:\s+(?:author|artist|painter|photographer|engraver))?|unidentified(?:\s+\p{L}+)?|auteur inconnu|inconnu|unbekannt|onbekend)$/iu;

/**
 * A printable author for credit lines from free-form provider text (Commons "Artist" is often a whole wiki template):
 * the first name-like part (before " - ", " (", " | ", " // ", "©"…), no emoji, no "User:" prefix, a repeated name
 * collapsed ("Unknown artist Unknown artist", "Jan Steen, Jan Steen", "Anonymous Unknown author"), at most ~60 characters.
 * null when nothing usable is left.
 */
export function cleanAuthor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ").replace(/\s+/g, " ").trim();
  s = s.split(/\s+[-–—|]\s+|\s*\(|\s*©|\s*;\s+|\s*\/{2,}\s*|\s+\/\s+|,?\s+(?:cropped|edited|modified|retouched|derivative work)\s+by\s+/iu)[0] ?? "";
  s = s.replace(/^(?:by|par|von|door)\s+/i, "").replace(/\b(?:user|utilisateur|benutzer|gebruiker)\s*:\s*/giu, "").replace(/[\s,.:;·•-]+$/u, "").trim();
  // A repeated name, side by side or separated by a comma/ampersand/"and".
  const rep = /^(.+?)(?:\s*(?:,|&|\band\b|\bet\b|\bund\b|\ben\b)?\s+\1)+$/iu.exec(s);
  if (rep) s = rep[1]!;
  // Two placeholder templates in a row ("Anonymous Unknown author") → the first one.
  const words = s.split(" ");
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    if (PLACEHOLDER_AUTHOR.test(a) && PLACEHOLDER_AUTHOR.test(words.slice(k).join(" "))) {
      s = a;
      break;
    }
  }
  if (s.length > 60) {
    const cut = s.slice(0, 60);
    s = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}…`;
  }
  return s === "" ? null : s;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DocmakerError("CANCELED", "canceled");
}

/** A signal that never aborts (for helpers that require one). */
export const NEVER_ABORT: AbortSignal = new AbortController().signal;

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
