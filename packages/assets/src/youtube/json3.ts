// YouTube subtitle parsing: json3 (word offsets for ASR), WebVTT fallback, and subtitle-track selection (§7.7).
import type { WordTiming } from "@docmaker/core";

interface Json3Seg { utf8?: string; tOffsetMs?: number; acAsrConf?: number }
interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] }

const ANNOTATION = /^\[[^\]]*\]$/; // [Music], [Applause]

function splitByChars(text: string, startMs: number, endMs: number, confidence: number | null): WordTiming[] {
  const words = text.split(/\s+/u).filter((w) => w !== "" && !ANNOTATION.test(w) && /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return [];
  const total = words.reduce((s, w) => s + [...w].length, 0) || 1;
  const span = Math.max(0, endMs - startMs);
  const out: WordTiming[] = [];
  let acc = 0;
  for (const w of words) {
    const s = startMs + Math.round((span * acc) / total);
    acc += [...w].length;
    const e = startMs + Math.round((span * acc) / total);
    out.push({ text: w, startMs: s, endMs: Math.max(s, e), confidence });
  }
  return out;
}

/**
 * json3 → words. Events with `segs`: start = tStartMs + (tOffsetMs ?? 0); end = next seg start or tStartMs + dDurationMs.
 * Segments holding several words (manual subtitles) split their span by characters. Empty and "\n" segs are dropped.
 */
export function parseJson3(json: unknown): WordTiming[] {
  const events = ((json as { events?: Json3Event[] } | null)?.events ?? []).filter((e) => Array.isArray(e.segs) && e.segs.length > 0);
  const out: WordTiming[] = [];
  for (const ev of events) {
    const t0 = Math.max(0, Math.round(ev.tStartMs ?? 0));
    const evEnd = t0 + Math.max(0, Math.round(ev.dDurationMs ?? 0));
    const segs = (ev.segs ?? []).filter((s) => typeof s.utf8 === "string" && s.utf8.trim() !== "" && s.utf8 !== "\n");
    segs.forEach((seg, k) => {
      const start = t0 + Math.max(0, Math.round(seg.tOffsetMs ?? 0));
      const next = segs[k + 1];
      let end = next ? t0 + Math.max(0, Math.round(next.tOffsetMs ?? 0)) : evEnd;
      if (end <= start) end = next ? start : Math.max(start, evEnd);
      // acAsrConf is 0..255; YouTube emits 0 when it has no estimate, so 0 means unknown.
      const conf = typeof seg.acAsrConf === "number" && seg.acAsrConf > 0 ? Math.min(1, seg.acAsrConf / 255) : null;
      out.push(...splitByChars(seg.utf8!.replace(/\n/g, " ").trim(), start, end, conf));
    });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  // Overlapping ASR events: a word never ends after the next word starts.
  for (let i = 0; i < out.length - 1; i++) {
    const nxt = out[i + 1]!.startMs;
    if (out[i]!.endMs > nxt && nxt >= out[i]!.startMs) out[i]!.endMs = nxt;
  }
  return out;
}

const vttTime = (s: string): number => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/.exec(s);
  if (!m) return NaN;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]);
};

const decodeEntities = (s: string) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");

/**
 * WebVTT → words. Inline <hh:mm:ss.mmm> karaoke tags (auto captions) give word starts; plain cues are split by characters
 * over [cue start, min(cue end, next cue start)] so roll-up captions with overlapping cues stay in reading order.
 */
export function parseVtt(text: string): WordTiming[] {
  const cues: { cs: number; ce: number; lines: string[] }[] = [];
  for (const b of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = b.split("\n");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, z] = lines[ti]!.split("-->");
    const cs = vttTime(a!);
    const ce = vttTime(z!);
    if (!Number.isFinite(cs) || !Number.isFinite(ce)) continue;
    cues.push({ cs, ce, lines: lines.slice(ti + 1) });
  }
  const TAG = /<\d{1,2}:\d{2}/;
  // Karaoke-style auto captions repeat the previous line (untagged) in every cue: only tagged lines carry new words.
  const karaoke = cues.some((c) => c.lines.some((l) => TAG.test(l)));
  const out: WordTiming[] = [];
  cues.forEach((cue, k) => {
    let c = cue;
    if (karaoke) {
      const tagged = c.lines.filter((l) => TAG.test(l));
      if (tagged.length === 0) return;
      c = { ...c, lines: tagged };
    }
    const body = c.lines.join(" ");
    if (TAG.test(body)) {
      // "word<00:00:01.200><c> next</c>…": each tag starts the following word.
      const parts = body.split(/<(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})>/);
      let t = c.cs;
      for (let j = 0; j < parts.length; j += 2) {
        const txt = decodeEntities(parts[j]!.replace(/<[^>]+>/g, "")).trim();
        const nextT = j + 1 < parts.length ? vttTime(parts[j + 1]!) : c.ce;
        if (txt) out.push(...splitByChars(txt, t, Number.isFinite(nextT) ? nextT : c.ce, null));
        if (Number.isFinite(nextT)) t = nextT;
      }
      return;
    }
    const txt = decodeEntities(body.replace(/<[^>]+>/g, "")).trim();
    if (!txt) return;
    const next = cues[k + 1];
    const end = next && next.cs > c.cs ? Math.min(c.ce, next.cs) : c.ce;
    out.push(...splitByChars(txt, c.cs, end, null));
  });
  // Auto-caption VTT repeats the previous line in the next cue: drop repeated words that overlap in time.
  const dedup: WordTiming[] = [];
  for (const w of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && w.startMs < prev.startMs) continue;
    if (prev && prev.text === w.text && w.startMs < prev.endMs) continue;
    dedup.push(w);
  }
  return dedup;
}

export type TranscriptKind = "manual" | "asr-orig" | "asr" | "translated";

/** Picks a subtitle track: manual <lang> > <lang>-orig > <lang>-<lang> ASR > other ASR in lang > translated (by pattern). */
export function pickSubtitleTrack(info: { subtitles?: Record<string, unknown>; automatic_captions?: Record<string, unknown>; language?: string | null }, lang: string): { key: string; kind: TranscriptKind } | null {
  const manual = Object.keys(info.subtitles ?? {}).filter((k) => k !== "live_chat");
  const auto = Object.keys(info.automatic_captions ?? {});
  const base = (k: string) => k.split("-")[0]!.toLowerCase();
  const m = manual.find((k) => k.toLowerCase() === lang) ?? manual.find((k) => base(k) === lang);
  if (m) return { key: m, kind: "manual" };
  const orig = auto.find((k) => k.toLowerCase() === `${lang}-orig`);
  if (orig) return { key: orig, kind: "asr-orig" };
  const same = auto.find((k) => k.toLowerCase() === `${lang}-${lang}`);
  if (same) return { key: same, kind: "asr" };
  // A plain "<lang>" auto track is ASR only when the video's own language is <lang>; otherwise it is a machine translation.
  const plain = auto.find((k) => k.toLowerCase() === lang);
  const videoLang = (info.language ?? "").split("-")[0]!.toLowerCase();
  if (plain && (videoLang === "" || videoLang === lang)) return { key: plain, kind: "asr" };
  const other = auto.find((k) => base(k) === lang && !k.toLowerCase().includes("-orig"));
  if (other && (videoLang === "" || videoLang === lang)) return { key: other, kind: "asr" };
  if (plain) return { key: plain, kind: "translated" };
  if (other) return { key: other, kind: "translated" };
  return null;
}
