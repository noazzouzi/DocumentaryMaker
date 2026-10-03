// Wikimedia Commons (keyless; contact User-Agent). Identity search uses structured data: haswbstatement:P180=<QID>.
import type { AssetProvider, AssetQuery, Candidate, LicenseRestriction } from "@docmaker/core";
import { licenseInfo, parseCcLicense } from "../license";
import { nowIso, stripHtml } from "../util";
import { downloadOriginal, qs, yearOf, type SearchResult } from "./common";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const EXT_FILTER = "LicenseShortName|UsageTerms|AttributionRequired|Artist|Credit|LicenseUrl|DateTimeOriginal|ImageDescription|Restrictions";
const OK_MIME = new Set(["image/jpeg", "image/png", "image/tiff", "image/webp"]);
const MAX_EDGE = 3840;

type Meta = Record<string, { value?: unknown } | undefined>;
interface CommonsPage {
  pageid?: number; title?: string; index?: number;
  imageinfo?: { url?: string; width?: number; height?: number; thumburl?: string; mime?: string; descriptionurl?: string; extmetadata?: Meta; size?: number }[];
}

const mv = (m: Meta | undefined, k: string): string => {
  const v = m?.[k]?.value;
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
};

/** Original when ≤ 3840 px wide, else the 3840 px thumbnail (Commons serves arbitrary widths). */
export function commonsDownloadUrl(ii: { url?: string; width?: number; thumburl?: string }): string {
  const url = ii.url ?? "";
  if ((ii.width ?? 0) <= MAX_EDGE || !ii.thumburl) return url;
  return ii.thumburl.replace(/\/(\d+)px-([^/?]+)(\?.*)?$/, `/${MAX_EDGE}px-$2$3`);
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
    const title = (p.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
    const license = lic
      ? licenseInfo(lic.code, { version: lic.version, url: mv(m, "LicenseUrl") || null, restrictions })
      : licenseInfo("UNKNOWN", { restrictions: [...restrictions, "unknown-rights"] });
    if (lic && mv(m, "AttributionRequired") === "true") license.attributionRequired = true;
    const candidate: Candidate = {
      provider: "wikimedia", providerAssetId: String(p.pageid ?? p.title ?? ii.url), kind: "image", title,
      description: stripHtml(mv(m, "ImageDescription")).slice(0, 500), tags: [], previewUrl: ii.thumburl ?? ii.url,
      downloadUrl: commonsDownloadUrl(ii), width: ii.width ? Math.min(ii.width, MAX_EDGE) : null,
      height: ii.width && ii.height ? Math.round(ii.height * Math.min(1, MAX_EDGE / ii.width)) : ii.height ?? null, durationSec: null, license,
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
    gsrlimit: Math.min(50, Math.max(1, q.limit)), prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: 768,
    iiextmetadatafilter: EXT_FILTER, iiextmetadatalanguage: q.lang ?? "en",
  })}`;
}

export const wikimediaProvider: AssetProvider = {
  id: "wikimedia", kinds: ["image"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { perMin: 200, concurrency: 3 },
  isConfigured: () => true,
  async search(q, ctx) {
    if (q.kind !== "image") return [];
    const results = parseCommons(await ctx.http.getJson<unknown>(commonsUrl(q), { signal: ctx.signal, cacheTtlSec: 3600 }));
    // Identity queries also try the plain name when structured data returns nothing.
    if (results.length === 0 && q.entityQid && q.text) {
      return parseCommons(await ctx.http.getJson<unknown>(commonsUrl({ ...q, entityQid: null }), { signal: ctx.signal, cacheTtlSec: 3600 }));
    }
    return results;
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};
