// Provider parsers on recorded/documented JSON (§16.1), URL builders, search through a stub HttpClient, quota buckets, entities.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Candidate, DocmakerError } from "@docmaker/core";
import type { AssetQuery, HttpClient, HttpGetOptions, ProviderContext, Secrets } from "@docmaker/core";
import {
  allProviders, commonsUrl, parseBraveImages, parseCommons, parseIaMetadata, parseIaSearch, parseLoc, parseNasa, parseOpenverse,
  parsePexelsPhotos, parsePexelsVideos, parsePixabayImages, parsePixabayVideos, pickEntity, pickLocImage, pickNasaAsset, providerById,
  QuotaBuckets, resolveEntity,
} from "../src/index";
import { iaSearchUrl } from "../src/providers/archives";
import { commonsDownloadUrl } from "../src/providers/wikimedia";
import { openverseUrl } from "../src/providers/openverse";
import { pexelsUrl, pickPexelsFile, pixabayUrl } from "../src/providers/stock";
import { DATA, makeConfig, quietLogger } from "./helpers";

const j = (f: string): unknown => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));
const valid = (rs: { candidate: unknown }[]) => {
  for (const r of rs) expect(() => Candidate.parse(r.candidate)).not.toThrow();
};

const q = (o: Partial<AssetQuery> = {}): AssetQuery => ({
  beatId: "CH1-B001", kind: "image", role: "archival", text: "tulip field", localText: null, entityQid: null, personIds: [],
  orientation: "landscape", minWidth: 960, durationSec: null, limit: 20, lang: null, ...o,
});

/** Stub HttpClient: routes by URL substring, records every call. */
function stubHttp(routes: [RegExp, unknown][]): HttpClient & { urls: string[]; headers: Record<string, string>[] } {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const answer = (url: string, o: HttpGetOptions) => {
    urls.push(url);
    headers.push(o.headers ?? {});
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) throw new DocmakerError("PROVIDER_ERROR", `no stub for ${url}`);
    return structuredClone(hit[1]);
  };
  return {
    urls, headers,
    getJson: async <T>(url: string, o: HttpGetOptions) => answer(url, o) as T,
    getText: async (url: string, o: HttpGetOptions) => String(answer(url, o)),
    postForm: async <T>(url: string, _f: Record<string, string>, o: HttpGetOptions) => answer(url, o) as T,
    postJson: async <T>(url: string, _b: unknown, o: HttpGetOptions) => answer(url, o) as T,
    download: async () => { throw new Error("not used"); },
  };
}
const pctx = (http: HttpClient, secrets: Secrets = {}): ProviderContext => ({
  http, secrets, config: makeConfig({ offline: false }), logger: quietLogger(), signal: new AbortController().signal,
});

describe("registry", () => {
  it("lists the 12 providers in default priority order, procedural last", () => {
    const ids = allProviders().map((p) => p.id);
    expect(ids).toEqual(["local", "wikimedia", "openverse", "internet-archive", "nasa", "loc", "pexels", "pixabay", "youtube", "brave", "fal", "procedural"]);
    expect(providerById("loc").limits.perMin).toBe(15);
    expect(providerById("openverse").limits.perDay).toBe(200);
    expect(allProviders().filter((p) => p.paid).map((p) => p.id).sort()).toEqual(["brave", "fal"]);
    expect(() => providerById("nope" as never)).toThrow(/unknown asset provider/);
  });
});

describe("Openverse (recorded)", () => {
  it("maps licences, versions, attribution and landing pages", () => {
    const rs = parseOpenverse(j("openverse-images.json"));
    expect(rs).toHaveLength(3);
    valid(rs);
    const [a, b] = rs.map((r) => r.candidate);
    expect(a!.license).toMatchObject({ code: "CC-BY", version: "2.0", attributionRequired: true, commercialOk: true });
    expect(a!.license.attributionText).toBeTruthy();
    expect(b!.license.code).toBe("CC-BY-SA");
    expect(b!.license.restrictions).toContain("sa");
    expect(a!.sourcePageUrl).toMatch(/^https:\/\//);
    expect(a!.author?.name).toBeTruthy();
  });
  it("parses audio results (duration ms → s)", () => {
    const rs = parseOpenverse(j("openverse-audio.json"), "audio");
    expect(rs.length).toBeGreaterThan(0);
    expect(rs[0]!.candidate.kind).toBe("audio");
    expect(rs[0]!.candidate.license.code).toBe("CC0");
  });
  it("drops mature and malformed results", () => {
    expect(parseOpenverse({ results: [{ id: "x", url: "https://a/b.jpg", mature: true }, { id: 3 }, null] })).toHaveLength(0);
    expect(parseOpenverse(null)).toEqual([]);
  });
  it("builds the §7.2 query", () => {
    const u = new URL(openverseUrl(q()));
    expect(u.pathname).toBe("/v1/images/");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: "tulip field", license_type: "commercial,modification", aspect_ratio: "wide", size: "large", mature: "false", page_size: "20" });
  });
});

describe("Wikimedia Commons (recorded)", () => {
  it("parses LicenseShortName, artist HTML, personality restriction and year", () => {
    const rs = parseCommons(j("commons-search.json"));
    expect(rs).toHaveLength(3);
    valid(rs);
    const first = rs[0]!;
    expect(first.candidate.license).toMatchObject({ code: "CC-BY-SA", version: "3.0" });
    expect(first.candidate.license.restrictions).toEqual(expect.arrayContaining(["personality", "sa"]));
    expect(first.candidate.author?.name).not.toMatch(/</);
    expect((first.raw as { year: number }).year).toBe(2020);
    expect(first.candidate.title).not.toMatch(/^File:|_/);
  });
  it("downloads originals ≤ 3840 px, else a 3840 px thumbnail", () => {
    const rs = parseCommons(j("commons-search.json"));
    const big = rs[0]!.candidate;
    expect(big.downloadUrl).toMatch(/\/3840px-/);
    expect(big.width).toBe(3840);
    expect(rs[1]!.candidate.downloadUrl).toMatch(/upload\.wikimedia\.org\/wikipedia\/commons\/2\/21\//);
    expect(commonsDownloadUrl({ url: "https://u/x.jpg", width: 9000 })).toBe("https://u/x.jpg"); // no thumb → original
  });
  it("identity search uses haswbstatement:P180=<QID>; generic search filters bitmaps", () => {
    const id = new URL(commonsUrl(q({ entityQid: "Q312004", text: "Carolus Clusius" })));
    expect(id.searchParams.get("gsrsearch")).toBe("haswbstatement:P180=Q312004 filetype:bitmap");
    expect(id.searchParams.get("gsrnamespace")).toBe("6");
    expect(id.searchParams.get("iiurlwidth")).toBe("768");
    expect(id.searchParams.get("iiextmetadatafilter")).toContain("Restrictions");
    expect(new URL(commonsUrl(q())).searchParams.get("gsrsearch")).toBe("tulip field filetype:bitmap");
  });
  it("falls back to the name when structured data finds nothing", async () => {
    const http = stubHttp([[/haswbstatement/, { query: { pages: [] } }], [/commons\.wikimedia\.org/, j("commons-search.json")]]);
    const rs = await providerById("wikimedia").search(q({ entityQid: "Q1", text: "Some Name" }), pctx(http));
    expect(http.urls).toHaveLength(2);
    expect(rs).toHaveLength(3);
  });
});

describe("Internet Archive", () => {
  it("parses advancedsearch docs and builds the query", () => {
    const docs = parseIaSearch(j("ia-search.json"));
    expect(docs.length).toBeGreaterThan(0);
    const u = decodeURIComponent(iaSearchUrl(q({ kind: "video", text: 'tulips "1950"' })));
    expect(u).toContain("mediatype:(movies)");
    expect(u).toContain("fl[]=licenseurl");
    expect(u).not.toContain('"');
  });
  it("picks the h.264 MP4 for video and never the item tile for images (recorded metadata)", () => {
    const v = parseIaMetadata(j("ia-metadata.json"), "video")!;
    expect(v.candidate.downloadUrl).toBe("https://archive.org/download/Libraria1947/Libraria1947.mp4");
    expect(v.candidate.license.code).toBe("PDM");
    expect((v.raw as { year: number }).year).toBe(1947);
    expect(Candidate.parse(v.candidate)).toBeTruthy();
    expect(parseIaMetadata(j("ia-metadata.json"), "image")).toBeNull(); // only __ia_thumb.jpg / PNG in this item
  });
  it("missing licence → UNKNOWN + unknown-rights", () => {
    const r = parseIaMetadata({ metadata: { identifier: "x", title: "X" }, files: [{ name: "x.mp4", format: "h.264", height: "720" }] }, "video")!;
    expect(r.candidate.license.code).toBe("UNKNOWN");
    expect(r.candidate.license.restrictions).toContain("unknown-rights");
  });
  it("searches then reads metadata per item", async () => {
    const http = stubHttp([[/advancedsearch/, j("ia-search.json")], [/\/metadata\//, j("ia-metadata.json")]]);
    const rs = await providerById("internet-archive").search(q({ kind: "video", limit: 2 }), pctx(http));
    expect(http.urls[0]).toContain("advancedsearch.php");
    expect(http.urls.filter((u) => u.includes("/metadata/")).length).toBe(2);
    expect(rs.length).toBe(2);
  });
});

describe("NASA", () => {
  it("public domain + no-endorsement; manifest picks ~orig", () => {
    const imgs = parseNasa(j("nasa-search.json"), "image");
    expect(imgs.length).toBeGreaterThan(0);
    valid(imgs);
    expect(imgs[0]!.candidate.license.code).toBe("PDM");
    expect(imgs[0]!.candidate.license.restrictions).toContain("no-endorsement");
    expect(pickNasaAsset(j("nasa-assets.json") as string[], "image")).toMatch(/~orig\.jpg$/);
    expect(pickNasaAsset(["http://x/a~mobile.mp4", "http://x/a~orig.mp4"], "video")).toBe("https://x/a~orig.mp4");
    expect(pickNasaAsset([], "video")).toBeNull();
  });
});

describe("Library of Congress (recorded)", () => {
  it("'no known restrictions' → PDM; largest image ≤ 3840", () => {
    const rs = parseLoc(j("loc-photos.json"));
    expect(rs.length).toBe(2);
    valid(rs);
    expect(rs[0]!.candidate.license.code).toBe("PDM");
    expect(rs[0]!.candidate.downloadUrl).not.toContain("#");
    expect(pickLocImage(["https://a/1.jpg#h=100&w=150", "https://a/2.jpg#h=3000&w=4000", "https://a/3.jpg#h=1000&w=1500"])).toEqual({ url: "https://a/3.jpg", w: 1500, h: 1000 });
  });
  it("anything else → UNKNOWN", () => {
    const rs = parseLoc({ results: [{ id: "x", title: "T", image_url: ["https://a/1.jpg#h=10&w=20"], item: { rights_advisory: "Rights status not evaluated" } }] });
    expect(rs[0]!.candidate.license.code).toBe("UNKNOWN");
  });
});

describe("Pexels / Pixabay (documented shapes)", () => {
  it("Pexels photos and videos: licence flags, ≤ 1920 px / ≤ 30 fps files", () => {
    const photos = parsePexelsPhotos(j("pexels-photos.json"));
    valid(photos);
    expect(photos[0]!.candidate.license.code).toBe("PEXELS");
    expect(photos[0]!.candidate.license.restrictions).toEqual(["no-bad-light", "no-redistribution", "trademark"]);
    const vids = parsePexelsVideos(j("pexels-videos.json"));
    valid(vids);
    expect(vids[0]!.candidate.width).toBeLessThanOrEqual(1920);
    expect(pickPexelsFile([
      { link: "a", width: 3840, fps: 30, file_type: "video/mp4" }, { link: "b", width: 1920, fps: 60, file_type: "video/mp4" },
      { link: "c", width: 1920, fps: 25, file_type: "video/mp4" }, { link: "d", width: 1280, fps: 25, file_type: "video/mp4" },
    ])?.link).toBe("c");
  });
  it("Pixabay images (largeImageURL 1280 px) and videos", () => {
    const imgs = parsePixabayImages(j("pixabay-images.json"));
    valid(imgs);
    expect(imgs[0]!.candidate.width).toBeLessThanOrEqual(1280);
    expect(imgs[0]!.candidate.tags.length).toBeGreaterThan(0);
    expect(parsePixabayVideos(j("pixabay-videos.json"))[0]!.candidate.license.code).toBe("PIXABAY");
  });
  it("keys travel in the right place; unconfigured providers return nothing", async () => {
    expect(new URL(pexelsUrl(q())).searchParams.get("orientation")).toBe("landscape");
    expect(new URL(pixabayUrl(q({ kind: "video" }), "K")).pathname).toBe("/api/videos/");
    const http = stubHttp([[/pexels/, j("pexels-photos.json")], [/pixabay/, j("pixabay-images.json")]]);
    expect(await providerById("pexels").search(q(), pctx(http))).toEqual([]);
    expect(http.urls).toHaveLength(0);
    await providerById("pexels").search(q(), pctx(http, { pexels: "PEXKEY" }));
    expect(http.headers[0]).toEqual({ authorization: "PEXKEY" });
    expect(http.urls[0]).not.toContain("PEXKEY");
    expect(providerById("pexels").isConfigured({}, makeConfig())).toBe(false);
  });
});

describe("Brave (paid, M3)", () => {
  it("UNKNOWN + editorial-only; may-be-manipulated on person beats", () => {
    const person = parseBraveImages(j("brave-images.json"), { personBeat: true });
    valid(person);
    expect(person[0]!.candidate.license.code).toBe("UNKNOWN");
    expect(person[0]!.candidate.license.restrictions).toEqual(["editorial-only", "may-be-manipulated", "unknown-rights"]);
    expect(parseBraveImages(j("brave-images.json"), { personBeat: false })[0]!.candidate.license.restrictions).not.toContain("may-be-manipulated");
  });
});

describe("quota buckets", () => {
  it("counts per window, persists across instances and refuses daily overflow", async () => {
    const config = makeConfig();
    let now = 1_000_000;
    const signal = new AbortController().signal;
    const a = new QuotaBuckets(config, { now: () => now });
    for (let k = 0; k < 3; k++) await a.acquire("openverse", { perDay: 3, concurrency: 1 }, signal);
    const b = new QuotaBuckets(config, { now: () => now });
    await expect(b.acquire("openverse", { perDay: 3, concurrency: 1 }, signal)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });
    now += 86_400_000;
    await expect(b.acquire("openverse", { perDay: 3, concurrency: 1 }, signal)).resolves.toBeUndefined();
  });
  it("waits for the minute window instead of failing (cancellable)", async () => {
    const config = makeConfig();
    const qb = new QuotaBuckets(config, { now: () => 0 });
    await qb.acquire("loc", { perMin: 1, concurrency: 1 }, new AbortController().signal);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await expect(qb.acquire("loc", { perMin: 1, concurrency: 1 }, ac.signal)).rejects.toMatchObject({ code: "CANCELED" });
  });
});

describe("resolveEntity (wbsearchentities)", () => {
  it("prefers the exact match, then fetches aliases", async () => {
    const http = stubHttp([[/wbsearchentities/, j("wikidata-search.json")], [/wbgetentities/, j("wikidata-entities.json")]]);
    const r = await resolveEntity("Carolus Clusius", "en", { http, signal: new AbortController().signal });
    expect(r?.qid).toBe("Q312004");
    expect(r?.aliases.length).toBeGreaterThan(0);
    expect(r?.aliases).not.toContain(r?.label);
    expect(http.urls[0]).toContain("action=wbsearchentities");
  });
  it("offline → null; no hit → null", async () => {
    const offline: HttpClient = { ...stubHttp([]), getJson: async () => { throw new DocmakerError("OFFLINE", "offline"); } };
    expect(await resolveEntity("X", "en", { http: offline, signal: new AbortController().signal })).toBeNull();
    expect(pickEntity({ search: [] }, "x")).toBeNull();
    expect(await resolveEntity("  ", "en", { http: offline, signal: new AbortController().signal })).toBeNull();
  });
});

describe("stage provider selection", () => {
  it("offline → local + procedural; unconfigured keyed providers dropped; paid skipped when allowPaid is false", async () => {
    const { activeProviders, createLocalProvider, createProceduralProvider } = await import("../src/index");
    const { makeProject } = await import("@docmaker/core/testing");
    const o = { local: createLocalProvider(null), procedural: createProceduralProvider() };
    const project = makeProject();
    const online = { config: makeConfig({ offline: false }), secrets: { fal: "K", brave: "B", pexels: "P" } };
    const all = [...activeProviders(project, online, o).keys()];
    expect(all).toEqual(["wikimedia", "openverse", "internet-archive", "nasa", "loc", "pexels", "brave", "fal", "procedural"]);
    expect([...activeProviders(project, online, { ...o, allowPaid: false }).keys()]).not.toContain("fal");
    expect([...activeProviders(project, { ...online, config: makeConfig({ offline: true }) }, o).keys()]).toEqual(["procedural"]); // the local provider needs an index
    expect([...activeProviders({ ...project, assets: { ...project.assets, offline: true } }, online, o).keys()]).toEqual(["procedural"]); // the local provider needs an index
  });
});
