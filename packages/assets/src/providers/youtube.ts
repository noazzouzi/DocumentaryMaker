// YouTube as an AssetProvider (local yt-dlp). Clips for quotes go through resolveClips; this serves live search.
import { existsSync } from "node:fs";
import path from "node:path";
import type { AssetProvider } from "@docmaker/core";
import { youtubeCandidate } from "../youtube/clips";
import { ytDownload, ytSearch, ytUrl } from "../youtube/ytdlp";

export const youtubeProvider: AssetProvider = {
  id: "youtube", kinds: ["video"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { perMin: 10, concurrency: 1 },
  isConfigured: (_s, config) => existsSync(path.join(config.paths.pyVenv, "bin", "yt-dlp")) || existsSync(path.join(config.paths.bin, "yt-dlp")),
  async search(q, ctx) {
    if (q.kind !== "video") return [];
    const hits = await ytSearch(q.text, { config: ctx.config, signal: ctx.signal, logger: ctx.logger });
    return hits.slice(0, q.limit).map((h) => ({
      candidate: youtubeCandidate(h, {
        videoId: h.id, channel: h.channel, channelVerified: h.channelVerified, publishedAt: "", url: ytUrl(h.id), startMs: null, endMs: null,
        transcriptLang: null, transcriptKind: "none", matchScore: null, matchedText: "",
      }),
      raw: { year: null, views: h.views },
    }));
  },
  async fetchOriginal(c, destDir, ctx) {
    const file = await ytDownload(c.providerAssetId, { sectionMs: null, outDir: destDir, durationSec: c.durationSec }, { config: ctx.config, signal: ctx.signal, logger: ctx.logger });
    return { path: file, mime: "video/mp4" };
  },
};
