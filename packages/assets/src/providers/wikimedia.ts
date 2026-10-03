// Wikimedia Commons (keyless; contact User-Agent). Identity search uses structured data: haswbstatement:P180=<QID>.
import type { AssetProvider, AssetQuery, Candidate, LicenseRestriction } from "@docmaker/core";
import { licenseInfo, parseCcLicense } from "../license";
import { nowIso, stripHtml } from "../util";
import { downloadOriginal, qs, yearOf, type SearchResult } from "./common";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const EXT_FILTER = "LicenseShortName|UsageTerms|AttributionRequired|Artist|Credit|LicenseUrl|DateTimeOriginal|ImageDescription|Restrictions";
const OK_MIME = new Set(["image/jpeg", "image/png", "image/tiff", "image/webp"]);

type Meta = Record<string, { value?: unknown } | undefined>;
interface CommonsPage {
  pageid?: number; title?: string; index?: number;
  imageinfo?: { url?: string; width?: number; height?: number; thumburl?: string; mime?: string; descriptionurl?: string; extmetadata?: Meta; size?: number }[];
}

const mv = (m: Meta | undefined, k: string): string => {
  const v = m?.[k]?.value;
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
};

/** Thumbnail widths upload.wikimedia.org serves without throttling (https://w.wiki/GHai); other widths get HTTP 400/429. */
export const COMMONS_THUMB_STEPS: readonly number[] = [3840, 1920, 1280, 960, 500, 330, 250, 120];

/** The largest standard step strictly below the original width (thumbnails are never upscaled); null when there is none. */
export function commonsThumbStep(width: number | null | undefined): number | null {
  const w = width ?? 0;
  return COMMONS_THUMB_STEPS.find((s) => s < w) ?? null;
}

const THUMB_WIDTH_RE = /(\/(?:(?:lossy|lossless)-)?(?:page\d+-)?)\d+px-([^/?]+)(\?.*)?$/;
const ORIGINAL_RE = /^(https:\/\/[^/]+\/wikipedia\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?]+)(\?.*)?$/i;

/** Thumbnail URL built from an original upload.wikimedia.org URL (JPEG/PNG/TIFF; null for other formats or hosts). */
export function commonsThumbFromOriginal(url: string, step: number): string | null {
  const m = ORIGINAL_RE.exec(url);
  if (!m) return null;
  const [, base, hash, name] = m as unknown as [string, string, string, string];
  if (/\.(jpe?g|png)$/i.test(name)) return `${base}/thumb/${hash}/${name}/${step}px-${name}`;
  if (/\.tiff?$/i.test(name)) return `${base}/thumb/${hash}/${name}/lossy-page1-${step}px-${name}.jpg`;
  return null;
}

/**
 * What to download for a Commons file: always a thumbnail at a standard step (3840 for files wider than 3840, else the next
 * step down), never the original — upload.wikimedia.org throttles originals (HTTP 429, Retry-After 600). The width/height
 * returned are those of the file that will actually be fetched (TIFF/PDF thumbnails keep their lossy-pageN- prefix).
 */
export function commonsDownload(ii: { url?: string; width?: number; height?: number; thumburl?: string }): { url: string; width: number | null; height: number | null } {
  const url = ii.url ?? "";
  const w = ii.width ?? null;
  const h = ii.height ?? null;
  const step = commonsThumbStep(w);
  if (step !== null && w) {
    const scaled = { width: step, height: h ? Math.round((h * step) / w) : null };
    if (ii.thumburl && THUMB_WIDTH_RE.test(ii.thumburl)) return { url: ii.thumburl.replace(THUMB_WIDTH_RE, `$1${step}px-$2$3`), ...scaled };
    const built = commonsThumbFromOriginal(url, step);
    if (built) return { url: built, ...scaled };
  }
  return { url, width: w, height: h };
}

/** The download URL alone (see commonsDownload). */
export function commonsDownloadUrl(ii: { url?: string; width?: number; height?: number; thumburl?: string }): string {
  return commonsDownload(ii).url;
}

export function parseCommons(json: unknown): SearchResult[] {
  const pages = ((json as { query?: { pages?: CommonsPage[] } } | null)?.query?.pages ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: SearchResult[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii?.url || !OK_MIME.has(ii.mime ?? "")) continue;
    const m = ii.extmetadata;
    const short = mv(m, "LicenseShortName");
    const lic = parseCcLicense(short) ?? parseCcLicense(mv(m, "UsageTerms")) ?? parseCcLicense(mv(m, "LicenseUrl"));
    const restrictions: LicenseRestriction[] = /personality/i.test(mv(m, "Restrictions")) ? ["personality"] : [];
    if (/trademark/i.test(mv(m, "Restrictions"))) restrictions.push("trademark");
    const artist = stripHtml(mv(m, "Artist")) || null;
    const dl = commonsDownload(ii);
    const title = (p.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
    const license = lic
      ? licenseInfo(lic.code, { version: lic.version, url: mv(m, "LicenseUrl") || null, restrictions })
      : licenseInfo("UNKNOWN", { restrictions: [...restrictions, "unknown-rights"] });
    if (lic && mv(m, "AttributionRequired") === "true") license.attributionRequired = true;
    const candidate: Candidate = {
      provider: "wikimedia", providerAssetId: String(p.pageid ?? p.title ?? ii.url), kind: "image", title,
      description: stripHtml(mv(m, "ImageDescription")).slice(0, 500), tags: [], previewUrl: ii.thumburl ?? ii.url,
      downloadUrl: dl.url, width: dl.width, height: dl.height, durationSec: null, license,
      author: artist ? { name: artist, url: null } : null, sourcePageUrl: ii.descriptionurl ?? "", retrievedAt: nowIso(), youtube: null,
    };
    out.push({ candidate, raw: { year: yearOf(stripHtml(mv(m, "DateTimeOriginal"))), credit: stripHtml(mv(m, "Credit")), data: p } });
  }
  return out;
}

export function commonsUrl(q: AssetQuery): string {
  const search = q.entityQid ? `haswbstatement:P180=${q.entityQid} filetype:bitmap` : `${q.text} filetype:bitmap`;
  return `${COMMONS_API}?${qs({
    action: "query", format: "json", formatversion: 2, generator: "search", gsrsearch: search, gsrnamespace: 6,
    gsrlimit: Math.min(50, Math.max(1, q.limit)), prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: 960,
    iiextmetadatafilter: EXT_FILTER, iiextmetadatalanguage: q.lang ?? "en",
  })}`;
}

export const wikimediaProvider: AssetProvider = {
  id: "wikimedia", kinds: ["image"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { perMin: 200, concurrency: 3 },
  isConfigured: () => true,
  async search(q, ctx) {
    if (q.kind !== "image") return [];
    const parsed = parseCommons(await ctx.http.getJson<unknown>(commonsUrl(q), { signal: ctx.signal, cacheTtlSec: 3600 }));
    // Results of a structured "depicts" query carry the QID (identity evidence for portraits).
    const results = q.entityQid ? parsed.map((r) => ({ ...r, raw: { ...(r.raw as object), p180: q.entityQid } })) : parsed;
    // Identity queries also try the plain name when structured data returns nothing.
    if (results.length === 0 && q.entityQid && q.text) {
      return parseCommons(await ctx.http.getJson<unknown>(commonsUrl({ ...q, entityQid: null }), { signal: ctx.signal, cacheTtlSec: 3600 }));
    }
    return results;
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};
