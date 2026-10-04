// resolveAssets online against a fake network: a person's grave may illustrate their beat, but their portrait (quote,
// lower-third and social-post slots) is a likeness — frozen from the beat's candidates when no pick is one.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { fnv1a32, P } from "@docmaker/core";
import type { BeatPlan, BeatPlansDoc, Project } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeProject, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import { createHttpClient, resolveAssets } from "../src/index";
import { cleanup, fakeFetch, makeConfig, makeCtx, publicLookup, quietLogger, tmpDir } from "./helpers";

const ok = (body: string | Uint8Array, type = "application/json") => new Response(body as BodyInit, { headers: { "content-type": type } });
const jpeg = async (url: string) => {
  const s = fnv1a32(url);
  return sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: s & 255, g: (s >> 8) & 255, b: (s >> 16) & 255 } } })
    .composite([{ input: Buffer.from(`<svg width="1600" height="1000"><rect x="${s % 900}" y="${(s >> 4) % 500}" width="500" height="400" fill="#fff"/></svg>`), top: 0, left: 0 }])
    .jpeg().toBuffer();
};
const page = (index: number, file: string, width: number, categories: string) => ({
  pageid: fnv1a32(file), title: `File:${file}`, index, imageinfo: [{
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, width, height: Math.round(width * 0.66), mime: "image/jpeg",
    thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/960px-${file}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
    extmetadata: { LicenseShortName: { value: "Public domain" }, ImageDescription: { value: file.replace(/_/g, " ").replace(/\.jpg$/, "") }, Categories: { value: categories } },
  }],
});
// The grave is the larger file (it ranks first); the engraving is the person's likeness.
const commons = { query: { pages: [
  page(1, "Carolus_Clusius_Leiden_04.jpg", 2400, "Graves in the Pieterskerk, Leiden|Carolus Clusius"),
  // A namesake (another place, another trade) ranks above the engraving but is never the portrait.
  page(2, "Carolus_Clusius_mayor_of_Wanganui,_New_Zealand.jpg", 1500, "Carolus Clusius (mayor)|Mayors of Wanganui"),
  page(3, "Carolus_Clusius_engraving.jpg", 1000, "Engravings by Martin Rota|Carolus Clusius"),
] } };

const config = makeConfig({ offline: false });
const net = fakeFetch(async (url) => {
  if (url.startsWith("https://commons.wikimedia.org/w/api.php")) return ok(JSON.stringify(commons));
  if (url.startsWith("https://api.openverse.org/")) return ok(JSON.stringify({ results: [] }));
  if (url.startsWith("https://www.loc.gov/photos/")) return ok(JSON.stringify({ results: [] }));
  if (/\.(jpe?g|png)(\?|$)/i.test(url) || url.includes("/thumb/")) return ok(new Uint8Array(await jpeg(url)), "image/jpeg");
  return new Response("not found", { status: 404 });
});
const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: net.impl, lookup: publicLookup, retries: 0 });
const ctx = makeCtx({ config, http });
const projectDir = tmpDir("portrait");
afterAll(() => cleanup(projectDir, config.paths.home));

const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
const all = makeBeats(script).plans;
const first = all.plans.find((p) => p.origin === "llm")!;
const beat: BeatPlan = { ...first, visualKind: "archival_photo", motionTemplate: "none", personIds: ["P1"], cueTags: [], visualQuery: "carolus clusius portrait", estSeconds: 1.2, energy: 3 };
const plans: BeatPlansDoc = { ...all, plans: [beat] };
const project: Project = makeProject();
project.assets = { ...project.assets, offline: false, visionRerank: "off", providers: ["local", "wikimedia", "loc", "openverse", "procedural"] };

describe("portrait identity (online, fake network)", () => {
  it("the grave may illustrate the beat; the portrait is the engraving (not the namesake), frozen from the candidates", async () => {
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    const out = await resolveAssets({
      project, plans, facts: makeFactSheet(), entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, primaryScript: script,
      userPicks: { schemaVersion: 1, picks: [], portraits: [], clips: [] }, previous: { picks: null, frozen: null, ledger: null }, projectDir, reranker: null, personAcks: [],
    }, ctx);
    const picked = out.picks.picks.filter((p) => p.beatId === beat.id).map((p) => out.frozen.assets[p.assetId]!.candidate!);
    expect(picked.map((c) => c.title)).toEqual(["Carolus Clusius Leiden 04"]); // the grave, as b-roll (its categories say so)
    expect(picked[0]!.tags).toContain("Graves in the Pieterskerk, Leiden");
    const portrait = out.picks.portraits.find((p) => p.personId === "P1");
    expect(portrait).toBeDefined();
    expect(out.frozen.assets[portrait!.assetId]!.candidate!.title).toBe("Carolus Clusius engraving");
    expect(out.frozen.assets[portrait!.assetId]!.role).toBe("portrait");
    // The extra portrait asset is frozen and ledgered (credits list it only when a card shows it).
    expect(out.ledger.entries.some((e) => e.assetId === portrait!.assetId)).toBe(true);
  }, 300_000);
});
