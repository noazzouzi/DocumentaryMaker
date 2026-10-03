// resolveAssets online against a fake network: query relaxation (an over-specific query finds the right file on the looser
// pass), the relevance floor (an unrelated photograph never beats the designed fallback), and cache-aware quotas.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { fnv1a32, P } from "@docmaker/core";
import type { BeatPlan, BeatPlansDoc, Project } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeProject, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import { createHttpClient, resolveAssets } from "../src/index";
import { quotaHttp } from "../src/quota";
import { cleanup, fakeFetch, makeConfig, makeCtx, publicLookup, quietLogger, tmpDir } from "./helpers";

const ok = (body: string | Uint8Array, type = "application/json") => new Response(body as BodyInit, { headers: { "content-type": type } });
const jpeg = async (url: string) => {
  const s = fnv1a32(url);
  return sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: s & 255, g: (s >> 8) & 255, b: (s >> 16) & 255 } } })
    .composite([{ input: Buffer.from(`<svg width="1600" height="1000"><rect x="${s % 900}" y="${(s >> 4) % 500}" width="500" height="400" fill="#fff"/></svg>`), top: 0, left: 0 }])
    .jpeg().toBuffer();
};
const commonsPage = (title: string, file: string) => ({
  query: { pages: [{ pageid: fnv1a32(title), title: `File:${file}`, index: 1, imageinfo: [{
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, width: 2400, height: 1500, mime: "image/jpeg",
    thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/960px-${file}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
    extmetadata: { LicenseShortName: { value: "Public domain" }, ImageDescription: { value: title } },
  }] }] },
});
const fishing = { results: [{ id: "ov-fish", title: "Fishing Boats in a Harbor", url: "https://live.staticflickr.com/1/fish.jpg", width: 3000, height: 1700, license: "pdm", thumbnail: "https://api.openverse.org/v1/images/ov-fish/thumb/" }] };

const config = makeConfig({ offline: false });
const net = fakeFetch(async (url) => {
  const u = decodeURIComponent(url.replace(/\+/g, " "));
  if (u.startsWith("https://commons.wikimedia.org/w/api.php")) {
    // Only the relaxed query (no medium word) finds the watercolour; nothing on Commons for the auction beat.
    return ok(JSON.stringify(/gsrsearch=semper augustus tulip filetype/.test(u) ? commonsPage("Semper Augustus tulip, 17th century", "Semper_Augustus_Tulip_17th_century.jpg") : { query: { pages: [] } }));
  }
  if (u.startsWith("https://api.openverse.org/")) return ok(JSON.stringify(fishing));
  if (u.startsWith("https://www.loc.gov/photos/")) return ok(JSON.stringify({ results: [] }));
  if (u.startsWith("https://archive.org/advancedsearch.php")) return ok(JSON.stringify({ response: { docs: [] } }));
  if (u.startsWith("https://images-api.nasa.gov/")) return ok(JSON.stringify({ collection: { items: [] } }));
  if (/\.(jpe?g|png)(\?|$)/i.test(url) || url.includes("/thumb/")) return ok(new Uint8Array(await jpeg(url)), "image/jpeg");
  return new Response("not found", { status: 404 });
});
const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: net.impl, lookup: publicLookup, retries: 0 });
const ctx = makeCtx({ config, http });
const projectDir = tmpDir("relevance");
afterAll(() => cleanup(projectDir, config.paths.home));

const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
const all = makeBeats(script).plans;
const photo = all.plans.filter((p) => p.origin === "llm").slice(0, 2);
const set = (p: BeatPlan, visualQuery: string): BeatPlan => ({ ...p, visualKind: "archival_photo", motionTemplate: "none", personIds: [], cueTags: [], visualQuery });
const plans: BeatPlansDoc = { ...all, plans: [set(photo[0]!, "semper augustus tulip watercolour"), set(photo[1]!, "an auctioneer kept lowering his price")] };
const project: Project = makeProject();
project.assets = { ...project.assets, offline: false, visionRerank: "off", providers: ["local", "wikimedia", "loc", "openverse", "internet-archive", "nasa", "procedural"] };

describe("relevance and relaxation (online, fake network)", () => {
  it("relaxes an over-specific query and never picks a zero-overlap photograph", async () => {
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    const out = await resolveAssets({
      project, plans, facts: makeFactSheet(), entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, primaryScript: script,
      userPicks: { schemaVersion: 1, picks: [], portraits: [], clips: [] }, previous: { picks: null, frozen: null, ledger: null }, projectDir, reranker: null, personAcks: [],
    }, ctx);
    const providerOf = (beatId: string) => out.picks.picks.filter((p) => p.beatId === beatId).map((p) => out.frozen.assets[p.assetId]!.candidate?.provider);
    // Beat 1: the full query found nothing on Commons; "semper augustus tulip" did — and the fishing boats never win.
    const b1 = out.picks.picks.filter((p) => p.beatId === plans.plans[0]!.id).map((p) => out.frozen.assets[p.assetId]!.candidate!);
    expect(b1[0]!.title).toMatch(/Semper Augustus/);
    expect(b1.some((c) => /Fishing/.test(c.title))).toBe(false);
    expect(b1[0]!.downloadUrl).toMatch(/\/thumb\/.*\/1920px-/); // never the original
    const commonsQueries = net.calls.filter((c) => c.url.startsWith("https://commons.wikimedia.org/")).map((c) => decodeURIComponent(c.url.replace(/\+/g, " ")));
    expect(commonsQueries.some((q) => q.includes("gsrsearch=semper augustus tulip watercolour filetype"))).toBe(true);
    expect(commonsQueries.some((q) => q.includes("gsrsearch=semper augustus tulip filetype"))).toBe(true);
    // Beat 2: only the unrelated photograph exists → the designed fallback.
    expect(providerOf(plans.plans[1]!.id).every((x) => x === "procedural")).toBe(true);
    // The fishing boats stay listed for the scene board.
    expect(out.candidates.find((c) => c.beatId === plans.plans[1]!.id)!.records.some((r) => /Fishing/.test(r.candidate.title))).toBe(true);
  }, 300_000);

  it("quota tokens are spent on requests that go out, not on response-cache hits", async () => {
    let tokens = 0;
    const qh = quotaHttp(http, async () => { tokens++; });
    const signal = new AbortController().signal;
    const before = net.calls.length;
    await qh.getJson("https://api.openverse.org/v1/images/?q=quota-test", { signal, cacheTtlSec: 3600 });
    await qh.getJson("https://api.openverse.org/v1/images/?q=quota-test", { signal, cacheTtlSec: 3600 });
    await qh.getJson("https://api.openverse.org/v1/images/?q=quota-test", { signal, cacheTtlSec: 3600 });
    expect(net.calls.length - before).toBe(1);
    expect(tokens).toBe(1);
    await qh.getJson("https://api.openverse.org/v1/images/?q=quota-other", { signal, cacheTtlSec: 3600 });
    expect(tokens).toBe(2);
    // A client without the hook (a stub) pays before every call.
    let stubTokens = 0;
    const stub = quotaHttp({ ...http }, async () => { stubTokens++; });
    await stub.getJson("https://api.openverse.org/v1/images/?q=quota-test", { signal, cacheTtlSec: 3600 });
    expect(stubTokens).toBe(1);
  });
});
