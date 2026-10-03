// Keyed stock providers: Pexels (photos + videos) and Pixabay (photos + videos, 24 h response cache, download never hotlink).
import type { AssetProvider, AssetQuery, Candidate } from "@docmaker/core";
import { licenseInfo } from "../license";
import { nowIso } from "../util";
import { downloadOriginal, qs, titleFromSlug, type SearchResult } from "./common";

// ------------------------------------------------------------------------------------------------ Pexels
interface PexelsPhoto { id: number; width: number; height: number; url: string; alt?: string; photographer?: string; photographer_url?: string; src?: Record<string, string> }
interface PexelsVideoFile { quality?: string | null; file_type?: string; width?: number | null; height?: number | null; fps?: number | null; link: string }
interface PexelsVideo { id: number; width: number; height: number; url: string; duration?: number; image?: string; user?: { name?: string; url?: string }; video_files?: PexelsVideoFile[] }

const pexelsLicense = () => licenseInfo("PEXELS");

export function parsePexelsPhotos(json: unknown): SearchResult[] {
  return ((json as { photos?: PexelsPhoto[] } | null)?.photos ?? []).filter((p) => p?.src?.original).map((p) => {
    const title = p.alt || titleFromSlug(p.url);
    const candidate: Candidate = {
      provider: "pexels", providerAssetId: `photo-${p.id}`, kind: "image", title, description: p.alt ?? "", tags: [],
      previewUrl: p.src!.medium ?? p.src!.large ?? p.src!.original!, downloadUrl: p.src!.original!, width: p.width ?? null, height: p.height ?? null,
      durationSec: null, license: { ...pexelsLicense(), attributionText: `Photo by ${p.photographer ?? "unknown"} on Pexels — ${p.url}` },
      author: p.photographer ? { name: p.photographer, url: p.photographer_url ?? null } : null, sourcePageUrl: p.url, retrievedAt: nowIso(), youtube: null,
    };
    return { candidate, raw: { year: null } };
  });
}

/** mp4, width ≤ 1920, fps ≤ 30 (largest such); falls back to the smallest mp4 above the limits. */
export function pickPexelsFile(files: readonly PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4 = files.filter((f) => (f.file_type ?? "video/mp4") === "video/mp4" && f.link);
  const ok = mp4.filter((f) => (f.width ?? 0) <= 1920 && (f.fps ?? 30) <= 30.5).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  if (ok[0]) return ok[0];
  return mp4.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0] ?? null;
}

export function parsePexelsVideos(json: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  for (const v of (json as { videos?: PexelsVideo[] } | null)?.videos ?? []) {
    const f = pickPexelsFile(v.video_files ?? []);
    if (!f) continue;
    const title = titleFromSlug(v.url);
    const candidate: Candidate = {
      provider: "pexels", providerAssetId: `video-${v.id}`, kind: "video", title, description: "", tags: [], previewUrl: v.image ?? "",
      downloadUrl: f.link, width: f.width ?? v.width ?? null, height: f.height ?? v.height ?? null, durationSec: v.duration ?? null,
      license: { ...pexelsLicense(), attributionText: `Video by ${v.user?.name ?? "unknown"} on Pexels — ${v.url}` },
      author: v.user?.name ? { name: v.user.name, url: v.user.url ?? null } : null, sourcePageUrl: v.url, retrievedAt: nowIso(), youtube: null,
    };
    out.push({ candidate, raw: { year: null, fps: f.fps ?? null } });
  }
  return out;
}

export function pexelsUrl(q: AssetQuery): string {
  const base = q.kind === "video" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
  return `${base}?${qs({ query: q.text, orientation: q.orientation === "portrait" ? "portrait" : "landscape", size: "large", per_page: Math.min(20, q.limit) })}`;
}

export const pexelsProvider: AssetProvider = {
  id: "pexels", kinds: ["image", "video"], needsKey: true, paid: false, costPerCallUsd: 0, limits: { perHour: 200, concurrency: 2 },
  isConfigured: (s) => Boolean(s.pexels),
  async search(q, ctx) {
    if (q.kind === "audio" || !ctx.secrets.pexels) return [];
    const json = await ctx.http.getJson<unknown>(pexelsUrl(q), { signal: ctx.signal, headers: { authorization: ctx.secrets.pexels }, cacheTtlSec: 3600 });
    return q.kind === "video" ? parsePexelsVideos(json) : parsePexelsPhotos(json);
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};

// ------------------------------------------------------------------------------------------------ Pixabay
interface PixabayImage { id: number; pageURL: string; tags?: string; previewURL?: string; webformatURL?: string; largeImageURL?: string; imageWidth?: number; imageHeight?: number; user?: string; user_id?: number }
interface PixabayVideoSize { url: string; width: number; height: number; thumbnail?: string }
interface PixabayVideo { id: number; pageURL: string; tags?: string; duration?: number; videos?: Partial<Record<"large" | "medium" | "small" | "tiny", PixabayVideoSize>>; user?: string }

const pixabayLicense = () => licenseInfo("PIXABAY");
const splitTags = (t?: string) => (t ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function parsePixabayImages(json: unknown): SearchResult[] {
  return ((json as { hits?: PixabayImage[] } | null)?.hits ?? []).filter((h) => h?.largeImageURL).map((h) => {
    // largeImageURL is scaled to 1280 px on the long edge.
    const w0 = h.imageWidth ?? null;
    const h0 = h.imageHeight ?? null;
    const scale = w0 && h0 ? Math.min(1, 1280 / Math.max(w0, h0)) : 1;
    const candidate: Candidate = {
      provider: "pixabay", providerAssetId: `image-${h.id}`, kind: "image", title: titleFromSlug(h.pageURL), description: "", tags: splitTags(h.tags),
      previewUrl: h.webformatURL ?? h.previewURL ?? h.largeImageURL!, downloadUrl: h.largeImageURL!,
      width: w0 ? Math.round(w0 * scale) : null, height: h0 ? Math.round(h0 * scale) : null, durationSec: null,
      license: { ...pixabayLicense(), attributionText: `Image by ${h.user ?? "unknown"} from Pixabay — ${h.pageURL}` },
      author: h.user ? { name: h.user, url: h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : null } : null,
      sourcePageUrl: h.pageURL, retrievedAt: nowIso(), youtube: null,
    };
    return { candidate, raw: { year: null } };
  });
}

export function parsePixabayVideos(json: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  for (const h of (json as { hits?: PixabayVideo[] } | null)?.hits ?? []) {
    const v = h.videos ?? {};
    const pick = (v.large && v.large.width <= 1920 && v.large.url ? v.large : null) ?? (v.medium?.url ? v.medium : null) ?? (v.small?.url ? v.small : null);
    if (!pick) continue;
    const candidate: Candidate = {
      provider: "pixabay", providerAssetId: `video-${h.id}`, kind: "video", title: titleFromSlug(h.pageURL), description: "", tags: splitTags(h.tags),
      previewUrl: pick.thumbnail ?? v.medium?.thumbnail ?? "", downloadUrl: pick.url, width: pick.width || null, height: pick.height || null,
      durationSec: h.duration ?? null, license: { ...pixabayLicense(), attributionText: `Video by ${h.user ?? "unknown"} from Pixabay — ${h.pageURL}` },
      author: h.user ? { name: h.user, url: null } : null, sourcePageUrl: h.pageURL, retrievedAt: nowIso(), youtube: null,
    };
    out.push({ candidate, raw: { year: null } });
  }
  return out;
}

export function pixabayUrl(q: AssetQuery, key: string): string {
  const base = q.kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
  return `${base}?${qs({ key, q: q.text.slice(0, 100), image_type: q.kind === "video" ? null : "photo", orientation: q.kind === "video" ? null : "horizontal", safesearch: "true", per_page: Math.max(3, Math.min(30, q.limit)) })}`;
}

export const pixabayProvider: AssetProvider = {
  id: "pixabay", kinds: ["image", "video"], needsKey: true, paid: false, costPerCallUsd: 0, limits: { perMin: 100, concurrency: 2 },
  isConfigured: (s) => Boolean(s.pixabay),
  async search(q, ctx) {
    if (q.kind === "audio" || !ctx.secrets.pixabay) return [];
    const json = await ctx.http.getJson<unknown>(pixabayUrl(q, ctx.secrets.pixabay), { signal: ctx.signal, cacheTtlSec: 86_400 });
    return q.kind === "video" ? parsePixabayVideos(json) : parsePixabayImages(json);
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};
