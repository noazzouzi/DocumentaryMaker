// Media URLs (§10.11): `${base}/${projectRel}?v=${assetId.slice(0,12)}`. The ?v= busts browser caches when a path is
// reused (e.g. program/<lang>/vo_program.wav after a new take); servers ignore it. Never absolute filesystem paths.
import type { Timeline } from "@docmaker/core";

export function joinUrl(base: string, rel: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const r = rel.replace(/^\/+/, "");
  const encoded = r.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `${b}/${encoded}`;
}

/** URL of a timeline asset, or null when the id is not in `t.assets` (callers degrade to a solid/backdrop). */
export function assetUrl(t: Pick<Timeline, "assets">, assetId: string | null | undefined, base: string): string | null {
  if (!assetId) return null;
  const a = t.assets[assetId];
  if (!a) return null;
  return `${joinUrl(base, a.projectRel)}?v=${assetId.slice(0, 12)}`;
}

/** Resolves a style-font URL: absolute (scheme or leading "/") as is, else relative to the asset server base. */
export function resolveFontUrl(url: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/")) return url;
  return joinUrl(base, url);
}
