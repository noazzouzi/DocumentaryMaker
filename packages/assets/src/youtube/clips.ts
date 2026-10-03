// resolveClips (§7.7): YouTube search → transcript → passage finder → (M3) download + clip-v1 conform. Never fatal.
import path from "node:path";
import type { ClipResolution, ClipWordsDoc, FactSheet, FrozenAsset, Project, Quote, Script, WordTiming, YoutubeRef } from "@docmaker/core";
import { isDocmakerError } from "@docmaker/core";
import { conformClip, DEFAULT_HANDLE_MS } from "../conform";
import { freezeFile } from "../freeze";
import { attributionText, licenseInfo } from "../license";
import type { AssetsCtx } from "../types";
import { errMsg, makeTmpDir, nowIso, rmrf } from "../util";
import { detectCuts, snapToCuts } from "./cuts";
import { findPassage, PASSAGE_ACCEPT } from "./passage";
import { dropYtSource, parseYoutubeId, ytDownload, ytFetchTranscript, ytSearch, ytUrl, type YtSearchHit } from "./ytdlp";

const MAX_HITS = 5;
const MAX_VIDEO_SEC = 30 * 60;

/** Search hits ordered: verified channels first, ≤ 30 min, then views. */
export function orderHits(hits: YtSearchHit[]): YtSearchHit[] {
  const fits = (h: YtSearchHit) => Number(h.durationSec > 0 && h.durationSec <= MAX_VIDEO_SEC);
  return [...hits].sort((a, b) =>
    Number(b.channelVerified) - Number(a.channelVerified)
    || fits(b) - fits(a)
    || b.views - a.views
    || (a.id < b.id ? -1 : 1));
}

export function youtubeCandidate(hit: { id: string; title: string; channel: string; durationSec: number }, ref: YoutubeRef) {
  const url = ytUrl(hit.id);
  const license = licenseInfo("YOUTUBE-FAIR-USE", { url });
  return {
    provider: "youtube" as const, providerAssetId: hit.id, kind: "video" as const, title: hit.title, description: "", tags: [],
    previewUrl: `https://i.ytimg.com/vi/${hit.id}/hqdefault.jpg`, downloadUrl: "", width: null, height: null, durationSec: hit.durationSec || null,
    license: { ...license, attributionText: attributionText({ title: hit.title, author: hit.channel, license, sourcePageUrl: url }) },
    author: { name: hit.channel, url: null }, sourcePageUrl: url, retrievedAt: nowIso(), youtube: ref,
  };
}

/** Words inside [fromMs, toMs] of the source, re-timed relative to `originMs` (the conformed file start). */
export function rebaseWords(words: readonly WordTiming[], fromMs: number, toMs: number, originMs: number): WordTiming[] {
  return words
    .filter((w) => w.endMs > fromMs && w.startMs < toMs)
    .map((w) => ({ ...w, startMs: Math.max(0, w.startMs - originMs), endMs: Math.max(0, w.endMs - originMs) }));
}

export interface ClipsResult { clips: ClipResolution[]; frozen: FrozenAsset[]; clipWords: ClipWordsDoc[]; upgradedQuotes: string[] }

/** Optional LLM tie-breaker (llm.pickPassage bound by the engine): chooses among candidate windows of one quote. */
export type PassagePicker = (i: { verbatim: string; windows: { index: number; text: string; startMs: number; endMs: number }[] }) => Promise<{ bestIndex: number; confidence: number }>;

export async function resolveClips(i: { project: Project; script: Script; facts: FactSheet; skipSegments: ReadonlySet<string>; projectDir: string; passagePicker?: PassagePicker | null }, ctx: AssetsCtx): Promise<ClipsResult> {
  const out: ClipsResult = { clips: [], frozen: [], clipWords: [], upgradedQuotes: [] };
  const offline = ctx.config.offline || i.project.assets.offline;
  const policy = i.project.assets.licensePolicy;
  const quotes = new Map<string, Quote>(i.facts.quotes.map((q) => [q.id, q]));
  const segs = i.script.chapters.flatMap((c) => c.segments).filter((s) => s.type === "clip" && !i.skipSegments.has(s.id));
  for (const seg of segs) {
    const quote = seg.quoteId ? quotes.get(seg.quoteId) : undefined;
    const base = { segmentId: seg.id, quoteId: seg.quoteId ?? "Q1", assetId: null, source: "auto" as const, youtube: null, passageInMs: null, passageOutMs: null };
    if (!quote) {
      out.clips.push({ ...base, status: "failed", reason: `segment has no known quote (${seg.quoteId ?? "none"})` });
      continue;
    }
    if (offline) {
      out.clips.push({ ...base, quoteId: quote.id, status: "skipped-offline", reason: "offline: YouTube clips are resolved online or imported manually" });
      continue;
    }
    if (!policy.allowYoutubeFairUse) {
      out.clips.push({ ...base, quoteId: quote.id, status: "skipped-policy", reason: "YouTube clips are disabled (allowYoutubeFairUse=false)" });
      continue;
    }
    try {
      const r = await resolveOne(seg.id, quote, i, ctx);
      out.clips.push(r.clip);
      if (r.frozen) out.frozen.push(r.frozen);
      if (r.words) out.clipWords.push(r.words);
      if ((r.clip.youtube?.matchScore ?? 0) >= 0.8) out.upgradedQuotes.push(quote.id);
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      const code = isDocmakerError(e) ? e.code : "INTERNAL";
      ctx.logger.warn("clip resolution failed", { segmentId: seg.id, code, error: errMsg(e) });
      out.clips.push({ ...base, quoteId: quote.id, status: "failed", reason: `${code}: ${errMsg(e)}`.slice(0, 500) });
    }
  }
  return out;
}

async function resolveOne(segmentId: string, quote: Quote, i: { project: Project; facts: FactSheet; projectDir: string; passagePicker?: PassagePicker | null }, ctx: AssetsCtx): Promise<{ clip: ClipResolution; frozen: FrozenAsset | null; words: ClipWordsDoc | null }> {
  const speaker = i.facts.people.find((p) => p.id === quote.speakerId)?.name ?? "";
  const q = quote.youtubeSearchQuery.trim() || `${speaker} ${quote.verbatim.split(/\s+/).slice(0, 12).join(" ")}`.trim();
  const maxClipMs = Math.round(i.project.assets.maxClipSeconds * 1000);
  const hits = orderHits(await ytSearch(q, { config: ctx.config, signal: ctx.signal, logger: ctx.logger })).slice(0, MAX_HITS);
  const found: { hit: YtSearchHit; words: WordTiming[]; kind: YoutubeRef["transcriptKind"]; lang: string | null; p: NonNullable<ReturnType<typeof findPassage>> }[] = [];
  for (const hit of hits) {
    const t = await ytFetchTranscript(hit.id, quote.language || "en", { config: ctx.config, signal: ctx.signal, logger: ctx.logger });
    if (t.words.length === 0) continue;
    const p = findPassage(quote.verbatim, t.words, { maxClipMs });
    if (p && p.score >= PASSAGE_ACCEPT) {
      found.push({ hit, words: t.words, kind: t.kind, lang: t.lang, p });
      if (p.score >= 0.95) break; // near-exact: no need to look further
    }
  }
  const base = { segmentId, quoteId: quote.id, source: "auto" as const };
  if (found.length === 0) {
    return { clip: { ...base, assetId: null, status: "not-found", youtube: null, passageInMs: null, passageOutMs: null, reason: `no passage ≥ ${PASSAGE_ACCEPT} in the top ${hits.length} results for "${q}"` }, frozen: null, words: null };
  }
  // First ≥ 0.6 wins; when the two best scores are within 0.05 the injected picker (llm.pickPassage) decides between the windows.
  let best = found[0]!;
  const byScore = [...found].sort((a, b) => b.p.score - a.p.score);
  const tie = byScore.length > 1 && byScore[0]!.p.score - byScore[1]!.p.score <= 0.05;
  if (tie && i.passagePicker) {
    try {
      const r = await i.passagePicker({ verbatim: quote.verbatim, windows: found.map((f, index) => ({ index, text: f.p.matchedText, startMs: f.p.startMs, endMs: f.p.endMs })) });
      if (r.bestIndex >= 0 && r.bestIndex < found.length) best = found[r.bestIndex]!;
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      ctx.logger.warn("passage tie-break failed; first match kept", { segmentId, error: errMsg(e) });
    }
  }
  const ref: YoutubeRef = {
    videoId: best.hit.id, channel: best.hit.channel, channelVerified: best.hit.channelVerified, publishedAt: "", url: ytUrl(best.hit.id),
    startMs: best.p.startMs, endMs: best.p.endMs, transcriptLang: best.lang, transcriptKind: best.kind, matchScore: best.p.score, matchedText: best.p.matchedText,
  };
  const ambiguity = tie ? (i.passagePicker ? " (tie broken by the passage picker)" : " (close alternative found)") : "";
  if (!i.project.editorial.fairUseAcknowledged) {
    return { clip: { ...base, assetId: null, status: "skipped-policy", youtube: ref, passageInMs: null, passageOutMs: null, reason: `passage found${ambiguity}; download waits for the fair-use acknowledgement` }, frozen: null, words: null };
  }
  const r = await downloadAndFreeze({
    videoId: best.hit.id, durationSec: best.hit.durationSec, startMs: best.p.startMs, endMs: best.p.endMs, words: best.words, candidate: youtubeCandidate(best.hit, ref),
    projectDir: i.projectDir, fps: i.project.video.fps, keepSource: i.project.assets.keepSourceDownloads, snapTo: { startMs: best.p.matchStartMs, endMs: best.p.matchEndMs },
  }, ctx);
  ref.startMs = r.startMs;
  ref.endMs = r.endMs;
  return {
    clip: { ...base, assetId: r.frozen.id, status: "found", youtube: ref, passageInMs: r.passageInMs, passageOutMs: r.passageOutMs, reason: `match ${best.p.score}${ambiguity}` },
    frozen: r.frozen,
    words: { schemaVersion: 1, segmentId, assetId: r.frozen.id, words: r.words },
  };
}

/** yt-dlp download (whole ≤ 15 min, else a section with handles) → optional shot snap (±0.5 s, never into the matched words)
 *  → clip-v1 → freeze; words re-timed to the conformed file. Returns the final passage on the source clock. */
export async function downloadAndFreeze(o: { videoId: string; durationSec: number | null; startMs: number; endMs: number; words: readonly WordTiming[]; candidate: ReturnType<typeof youtubeCandidate>; projectDir: string; fps: number; keepSource: boolean; snapTo?: { startMs: number; endMs: number } | null }, ctx: AssetsCtx): Promise<{ frozen: FrozenAsset; passageInMs: number; passageOutMs: number; words: WordTiming[]; startMs: number; endMs: number }> {
  const tmp = await makeTmpDir("clip");
  try {
    const sectionStart = Math.max(0, o.startMs - DEFAULT_HANDLE_MS - 1000);
    const section: [number, number] = [sectionStart, o.endMs + DEFAULT_HANDLE_MS + 1000];
    const file = await ytDownload(o.videoId, { sectionMs: section, outDir: tmp, durationSec: o.durationSec }, { config: ctx.config, signal: ctx.signal, logger: ctx.logger, onProgress: (p) => ctx.progress(p, "downloading clip") });
    const whole = !file.startsWith(tmp + path.sep);
    const offset = whole ? 0 : sectionStart;
    let win = { startMs: o.startMs, endMs: o.endMs };
    if (o.snapTo) {
      try {
        const cuts = await detectCuts(file, Math.max(0, o.startMs - offset - 1000), o.endMs - offset + 1000, { config: ctx.config, signal: ctx.signal, logger: ctx.logger });
        win = snapToCuts(win, o.snapTo, cuts.map((c) => c + offset));
      } catch (e) {
        if (isDocmakerError(e) && e.code === "CANCELED") throw e;
        ctx.logger.debug("shot detection failed; passage kept", { error: errMsg(e) });
      }
    }
    const conf = await conformClip(file, tmp, { fps: o.fps, passageInMs: win.startMs - offset, passageOutMs: win.endMs - offset, handleMs: DEFAULT_HANDLE_MS }, ctx);
    // The ledger and the frozen candidate carry the final (snapped) passage.
    const candidate = o.candidate.youtube ? { ...o.candidate, youtube: { ...o.candidate.youtube, startMs: win.startMs, endMs: win.endMs } } : o.candidate;
    const frozen = await freezeFile({ file, kind: "video", role: "clip", candidate, declaration: null, conform: conf, projectDir: o.projectDir }, ctx);
    const origin = offset + (conf.sourceInMs ?? 0);
    const words = rebaseWords(o.words, origin, offset + (conf.sourceOutMs ?? Number.MAX_SAFE_INTEGER), origin);
    if (whole && !o.keepSource) await dropYtSource(ctx.config, o.videoId);
    return { frozen, passageInMs: conf.passageInMs, passageOutMs: conf.passageOutMs, words, startMs: win.startMs, endMs: win.endMs };
  } finally {
    await rmrf(tmp);
  }
}

export { parseYoutubeId };
