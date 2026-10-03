// Keyless archives: Internet Archive, NASA Image Library, Library of Congress.
import { DocmakerError } from "@docmaker/core";
import type { AssetProvider, AssetQuery, Candidate } from "@docmaker/core";
import { licenseInfo, parseCcLicense } from "../license";
import { nowIso, stripHtml } from "../util";
import { downloadOriginal, qs, yearOf, type SearchResult } from "./common";

// ------------------------------------------------------------------------------------------------ Internet Archive
export const IA = "https://archive.org";
interface IaDoc { identifier: string; title?: string; licenseurl?: string; collection?: string | string[]; mediatype?: string; year?: string | number; date?: string }
interface IaFile { name: string; format?: string; source?: string; size?: string; length?: string; width?: string; height?: string }

export function iaSearchUrl(q: AssetQuery): string {
  const media = q.kind === "video" ? "movies" : "image";
  const terms = q.text.replace(/[()":]/g, " ").trim();
  return `${IA}/advancedsearch.php?${qs({ q: `(${terms}) AND mediatype:(${media})`, rows: Math.min(50, q.limit * 2), output: "json" })}&${["identifier", "title", "licenseurl", "collection", "mediatype", "year", "date"].map((f) => `fl[]=${f}`).join("&")}`;
}

export function parseIaSearch(json: unknown): IaDoc[] {
  return ((json as { response?: { docs?: IaDoc[] } } | null)?.response?.docs ?? []).filter((d) => typeof d?.identifier === "string");
}

/** Best derivative from an item's metadata: h.264 MP4 ≤ 1080p (largest) for video; the largest JPEG for images. */
export function parseIaMetadata(json: unknown, kind: "image" | "video", doc?: IaDoc): SearchResult | null {
  const j = json as { metadata?: Record<string, unknown>; files?: IaFile[] } | null;
  const md = j?.metadata ?? {};
  const id = String(md.identifier ?? doc?.identifier ?? "");
  if (!id) return null;
  const files = j?.files ?? [];
  let best: IaFile | undefined;
  if (kind === "video") {
    best = files
      .filter((f) => /\.mp4$/i.test(f.name) && /h\.264|mpeg4/i.test(f.format ?? "") && Number(f.height ?? 0) <= 1080)
      .sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0) || Number(/h\.264/i.test(b.format ?? "")) - Number(/h\.264/i.test(a.format ?? "")))[0];
  } else {
    best = files.filter((f) => /\.jpe?g$/i.test(f.name) && !/thumb/i.test(f.format ?? "") && !f.name.includes(".thumbs/"))
      .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }
  if (!best) return null;
  const licUrl = String(md.licenseurl ?? doc?.licenseurl ?? "");
  const lic = parseCcLicense(licUrl);
  const license = lic ? licenseInfo(lic.code, { version: lic.version, url: licUrl || null }) : licenseInfo("UNKNOWN", { restrictions: ["unknown-rights"] });
  const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/;\s*/) : []);
  const candidate: Candidate = {
    provider: "internet-archive", providerAssetId: `${id}/${best.name}`, kind, title: String(md.title ?? doc?.title ?? id),
    description: stripHtml(String(md.description ?? "")).slice(0, 500), tags: asList(md.subject).map((s) => s.trim()).filter(Boolean),
    previewUrl: `${IA}/services/img/${encodeURIComponent(id)}`, downloadUrl: `${IA}/download/${encodeURIComponent(id)}/${best.name.split("/").map(encodeURIComponent).join("/")}`,
    width: best.width ? Number(best.width) : null, height: best.height ? Number(best.height) : null,
    durationSec: best.length ? Number(best.length) || null : null, license,
    author: md.creator ? { name: String(Array.isArray(md.creator) ? md.creator[0] : md.creator), url: null } : null,
    sourcePageUrl: `${IA}/details/${encodeURIComponent(id)}`, retrievedAt: nowIso(), youtube: null,
  };
  return { candidate, raw: { year: yearOf(md.year ?? md.date ?? doc?.year ?? doc?.date), collection: md.collection ?? doc?.collection ?? null } };
}

export const internetArchiveProvider: AssetProvider = {
  id: "internet-archive", kinds: ["video", "image"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { perMin: 30, concurrency: 2 },
  isConfigured: () => true,
  async search(q, ctx) {
    if (q.kind === "audio") return [];
    const docs = parseIaSearch(await ctx.http.getJson<unknown>(iaSearchUrl(q), { signal: ctx.signal, cacheTtlSec: 3600 })).slice(0, Math.min(6, q.limit));
    const out: SearchResult[] = [];
    for (const d of docs) {
      try {
        const meta = await ctx.http.getJson<unknown>(`${IA}/metadata/${encodeURIComponent(d.identifier)}`, { signal: ctx.signal, cacheTtlSec: 86_400 });
        const r = parseIaMetadata(meta, q.kind as "image" | "video", d);
        if (r) out.push(r);
      } catch (e) {
        ctx.logger.debug("internet-archive metadata failed", { id: d.identifier, error: (e as Error).message });
      }
    }
    return out;
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};

// ------------------------------------------------------------------------------------------------ NASA
export const NASA_API = "https://images-api.nasa.gov";
interface NasaItem { href?: string; data?: { nasa_id?: string; title?: string; description?: string; keywords?: string[]; media_type?: string; date_created?: string; photographer?: string; center?: string }[]; links?: { href?: string; rel?: string; render?: string }[] }

export function parseNasa(json: unknown, kind: "image" | "video"): SearchResult[] {
  const items = (json as { collection?: { items?: NasaItem[] } } | null)?.collection?.items ?? [];
  const out: SearchResult[] = [];
  for (const it of items) {
    const d = it.data?.[0];
    if (!d?.nasa_id || d.media_type !== kind || !it.href) continue;
    const license = licenseInfo("PDM", { restrictions: ["no-endorsement"], attributionText: `${d.title ?? d.nasa_id} — NASA${d.center ? ` (${d.center})` : ""}` });
    const candidate: Candidate = {
      provider: "nasa", providerAssetId: d.nasa_id, kind, title: d.title ?? d.nasa_id, description: stripHtml(d.description ?? "").slice(0, 500),
      tags: d.keywords ?? [], previewUrl: it.links?.find((l) => l.rel === "preview")?.href ?? "", downloadUrl: it.href,
      width: null, height: null, durationSec: null, license, author: { name: d.photographer || "NASA", url: null },
      sourcePageUrl: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, retrievedAt: nowIso(), youtube: null,
    };
    out.push({ candidate, raw: { year: yearOf(d.date_created), manifest: it.href } });
  }
  return out;
}

/** Asset manifest (collection.json: list of URLs) → the file to download. */
export function pickNasaAsset(urls: string[], kind: "image" | "video"): string | null {
  const order = kind === "image" ? ["~orig.jpg", "~large.jpg", "~medium.jpg", "~orig.png"] : ["~orig.mp4", "~large.mp4", "~medium.mp4", "~mobile.mp4"];
  for (const suffix of order) {
    const u = urls.find((x) => x.toLowerCase().endsWith(suffix));
    if (u) return u.replace(/^http:/, "https:").replace(/ /g, "%20");
  }
  return null;
}

export const nasaProvider: AssetProvider = {
  id: "nasa", kinds: ["image", "video"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { perMin: 60, concurrency: 2 },
  isConfigured: () => true,
  async search(q, ctx) {
    if (q.kind === "audio") return [];
    const url = `${NASA_API}/search?${qs({ q: q.text, media_type: q.kind, page_size: Math.min(50, q.limit) })}`;
    return parseNasa(await ctx.http.getJson<unknown>(url, { signal: ctx.signal, cacheTtlSec: 3600 }), q.kind);
  },
  async fetchOriginal(c, destDir, ctx) {
    const urls = await ctx.http.getJson<string[]>(c.downloadUrl.replace(/^http:/, "https:"), { signal: ctx.signal });
    const file = pickNasaAsset(Array.isArray(urls) ? urls : [], c.kind as "image" | "video");
    if (!file) throw new DocmakerError("PROVIDER_ERROR", `NASA asset ${c.providerAssetId} has no usable file`);
    return downloadOriginal(c, destDir, ctx, { url: file });
  },
};

// ------------------------------------------------------------------------------------------------ Library of Congress
export const LOC = "https://www.loc.gov";
interface LocResult { id?: string; title?: string; url?: string; date?: string; image_url?: string[]; subject?: string[]; contributor?: string[]; description?: string[]; item?: { rights_advisory?: string | string[]; restriction?: string }; original_format?: string[] }

/** Largest image_url[] entry ≤ 3840 px (entries carry #h=…&w=…). */
export function pickLocImage(urls: string[]): { url: string; w: number | null; h: number | null } | null {
  const parsed = urls.map((u) => {
    const m = /#h=(\d+)&w=(\d+)/.exec(u);
    return { url: u.split("#")[0]!, h: m ? Number(m[1]) : null, w: m ? Number(m[2]) : null };
  }).filter((x) => (x.w ?? 0) <= 3840);
  parsed.sort((a, b) => (b.w ?? 0) - (a.w ?? 0));
  return parsed[0] ?? null;
}

export function parseLoc(json: unknown): SearchResult[] {
  const results = (json as { results?: LocResult[] } | null)?.results ?? [];
  const out: SearchResult[] = [];
  for (const r of results) {
    if (!r.image_url?.length || !r.id) continue;
    const img = pickLocImage(r.image_url);
    if (!img) continue;
    const advisory = Array.isArray(r.item?.rights_advisory) ? r.item!.rights_advisory.join(" ") : r.item?.rights_advisory ?? "";
    const pd = /no known restrictions/i.test(advisory);
    const license = pd ? licenseInfo("PDM", { url: null }) : licenseInfo("UNKNOWN", { restrictions: ["unknown-rights"] });
    const candidate: Candidate = {
      provider: "loc", providerAssetId: r.id, kind: "image", title: r.title ?? "", description: (r.description ?? []).join(" ").slice(0, 500),
      tags: r.subject ?? [], previewUrl: r.image_url[0]!.split("#")[0]!, downloadUrl: img.url, width: img.w, height: img.h, durationSec: null,
      license: { ...license, attributionText: `${r.title ?? "Untitled"} — Library of Congress${r.contributor?.[0] ? `, ${r.contributor[0]}` : ""} — ${r.url ?? r.id}` },
      author: r.contributor?.[0] ? { name: r.contributor[0], url: null } : null, sourcePageUrl: r.url ?? r.id, retrievedAt: nowIso(), youtube: null,
    };
    out.push({ candidate, raw: { year: yearOf(r.date), rights: advisory } });
  }
  return out;
}

export const locProvider: AssetProvider = {
  id: "loc", kinds: ["image"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { perMin: 15, concurrency: 1 },
  isConfigured: () => true,
  async search(q, ctx) {
    if (q.kind !== "image") return [];
    const url = `${LOC}/photos/?${qs({ q: q.localText ? `${q.text} ${q.localText}` : q.text, fo: "json", c: 25 })}`;
    return parseLoc(await ctx.http.getJson<unknown>(url, { signal: ctx.signal, cacheTtlSec: 86_400 }));
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};
