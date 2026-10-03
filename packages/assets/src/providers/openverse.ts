// Openverse (keyless; optional client credentials → bearer token). Images (and audio for music beds).
import type { AssetProvider, AssetQuery, Candidate, ProviderContext } from "@docmaker/core";
import { licenseInfo, parseCcLicense } from "../license";
import { nowIso } from "../util";
import { downloadOriginal, qs, type SearchResult } from "./common";

export const OPENVERSE_API = "https://api.openverse.org/v1";

interface OvResult {
  id: string; title?: string | null; foreign_landing_url?: string; url?: string; creator?: string | null; creator_url?: string | null;
  license?: string; license_version?: string | null; license_url?: string | null; attribution?: string | null; tags?: { name: string }[] | null;
  width?: number | null; height?: number | null; thumbnail?: string | null; duration?: number | null; mature?: boolean; source?: string;
}

export function parseOpenverse(json: unknown, kind: "image" | "audio" = "image"): SearchResult[] {
  const results = ((json as { results?: OvResult[] } | null)?.results ?? []);
  return results
    .filter((r) => r && typeof r.id === "string" && typeof r.url === "string" && r.mature !== true)
    .map((r) => {
      const lic = parseCcLicense(r.license ?? null, r.license_version ?? null);
      const license = lic
        ? licenseInfo(lic.code, { version: lic.version, url: r.license_url ?? null, attributionText: r.attribution ?? null })
        : licenseInfo("UNKNOWN", { url: r.license_url ?? null });
      const candidate: Candidate = {
        provider: "openverse", providerAssetId: r.id, kind, title: r.title ?? "", description: "",
        tags: (r.tags ?? []).map((t) => t.name).filter((t) => typeof t === "string"), previewUrl: r.thumbnail ?? r.url!, downloadUrl: r.url!,
        width: r.width ?? null, height: r.height ?? null, durationSec: typeof r.duration === "number" ? r.duration / 1000 : null, license,
        author: r.creator ? { name: r.creator, url: r.creator_url ?? null } : null, sourcePageUrl: r.foreign_landing_url ?? "",
        retrievedAt: nowIso(), youtube: null,
      };
      return { candidate, raw: { year: null, source: r.source ?? null, data: r } };
    });
}

const tokens = new Map<string, { token: string; expires: number }>();
async function bearer(ctx: ProviderContext): Promise<string | null> {
  const id = ctx.secrets.openverseClientId;
  const secret = ctx.secrets.openverseClientSecret;
  if (!id || !secret) return null;
  const hit = tokens.get(id);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  try {
    const r = await ctx.http.postForm<{ access_token: string; expires_in: number }>(`${OPENVERSE_API}/auth_tokens/token/`, { client_id: id, client_secret: secret, grant_type: "client_credentials" }, { signal: ctx.signal });
    tokens.set(id, { token: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 });
    return r.access_token;
  } catch (e) {
    ctx.logger.warn("openverse token request failed; using anonymous access", { error: (e as Error).message });
    return null;
  }
}

export function openverseUrl(q: AssetQuery): string {
  const audio = q.kind === "audio";
  return `${OPENVERSE_API}/${audio ? "audio" : "images"}/?${qs({
    q: q.text, license_type: "commercial,modification", aspect_ratio: !audio && q.orientation === "landscape" ? "wide" : null,
    size: audio ? null : "large", mature: "false", page_size: Math.min(20, Math.max(1, q.limit)),
  })}`;
}

export const openverseProvider: AssetProvider = {
  id: "openverse", kinds: ["image", "audio"], needsKey: false, paid: false, costPerCallUsd: 0,
  limits: { perMin: 20, perDay: 200, concurrency: 2 },
  isConfigured: () => true,
  async search(q, ctx) {
    if (q.kind === "video") return [];
    const token = await bearer(ctx);
    const json = await ctx.http.getJson<unknown>(openverseUrl(q), { signal: ctx.signal, headers: token ? { authorization: `Bearer ${token}` } : undefined, cacheTtlSec: 3600 });
    return parseOpenverse(json, q.kind === "audio" ? "audio" : "image");
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};
