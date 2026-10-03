// Shared provider helpers.
import path from "node:path";
import { DocmakerError } from "@docmaker/core";
import type { AssetKind, Candidate, ProviderContext } from "@docmaker/core";
import { VIDEO_MAX_BYTES } from "../http";
import { extOf, extOfMime } from "../util";

export type SearchResult = { candidate: Candidate; raw: unknown };

/** First plausible 4-digit year in a date-ish string. */
export function yearOf(s: unknown): number | null {
  if (typeof s !== "string" && typeof s !== "number") return null;
  const m = /(1[5-9]\d{2}|20\d{2}|2100)/.exec(String(s));
  return m ? Number(m[1]) : null;
}

/** Title words from a URL slug (pexels.com/video/tulip-field-in-bloom-12345/ → "tulip field in bloom"). */
export function titleFromSlug(url: string): string {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return seg.replace(/-?\d+$/, "").replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Generic fetchOriginal: download c.downloadUrl into destDir with a sensible extension. */
export async function downloadOriginal(c: Candidate, destDir: string, ctx: ProviderContext, o?: { headers?: Record<string, string>; url?: string }): Promise<{ path: string; mime: string }> {
  const url = o?.url ?? c.downloadUrl;
  if (!url) throw new DocmakerError("PROVIDER_ERROR", `${c.provider} candidate ${c.providerAssetId} has no download URL`);
  const safe = c.providerAssetId.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);
  const urlExt = (() => {
    try {
      return extOf(new URL(url).pathname);
    } catch {
      return "";
    }
  })();
  const tmp = path.join(destDir, `${c.provider}-${safe}.download`);
  const r = await ctx.http.download(url, tmp, { signal: ctx.signal, headers: o?.headers, maxBytes: c.kind === "video" ? VIDEO_MAX_BYTES : undefined, timeoutMs: 20_000 });
  const ext = extOfMime(r.mime) ?? (urlExt || (c.kind === "video" ? "mp4" : "jpg"));
  const final = path.join(destDir, `${c.provider}-${safe}.${ext}`);
  const { rename } = await import("node:fs/promises");
  await rename(tmp, final);
  return { path: final, mime: r.mime };
}

export function kindOk(kinds: readonly AssetKind[], k: AssetKind): boolean {
  return kinds.includes(k);
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.append(k, String(v));
  return u.toString();
}
