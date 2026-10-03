// Manual clip resolution (§7.7): a YouTube URL (yt-dlp) or a local file + timecodes → clip-v1 → ClipResolution{status:"manual"}.
// The engine writes the resolution into user-picks.json (user input). The fair-use gate applies to both paths.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, P, Project } from "@docmaker/core";
import type { ClipResolution, ClipWordsDoc, FrozenAsset, WordTiming, YoutubeRef } from "@docmaker/core";
import { conformClip, DEFAULT_HANDLE_MS } from "../conform";
import { freezeFile } from "../freeze";
import { attributionText, licenseInfo } from "../license";
import type { AssetsCtx } from "../types";
import { recordUserFrozen } from "../userfrozen";
import { errMsg, makeTmpDir, nowIso, rmrf } from "../util";
import { downloadAndFreeze, youtubeCandidate } from "./clips";
import { parseYoutubeId, ytFetchTranscript, ytInfo, ytUrl } from "./ytdlp";

export async function resolveManualClip(i: { projectDir: string; segmentId: string; quoteId: string; url: string | null; file: string | null; startMs: number; endMs: number; channel: string; title: string; fps: number }, ctx: AssetsCtx): Promise<{ clip: ClipResolution; frozen: FrozenAsset; words: ClipWordsDoc | null }> {
  if ((i.url === null) === (i.file === null)) throw new DocmakerError("VALIDATION", "give exactly one of --url or --file");
  if (!(i.endMs > i.startMs) || i.startMs < 0) throw new DocmakerError("VALIDATION", "the clip end must be after its start");
  let project: Project | null = null;
  try {
    project = Project.parse(JSON.parse(await readFile(path.join(i.projectDir, P.project), "utf8")));
  } catch { /* checked below */ }
  if (!project) throw new DocmakerError("UPSTREAM_MISSING", "project.json is missing or invalid");
  if (!project.assets.licensePolicy.allowYoutubeFairUse) throw new DocmakerError("POLICY_DENIED", "third-party clips are disabled (allowYoutubeFairUse=false)");
  if (!project.editorial.fairUseAcknowledged) throw new DocmakerError("GATE_REQUIRED", "acknowledge the fair-use notice before importing clips", { hint: "gate fair-use" });
  const maxMs = project.assets.maxClipSeconds * 1000;
  if (i.endMs - i.startMs > maxMs * 2) throw new DocmakerError("VALIDATION", `clip longer than ${Math.round((maxMs * 2) / 1000)} s; keep quotations short`);

  if (i.url !== null) {
    const videoId = parseYoutubeId(i.url);
    if (!videoId) throw new DocmakerError("VALIDATION", "only YouTube URLs are supported; download other sources yourself and use --file");
    const yctx = { config: ctx.config, signal: ctx.signal, logger: ctx.logger };
    const info = await ytInfo(videoId, yctx);
    const durationSec = Number(info.duration ?? 0) || null;
    let words: WordTiming[] = [];
    let kind: YoutubeRef["transcriptKind"] = "none";
    let tlang: string | null = null;
    try {
      const t = await ytFetchTranscript(videoId, String(info.language ?? "en").split("-")[0] || "en", yctx);
      words = t.words;
      kind = t.kind;
      tlang = t.lang;
    } catch (e) {
      ctx.logger.warn("transcript unavailable for manual clip", { videoId, error: errMsg(e) });
    }
    const channel = i.channel || String(info.channel ?? info.uploader ?? "");
    const title = i.title || String(info.title ?? videoId);
    const matched = words.filter((w) => w.startMs >= i.startMs && w.endMs <= i.endMs).map((w) => w.text).join(" ");
    const ref: YoutubeRef = {
      videoId, channel, channelVerified: info.channel_is_verified === true, publishedAt: String(info.upload_date ?? ""), url: ytUrl(videoId),
      startMs: i.startMs, endMs: i.endMs, transcriptLang: tlang, transcriptKind: kind, matchScore: null, matchedText: matched,
    };
    const cand = youtubeCandidate({ id: videoId, title, channel, durationSec: durationSec ?? 0 }, ref);
    const r = await downloadAndFreeze({ videoId, durationSec, startMs: i.startMs, endMs: i.endMs, words, candidate: cand, projectDir: i.projectDir, fps: i.fps, keepSource: project.assets.keepSourceDownloads }, ctx);
    await recordUserFrozen(i.projectDir, r.frozen);
    return {
      clip: { segmentId: i.segmentId, quoteId: i.quoteId, assetId: r.frozen.id, status: "manual", source: "manual-url", youtube: ref, passageInMs: r.passageInMs, passageOutMs: r.passageOutMs, reason: "manual clip (URL)" },
      frozen: r.frozen,
      words: r.words.length > 0 ? { schemaVersion: 1, segmentId: i.segmentId, assetId: r.frozen.id, words: r.words } : null,
    };
  }

  const file = path.resolve(i.file!);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
  } catch {
    throw new DocmakerError("VALIDATION", `${i.file} is not a readable file`);
  }
  const tmp = await makeTmpDir("manualclip");
  try {
    const conf = await conformClip(file, tmp, { fps: i.fps, passageInMs: i.startMs, passageOutMs: i.endMs, handleMs: DEFAULT_HANDLE_MS }, ctx);
    const license = licenseInfo("YOUTUBE-FAIR-USE", { url: null });
    const title = i.title || path.basename(file).replace(/\.[^.]+$/, "");
    const candidate = {
      provider: "local" as const, providerAssetId: path.basename(file), kind: "video" as const, title, description: "manual clip (file)", tags: [],
      previewUrl: "", downloadUrl: "", width: conf.width, height: conf.height, durationSec: conf.durationMs !== null ? conf.durationMs / 1000 : null,
      license: { ...license, attributionText: attributionText({ title, author: i.channel || null, license, sourcePageUrl: null }) },
      author: i.channel ? { name: i.channel, url: null } : null, sourcePageUrl: "", retrievedAt: nowIso(), youtube: null,
    };
    const frozen = await freezeFile({ file, kind: "video", role: "clip", candidate, declaration: { kind: "third-party-quotation", license: null, author: i.channel, url: "", note: title }, conform: conf, projectDir: i.projectDir }, ctx);
    await recordUserFrozen(i.projectDir, frozen);
    return {
      clip: { segmentId: i.segmentId, quoteId: i.quoteId, assetId: frozen.id, status: "manual", source: "manual-file", youtube: null, passageInMs: conf.passageInMs, passageOutMs: conf.passageOutMs, reason: "manual clip (file)" },
      frozen, words: null,
    };
  } finally {
    await rmrf(tmp);
  }
}
