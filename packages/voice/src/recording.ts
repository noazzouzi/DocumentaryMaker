// importRecording (§8.6): the user's own voice → a final "recording" take.
// global: files → recordings/, recording post chain, ASR, retake detection (4-grams within 30 s, keep the last),
//         NW of all display words against all ASR words, segment cuts at silence midpoints, < 50 % matched → missing.
// per-segment: <segmentId>[-n].<ext> files map directly to their segment (ASR + NW inside the segment only); files in
//              recordings/ are used in place, never copied back there (a copy would shadow later re-uploads).
// Missing segments are filled with pickup TTS (SegmentTake.pickup = true) when a pickup provider is given.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Aligner, Lang, Script, SegmentTake, TimedWord, VoiceTrack, WordTiming } from "@docmaker/core";
import { DocmakerError, P, hashJson, sha256Hex, wordId } from "@docmaker/core";
import { readWav, sha256File, writeWav } from "@docmaker/core/node";
import { EstimatedAligner } from "./align/estimated";
import { alignKey, alignScriptToTranscript, nwPairs, wordErrorRate } from "./align/nw";
import { detectRmsSilences } from "./audio/silence";
import { USER_OWNED_VOICE } from "./license";
import { POST_CHAIN_VERSION, runPostChain } from "./post/chain";
import { firstAsrAligner } from "./providers/registry";
import { voicedItems, type VoicedItem } from "./segments";
import { finalizeTrack, placeFile, segCacheDir, synthesizeTrack } from "./track";
import { takeIdFor } from "./hash";
import type { ImportRecordingInput, VoiceCtx } from "./types";

export const RETAKE_NGRAM = 4;
export const RETAKE_WINDOW_MS = 30_000;
export const MIN_MATCHED_RATIO = 0.5;
const SR = 48000;
const FADE_MS = 5;
const SEG_LEAD_MS = 250;
const SEG_TAIL_MS = 400;
const RECORDING_SETTINGS_HASH = hashJson({ provider: "recording", post: POST_CHAIN_VERSION });

export interface AsrWord extends WordTiming { file: number }

/**
 * Retakes: a word 4-gram repeated within 30 s means the speaker restarted; every word from the first occurrence up
 * to the restart is dropped (the last attempt is kept). 4-grams that the script itself repeats are ignored.
 */
export function detectRetakes(words: readonly Pick<AsrWord, "text" | "startMs" | "file">[], scriptText: readonly string[] = []): { keep: boolean[]; runs: [number, number][] } {
  const keys = words.map((w) => alignKey(w.text));
  const scriptGrams = new Map<string, number>();
  const sk = scriptText.map(alignKey);
  for (let i = 0; i + RETAKE_NGRAM <= sk.length; i++) {
    const g = sk.slice(i, i + RETAKE_NGRAM).join(" ");
    scriptGrams.set(g, (scriptGrams.get(g) ?? 0) + 1);
  }
  const keep = words.map(() => true);
  const runs: [number, number][] = [];
  const seen = new Map<string, number>();
  for (let k = 0; k + RETAKE_NGRAM <= words.length; k++) {
    const slice = keys.slice(k, k + RETAKE_NGRAM);
    if (slice.some((x) => x === "")) continue;
    if (words.slice(k, k + RETAKE_NGRAM).some((w) => w.file !== words[k]!.file)) continue;
    const g = slice.join(" ");
    const j = seen.get(g);
    if (j !== undefined && keep[j] && words[j]!.file === words[k]!.file && words[k]!.startMs - words[j]!.startMs <= RETAKE_WINDOW_MS && (scriptGrams.get(g) ?? 0) < 2) {
      for (let x = j; x < k; x++) keep[x] = false;
      runs.push([j, k]);
    }
    seen.set(g, k);
  }
  return { keep, runs };
}

interface FileAudio { abs: string; samples: Float32Array; durMs: number; silences: { startMs: number; endMs: number }[] }

/** Boundary inside the gap [a, b]: midpoint of the longest silence overlapping it, else the gap midpoint. */
function boundaryIn(f: FileAudio, a: number, b: number): number {
  if (b <= a) return (a + b) / 2;
  let best: { startMs: number; endMs: number } | null = null;
  for (const s of f.silences) {
    const lo = Math.max(a, s.startMs), hi = Math.min(b, s.endMs);
    if (hi > lo && (!best || hi - lo > Math.min(b, best.endMs) - Math.max(a, best.startMs))) best = s;
  }
  if (!best) return (a + b) / 2;
  return (Math.max(a, best.startMs) + Math.min(b, best.endMs)) / 2;
}

/** Extracts [startMs, endMs) minus the cut spans, with short fades at every edge; returns samples and a time remapper. */
function extract(f: FileAudio, startMs: number, endMs: number, cuts: readonly [number, number][]): { samples: Float32Array; map: (t: number) => number } {
  const pieces: [number, number][] = [];
  let cur = startMs;
  for (const [a, b] of [...cuts].filter(([a, b]) => b > startMs && a < endMs).sort((x, y) => x[0] - y[0])) {
    if (a > cur) pieces.push([cur, Math.min(a, endMs)]);
    cur = Math.max(cur, b);
  }
  if (cur < endMs) pieces.push([cur, endMs]);
  const toS = (ms: number) => Math.max(0, Math.min(f.samples.length, Math.round((ms * SR) / 1000)));
  const lens = pieces.map(([a, b]) => toS(b) - toS(a));
  const out = new Float32Array(lens.reduce((x, y) => x + y, 0));
  const fade = Math.round((FADE_MS * SR) / 1000);
  let off = 0;
  pieces.forEach(([a], i) => {
    const s0 = toS(a), n = lens[i]!;
    for (let k = 0; k < n; k++) {
      const g = Math.min(1, k / fade, (n - 1 - k) / fade);
      out[off + k] = f.samples[s0 + k]! * Math.max(0, g);
    }
    off += n;
  });
  const map = (t: number) => {
    let acc = 0;
    for (const [a, b] of pieces) {
      if (t < a) return acc;
      if (t <= b) return acc + (t - a);
      acc += b - a;
    }
    return acc;
  };
  return { samples: out, map };
}

async function prepareFile(src: string, recDir: string, ctx: VoiceCtx): Promise<FileAudio> {
  const base = path.basename(src);
  const stored = path.join(recDir, base);
  if (path.resolve(src) !== path.resolve(stored)) await copyFile(src, stored);
  const clean = path.join(recDir, ".clean", `${base}.wav`);
  await mkdir(path.dirname(clean), { recursive: true });
  await runPostChain(stored, clean, { kind: "recording", rawFormat: null }, ctx);
  const w = await readWav(clean);
  const samples = w.data[0]!;
  return {
    abs: clean, samples, durMs: (samples.length * 1000) / SR,
    silences: detectRmsSilences(samples, SR, { thresholdDb: -45, minMs: 80 }),
  };
}

interface SegOut { take: Omit<SegmentTake, "file">; src: string }

async function writeSegment(item: VoicedItem, f: FileAudio, startMs: number, endMs: number, cuts: [number, number][], timings: (WordTiming & { matched: boolean })[], asrHeard: string[], cacheDir: string, fileSha: string): Promise<SegOut> {
  const { samples, map } = extract(f, startMs, endMs, cuts);
  const cacheKey = sha256Hex(["recording", fileSha, Math.round(startMs), Math.round(endMs), JSON.stringify(cuts.map(([a, b]) => [Math.round(a), Math.round(b)])), `post${POST_CHAIN_VERSION}`].join("|"));
  const out = path.join(cacheDir, `${cacheKey}.wav`);
  await writeWav(out, { sampleRate: SR, channels: 1, data: [samples] }, "s16");
  const durationMs = Math.round((samples.length * 1000) / SR);
  const clamp = (t: number) => Math.max(0, Math.min(durationMs, Math.round(map(t))));
  const words: TimedWord[] = item.display.map((d, k) => {
    const t = timings[k]!;
    return {
      wordId: wordId(item.seg.id, d.idx), text: d.text, startMs: clamp(t.startMs), endMs: Math.max(clamp(t.startMs), clamp(t.endMs)),
      confidence: t.matched ? t.confidence : null, source: t.matched ? "aligned" : "interpolated",
    };
  });
  for (let k = 1; k < words.length; k++) if (words[k]!.startMs < words[k - 1]!.startMs) words[k]!.startMs = words[k - 1]!.startMs;
  for (const w of words) if (w.endMs < w.startMs) w.endMs = w.startMs;
  return {
    take: {
      segmentId: item.seg.id, mode: item.mode, sha256: await sha256File(out), durationMs, ttsText: item.ttsText, ttsTextHash: hashJson(item.ttsText),
      cacheKey, leadTrimMs: 0, words, providerRequestId: null,
      asrWer: asrHeard.length ? Math.round(wordErrorRate(item.display.map((d) => d.text), asrHeard) * 1000) / 1000 : null, pickup: false,
    },
    src: out,
  };
}

async function resolveAsr(i: ImportRecordingInput, ctx: VoiceCtx): Promise<Aligner | null> {
  if (i.asr) return i.asr;
  return firstAsrAligner(ctx, i.aligner);
}

const SEGMENT_FILE = /^(CH\d{1,2}-S\d{2,3})(?:-(\d+))?\.[A-Za-z0-9]+$/;

export async function importRecording(i: ImportRecordingInput, ctx: VoiceCtx): Promise<VoiceTrack> {
  const { lang, projectDir } = i;
  if (i.files.length === 0) throw new DocmakerError("VALIDATION", "no recording files given");
  for (const f of i.files) if (!existsSync(f)) throw new DocmakerError("VALIDATION", `recording not found: ${f}`);
  const items = voicedItems(i.script, { lang, clipNarrated: i.clipNarrated ?? [], textOptions: { lexicon: i.pickup?.voice.lexicon ?? [], expandNumbers: true, stripTags: true } });
  const recDir = path.join(projectDir, P.recordings(lang));
  await mkdir(recDir, { recursive: true });
  const cacheDir = segCacheDir(projectDir, lang);
  await mkdir(cacheDir, { recursive: true });
  const notes: string[] = [];
  const built = new Map<string, SegOut>();
  const asr = await resolveAsr(i, ctx);

  if (i.mode === "global") {
    if (!asr) throw new DocmakerError("TOOL_MISSING", "importing a full recording needs speech recognition", { hint: "docmaker setup --python" });
    const files = [...i.files].sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en", { numeric: true }));
    const audio: FileAudio[] = [];
    const fileShas: string[] = [];
    const asrWords: AsrWord[] = [];
    for (const [fi, f] of files.entries()) {
      ctx.progress((fi / files.length) * 0.6, `recording ${path.basename(f)}: cleaning + ASR`);
      const fa = await prepareFile(f, recDir, ctx);
      audio.push(fa);
      fileShas.push(await sha256File(fa.abs));
      const heard = await asr.transcribe(fa.abs, lang, i.namesPrompt ?? "", ctx.signal);
      asrWords.push(...heard.map((w) => ({ ...w, file: fi })));
    }
    const displaySeq = items.flatMap((it, ii) => it.display.map((d) => ({ text: d.text, item: ii })));
    const { keep, runs } = detectRetakes(asrWords, displaySeq.map((d) => d.text));
    if (runs.length) notes.push(`${runs.length} retake(s) removed (kept the last attempt)`);
    // audio cuts for retakes: from the gap before the dropped attempt to the gap before the kept one
    const cutsByFile = new Map<number, [number, number][]>();
    for (const [j, k] of runs) {
      const fi = asrWords[j]!.file;
      const fa = audio[fi]!;
      const a = j > 0 && asrWords[j - 1]!.file === fi ? boundaryIn(fa, asrWords[j - 1]!.endMs, asrWords[j]!.startMs) : Math.max(0, asrWords[j]!.startMs - 50);
      const b = boundaryIn(fa, asrWords[k - 1]!.endMs, asrWords[k]!.startMs);
      cutsByFile.set(fi, [...(cutsByFile.get(fi) ?? []), [a, b]]);
    }
    const kept = asrWords.filter((_, x) => keep[x]);
    const pairs = nwPairs(displaySeq.map((d) => d.text), kept.map((w) => w.text));
    // per item: matched kept-word indices
    const matchedOf = items.map(() => [] as number[]);
    for (const [d, w] of pairs) matchedOf[displaySeq[d]!.item]!.push(w);
    // plan each covered item: majority file, kept-word range, per-item NW with interpolation
    interface Plan { it: VoicedItem; file: number; words: AsrWord[]; timings: (WordTiming & { matched: boolean })[]; first: number; last: number }
    const plans: (Plan | null)[] = items.map((it, ii) => {
      const m = matchedOf[ii]!;
      if (m.length / Math.max(1, it.display.length) < MIN_MATCHED_RATIO) return null;
      const counts = new Map<number, number>();
      for (const w of m) counts.set(kept[w]!.file, (counts.get(kept[w]!.file) ?? 0) + 1);
      const file = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const inFile = m.filter((w) => kept[w]!.file === file);
      const lo = Math.min(...inFile), hi = Math.max(...inFile);
      const words = kept.slice(lo, hi + 1).filter((w) => w.file === file);
      const timings = alignScriptToTranscript(it.display.map((d) => d.text), words);
      return { it, file, words, timings, first: Math.min(...timings.map((t) => t.startMs)), last: Math.max(...timings.map((t) => t.endMs)) };
    });
    for (const [ii, p] of plans.entries()) {
      if (!p) continue;
      const fa = audio[p.file]!;
      const prev = plans.slice(0, ii).reverse().find((x) => x !== null && x.file === p.file) ?? null;
      const next = plans.slice(ii + 1).find((x) => x !== null && x.file === p.file) ?? null;
      const start = prev && prev.last <= p.first ? boundaryIn(fa, prev.last, p.first) : Math.max(0, p.first - SEG_LEAD_MS);
      const end = next && next.first >= p.last ? boundaryIn(fa, p.last, next.first) : Math.min(fa.durMs, p.last + SEG_TAIL_MS);
      const seg = await writeSegment(p.it, fa, start, end, cutsByFile.get(p.file) ?? [], p.timings, p.words.map((w) => w.text), cacheDir, fileShas[p.file]!);
      built.set(p.it.seg.id, seg);
      ctx.progress(0.6 + (0.3 * (ii + 1)) / items.length, `recording: ${p.it.seg.id}`);
    }
  } else {
    // per-segment: the newest file per segment id wins — the highest explicit -n first, then the most recently written
    // file (a re-upload replaces recordings/<segmentId>.<ext> in place, possibly with another extension).
    const bySeg = new Map<string, { file: string; n: number; at: number }>();
    for (const f of i.files) {
      const m = SEGMENT_FILE.exec(path.basename(f));
      if (!m) throw new DocmakerError("VALIDATION", `per-segment recordings must be named <segmentId>[-n].<ext>: ${path.basename(f)}`);
      const n = m[2] ? Number(m[2]) : 0;
      const st = await stat(f);
      const at = Math.max(st.mtimeMs, st.ctimeMs);
      const cur = bySeg.get(m[1]!);
      if (!cur || n > cur.n || (n === cur.n && at >= cur.at)) bySeg.set(m[1]!, { file: f, n, at });
    }
    const known = new Map(items.map((it) => [it.seg.id, it]));
    for (const id of bySeg.keys()) if (!known.has(id)) throw new DocmakerError("VALIDATION", `${id} is not a voiced segment of the ${lang} script`);
    for (const [id, { file }] of bySeg) {
      const it = known.get(id)!;
      // A file already in recordings/ (the stage passes that directory's files) is used in place: a copy stored next to
      // it would outrank every later re-upload of the segment. A file from elsewhere is stored under its own name.
      const stored = path.join(recDir, path.basename(file));
      if (path.resolve(file) !== path.resolve(stored)) await copyFile(file, stored);
      const clean = path.join(recDir, ".clean", `${path.basename(stored)}.wav`);
      await mkdir(path.dirname(clean), { recursive: true });
      await runPostChain(stored, clean, { kind: "recording", rawFormat: null }, ctx);
      const w = await readWav(clean);
      const fa: FileAudio = { abs: clean, samples: w.data[0]!, durMs: (w.data[0]!.length * 1000) / SR, silences: [] };
      const texts = it.display.map((d) => d.text);
      let timings: (WordTiming & { matched: boolean })[];
      let heard: string[] = [];
      if (asr) {
        const h = await asr.transcribe(clean, lang, i.namesPrompt ?? "", ctx.signal);
        heard = h.map((x) => x.text);
        timings = alignScriptToTranscript(texts, h);
      } else {
        timings = (await new EstimatedAligner(ctx.config).align(clean, texts, lang, ctx.signal)).map((x) => ({ ...x, matched: false }));
      }
      built.set(id, await writeSegment(it, fa, 0, fa.durMs, [], timings, heard, cacheDir, await sha256File(clean)));
    }
    if (!asr) notes.push("no speech recognition installed: word timings of the re-recorded segments are estimated");
    // keep the previous take's other segments
    for (const prev of i.previous?.segments ?? []) {
      if (built.has(prev.segmentId) || !known.has(prev.segmentId)) continue;
      const src = path.join(projectDir, prev.file);
      if (existsSync(src)) built.set(prev.segmentId, { take: prev, src });
    }
  }

  // missing segments → pickup TTS or missingSegmentIds
  let missing = items.filter((it) => !built.has(it.seg.id)).map((it) => it.seg.id);
  let pickupDir: string | null = null;
  if (missing.length && i.pickup) {
    const sub: Script = {
      ...i.script,
      chapters: i.script.chapters.map((c) => ({ ...c, segments: c.segments.filter((s) => missing.includes(s.id)) })).filter((c) => c.segments.length),
    };
    const before = new Set(await readdir(path.join(projectDir, `voice/${lang}`)).catch(() => [] as string[]));
    const existedBefore = (id: string) => before.has(id);
    const pickupTake = await synthesizeTrack({
      lang, script: sub, voice: { ...i.pickup.voice, provider: i.pickup.provider }, kind: "final", clipNarrated: (i.clipNarrated ?? []).filter((x) => missing.includes(x)),
      segments: null, previous: null, projectDir, styleCps: i.pickup.voice.charsPerSec ?? 0, retryBad: false, provider: i.pickupProvider,
    }, ctx);
    for (const s of pickupTake.segments) built.set(s.segmentId, { take: { ...s, pickup: true }, src: path.join(projectDir, s.file) });
    notes.push(`PICKUP TTS (${pickupTake.provider}) for ${pickupTake.segments.length} segment(s): ${pickupTake.segments.map((s) => s.segmentId).join(", ")}`);
    const pickupSrc = new Set(pickupTake.segments.map((s) => s.segmentId));
    missing = missing.filter((m) => !pickupSrc.has(m));
    // the intermediate pickup take directory is not kept (its files are re-placed into the recording take)
    if (!existedBefore(pickupTake.id)) pickupDir = path.join(projectDir, `voice/${lang}/${pickupTake.id}`);
  }

  const segs = items.map((it) => built.get(it.seg.id)).filter((x): x is SegOut => x !== undefined);
  const takeId = takeIdFor("final", "recording", "user", RECORDING_SETTINGS_HASH, segs.map((s) => s.take.cacheKey));
  const segments: SegmentTake[] = [];
  for (const s of segs) {
    const rel = P.takeSegment(lang, takeId, s.take.segmentId);
    await placeFile(s.src, path.join(projectDir, rel));
    segments.push({ ...s.take, file: rel });
  }
  if (pickupDir) await rm(pickupDir, { recursive: true, force: true });
  if (missing.length) notes.push(`${missing.length} segment(s) not found in the recording: ${missing.join(", ")}`);
  const qa = segments.filter((s) => !s.pickup && s.asrWer !== null && s.asrWer > 0.25).map((s) => s.segmentId);
  if (qa.length) notes.push(`check these segments (the recording differs from the script): ${qa.join(", ")}`);
  ctx.progress(1, "recording imported");
  return finalizeTrack({
    id: takeId, kind: "final", lang: lang as Lang, provider: "recording", voiceId: "user", modelId: null, settingsHash: RECORDING_SETTINGS_HASH,
    license: USER_OWNED_VOICE, segments, missingSegmentIds: missing, charsBilled: 0, costUsd: 0, notes,
  });
}
