// resolveEntity (§6.3 1b): keyless Wikidata wbsearchentities → QID + label + aliases. Offline → null.
import { isDocmakerError, normWord } from "@docmaker/core";
import type { HttpClient, Lang } from "@docmaker/core";
import { qs } from "./providers/common";

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

interface WbSearch { search?: { id?: string; label?: string; description?: string; aliases?: string[]; match?: { type?: string; text?: string } }[] }
interface WbEntities { entities?: Record<string, { labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims?: Record<string, unknown[]> }> }

/** Prefers an exact label/alias match; humans (description hints) win ties. */
export function pickEntity(json: unknown, name: string): { qid: string; label: string } | null {
  const hits = ((json as WbSearch | null)?.search ?? []).filter((h) => typeof h.id === "string" && /^Q\d+$/.test(h.id!));
  if (hits.length === 0) return null;
  const n = normWord(name.replace(/\s+/g, ""));
  const exact = hits.filter((h) => normWord((h.match?.text ?? h.label ?? "").replace(/\s+/g, "")) === n);
  const pool = exact.length > 0 ? exact : hits;
  const human = pool.find((h) => /\b(actor|actress|singer|politician|businessman|businesswoman|entrepreneur|writer|journalist|athlete|player|musician|director|producer|presenter|youtuber|person|lawyer|judge|scientist|artist|botanist|chef|model)\b/i.test(h.description ?? ""));
  const h = human ?? pool[0]!;
  return { qid: h.id!, label: h.label ?? name };
}

export async function resolveEntity(name: string, lang: Lang, ctx: { http: HttpClient; signal: AbortSignal }): Promise<{ qid: string; label: string; aliases: string[] } | null> {
  const q = name.trim();
  if (q === "") return null;
  try {
    const search = await ctx.http.getJson<unknown>(`${WIKIDATA_API}?${qs({ action: "wbsearchentities", search: q, language: lang, uselang: lang, type: "item", limit: 7, format: "json" })}`, { signal: ctx.signal, cacheTtlSec: 7 * 86_400 });
    const hit = pickEntity(search, q);
    if (!hit) return null;
    const ent = await ctx.http.getJson<WbEntities>(`${WIKIDATA_API}?${qs({ action: "wbgetentities", ids: hit.qid, props: "labels|aliases", languages: lang === "en" ? "en|fr" : "fr|en", format: "json" })}`, { signal: ctx.signal, cacheTtlSec: 7 * 86_400 });
    const e = ent.entities?.[hit.qid];
    const label = e?.labels?.[lang]?.value ?? e?.labels?.en?.value ?? hit.label;
    const aliases = new Set<string>();
    for (const list of Object.values(e?.aliases ?? {})) for (const a of list) if (a.value && a.value !== label) aliases.add(a.value);
    for (const l of Object.values(e?.labels ?? {})) if (l.value !== label) aliases.add(l.value);
    return { qid: hit.qid, label, aliases: [...aliases].sort() };
  } catch (e) {
    if (isDocmakerError(e) && e.code === "OFFLINE") return null;
    if (isDocmakerError(e) && e.code === "CANCELED") throw e;
    throw e;
  }
}
