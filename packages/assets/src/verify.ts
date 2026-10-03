// Quote verification against source pages (§6.3 1b): readability + linkedom, normWord tokens, local alignment.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import pLimit from "p-limit";
import { isDocmakerError } from "@docmaker/core";
import type { FactSheet, HttpClient, QuoteVerification, VerificationItem } from "@docmaker/core";
import { smithWaterman, tokenize } from "./youtube/passage";
import { errMsg } from "./util";

export const VERBATIM_RATIO = 0.92;
export const FUZZY_RATIO = 0.75;

/** Main text of an HTML page (Readability; falls back to body text). */
export function extractPageText(html: string, url: string): string {
  try {
    const { document } = parseHTML(html);
    try {
      // linkedom documents have no documentURI; Readability only needs it for relative links.
      Object.defineProperty(document, "documentURI", { value: url, configurable: true });
    } catch { /* read-only in some versions */ }
    const art = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    const text = art?.textContent?.trim();
    if (text && text.length > 0) return text;
    return (parseHTML(html).document.body?.textContent ?? "").trim();
  } catch {
    return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }
}

/** Ratio of quote tokens found in order in the page (exact tokens). */
export function quoteMatchRatio(quote: string, pageText: string): number {
  const q = tokenize(quote);
  if (q.length === 0) return 0;
  const al = smithWaterman(q, tokenize(pageText), { fuzzy: false });
  return al ? al.matched / q.length : 0;
}

export function classifyRatio(r: number): QuoteVerification {
  return r >= VERBATIM_RATIO ? "verbatim" : r >= FUZZY_RATIO ? "fuzzy" : "not-found";
}

/** Offline/fixture → every quote stays "unchecked" with items {check:"quote-verbatim", ok:false, detail:"skipped-offline"}; zero requests. */
export async function verifyQuotes(fs: FactSheet, ctx: { http: HttpClient | null; offline: boolean; signal: AbortSignal }): Promise<{ factSheet: FactSheet; items: VerificationItem[] }> {
  if (ctx.offline || ctx.http === null) {
    return {
      factSheet: fs,
      items: fs.quotes.map((q) => ({ ref: q.id, check: "quote-verbatim" as const, ok: false, detail: "skipped-offline" })),
    };
  }
  const http = ctx.http;
  const sources = new Map(fs.sources.map((s) => [s.id, s]));
  const pages = new Map<string, Promise<{ text: string } | { error: string }>>();
  const limit = pLimit(3);
  const page = (url: string) => {
    let p = pages.get(url);
    if (!p) {
      p = limit(async () => {
        try {
          const html = await http.getText(url, { signal: ctx.signal, cacheTtlSec: 86_400, maxBytes: 20 * 1024 * 1024 });
          return { text: extractPageText(html, url) };
        } catch (e) {
          if (isDocmakerError(e) && e.code === "CANCELED") throw e;
          return { error: errMsg(e) };
        }
      });
      pages.set(url, p);
    }
    return p;
  };
  const items: VerificationItem[] = [];
  const quotes = await Promise.all(fs.quotes.map(async (q) => {
    const src = sources.get(q.sourceId);
    if (!src) {
      items.push({ ref: q.id, check: "source-ref", ok: false, detail: `unknown source ${q.sourceId}` });
      return { ...q, verification: "not-found" as const };
    }
    const r = await page(src.url);
    if ("error" in r) {
      items.push({ ref: q.id, check: "quote-verbatim", ok: false, detail: `fetch-failed: ${r.error}`.slice(0, 300) });
      return { ...q, verification: "fetch-failed" as const };
    }
    const ratio = quoteMatchRatio(q.verbatim, r.text);
    const v = classifyRatio(ratio);
    items.push({ ref: q.id, check: "quote-verbatim", ok: v !== "not-found", detail: `${v} ${ratio.toFixed(2)}` });
    // A video match (verifiedBy "video") is stronger than a page match: never downgrade it.
    if (q.verifiedBy === "video") return q;
    return { ...q, verification: v, verifiedBy: v === "not-found" ? q.verifiedBy : ("page" as const) };
  }));
  for (const s of fs.sources) {
    const p = pages.get(s.url);
    if (!p) continue;
    const r = await p;
    items.push({ ref: s.id, check: "url-reachable", ok: !("error" in r), detail: "error" in r ? r.error.slice(0, 200) : "ok" });
  }
  items.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.check < b.check ? -1 : 1));
  return { factSheet: { ...fs, quotes }, items };
}
