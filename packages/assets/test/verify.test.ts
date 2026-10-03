import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@docmaker/core";
import { makeFactSheet } from "@docmaker/core/testing";
import { extractPageText, quoteMatchRatio, verifyQuotes } from "../src/index";

const spyHttp = (pages: Record<string, string | Error>) => {
  const getText = vi.fn(async (url: string) => {
    const p = pages[url];
    if (p instanceof Error || p === undefined) throw p ?? new Error("404");
    return p;
  });
  const http = { getText, getJson: vi.fn(), postForm: vi.fn(), postJson: vi.fn(), download: vi.fn() } as unknown as HttpClient;
  return { http, getText };
};

describe("verifyQuotes", () => {
  it("offline / fixture → skipped-offline items, quotes unchanged, zero requests", async () => {
    const fs = makeFactSheet({ quotes: 3 });
    const { http, getText } = spyHttp({});
    const r = await verifyQuotes(fs, { http, offline: true, signal: new AbortController().signal });
    expect(r.factSheet).toEqual(fs);
    expect(r.items).toEqual(fs.quotes.map((q) => ({ ref: q.id, check: "quote-verbatim", ok: false, detail: "skipped-offline" })));
    expect(getText).not.toHaveBeenCalled();
    const r2 = await verifyQuotes(fs, { http: null, offline: false, signal: new AbortController().signal });
    expect(r2.items.every((x) => x.detail === "skipped-offline")).toBe(true);
  });

  it("verbatim / fuzzy / not-found / fetch-failed from page text", async () => {
    const fs = makeFactSheet({ quotes: 4 });
    // Q1,Q2,Q3 cite S1; Q4 cites S2 (failing). Quotes: Q1 "It is all a fever, and fevers break." …
    fs.quotes[3] = { ...fs.quotes[3]!, sourceId: "S2" };
    const page = `<html><head><title>Tulips</title></head><body><nav>menu</nav><article><h1>The bubble</h1>
      <p>Contemporaries wrote: “It is all a fever, and fevers break.” The pamphlet continued for pages about the trade in Haarlem and elsewhere.</p>
      <p>Another said nobody knew what a bulb was worth, only what a man would pay for it at the next auction in the tavern.</p>
      <p>${"Filler sentence about the seventeenth century. ".repeat(20)}</p></article></body></html>`;
    const { http } = spyHttp({ [fs.sources[0]!.url]: page, [fs.sources[1]!.url]: new Error("ECONNRESET") });
    const r = await verifyQuotes(fs, { http, offline: false, signal: new AbortController().signal });
    const byId = Object.fromEntries(r.factSheet.quotes.map((q) => [q.id, q]));
    expect(byId.Q1!.verification).toBe("verbatim");
    expect(byId.Q1!.verifiedBy).toBe("page");
    expect(byId.Q2!.verification).toBe("fuzzy"); // "the next man would pay" vs "a man would pay … next auction"
    expect(byId.Q3!.verification).toBe("not-found");
    expect(byId.Q3!.verifiedBy).toBe("none");
    expect(byId.Q4!.verification).toBe("fetch-failed");
    expect(r.items.find((x) => x.ref === "S1")).toMatchObject({ check: "url-reachable", ok: true });
    expect(r.items.find((x) => x.ref === "S2")).toMatchObject({ check: "url-reachable", ok: false });
  });

  it("extracts readable text and scores in-order token matches", () => {
    const text = extractPageText("<html><body><article><p>Hello brave new world, said nobody at all today.</p></article></body></html>", "https://x.org/");
    expect(text).toContain("brave new world");
    expect(quoteMatchRatio("brave new world", text)).toBe(1);
    expect(quoteMatchRatio("world new brave", text)).toBeLessThan(0.75);
  });
});
