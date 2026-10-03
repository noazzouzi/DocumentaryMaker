// resolveAssets online against a fake network (fetch + DNS injected): identity search by QID, private persons never
// searched (request spy), vision rerank fusion with JPEG thumbnails, fal denylist + receipts, per-host User-Agent.
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fnv1a32, P, PicksDoc } from "@docmaker/core";
import type { BeatPlan, CandidateScore, FactSheet, Project, Reranker } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeProject, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import { createHttpClient, FAL_PROMPT_SUFFIX, resolveAssets, type AssetsStageOutput } from "../src/index";
import { cleanup, DATA, fakeFetch, makeConfig, makeCtx, publicLookup, quietLogger, tmpDir } from "./helpers";

const json = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const ok = (body: string, type = "application/json") => new Response(body, { headers: { "content-type": type } });

async function jpegFor(url: string): Promise<Buffer> {
  // A different picture per URL (dHash must not collapse them).
  const seed = fnv1a32(url);
  const w = 1600;
  const h = 1000;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const band = ((x >> (4 + (seed % 4))) ^ (y >> (3 + ((seed >> 3) % 4)))) & 1;
    raw[i] = band ? (seed & 255) : 30;
    raw[i + 1] = band ? ((seed >> 8) & 255) : 60;
    raw[i + 2] = band ? ((seed >> 16) & 255) : 90;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

const config = makeConfig({ offline: false, contact: "https://example.org/contact" });
const net = fakeFetch(async (url) => {
  if (url.startsWith("https://commons.wikimedia.org/w/api.php")) return ok(json("commons-search.json"));
  if (url.startsWith("https://api.openverse.org/")) return ok(json("openverse-images.json"));
  if (url.startsWith("https://www.loc.gov/photos/")) return ok(json("loc-photos.json"));
  if (url.startsWith("https://archive.org/advancedsearch.php")) return ok(JSON.stringify({ response: { docs: [] } }));
  if (url.startsWith("https://images-api.nasa.gov/")) return ok(JSON.stringify({ collection: { items: [] } }));
  if (url.startsWith("https://queue.fal.run/fal-ai/flux/schnell")) return ok(JSON.stringify({ request_id: "r1", status_url: "https://queue.fal.run/fal-ai/flux/requests/r1/status", response_url: "https://queue.fal.run/fal-ai/flux/requests/r1" }));
  if (url.endsWith("/requests/r1/status")) return ok(JSON.stringify({ status: "COMPLETED" }));
  if (url.endsWith("/requests/r1")) return ok(JSON.stringify({ images: [{ url: "https://v3.fal.media/files/x/out.jpg" }], has_nsfw_concepts: [false] }));
  if (/\.(jpe?g|png)(\?|$)/i.test(url) || url.includes("/services/img/")) return ok(new Uint8Array(await jpegFor(url)) as unknown as string, "image/jpeg");
  return new Response("not found", { status: 404 });
});
const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: net.impl, lookup: publicLookup, retries: 0 });
const ctx = { ...makeCtx({ config, http }), secrets: { fal: "FALKEY" } };
const projectDir = tmpDir("online");

const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
const base = makeBeats(script).plans;
const facts: FactSheet = makeFactSheet();
facts.people[1] = { ...facts.people[1]!, isMinorOrPrivateVictim: true, publicFigure: false }; // P2 "Adriaen Pauw"
const edit = (id: string, o: Partial<BeatPlan>) => {
  const p = base.plans.find((x) => x.id === id)!;
  Object.assign(p, o);
};
edit("CH1-B001", { personIds: ["P1"], visualQuery: "Carolus Clusius portrait" });
edit("CH1-B002", { visualKind: "ai_illustration", visualQuery: "tulip bulbs on a merchant's scale" });
edit("CH1-B003", { visualKind: "ai_illustration", visualQuery: "Clusius in his garden" });
edit("CH1-B004", { personIds: ["P2"], visualQuery: "Adriaen Pauw tulip collection" });
const project: Project = makeProject();
project.assets = { ...project.assets, offline: false };

const rerankCalls: { beatId: string; n: number; exts: string[] }[] = [];
const reranker: Reranker = {
  async rerank(input, candidates, thumbs) {
    rerankCalls.push({ beatId: input.beatId, n: candidates.length, exts: thumbs.map((t) => path.extname(t)) });
    // Prefer the LAST candidate strongly (it must win after fusion).
    const scores = candidates.map((_, k): Pick<CandidateScore, "vision" | "technical" | "watermark" | "nsfw" | "focal" | "safeCrop" | "notes"> => ({
      vision: k === candidates.length - 1 ? 1 : 0.1, technical: 0.8, watermark: false, nsfw: false, focal: { x: 0.4, y: 0.3 }, safeCrop: null, notes: `rr${k}`,
    }));
    return { scores, receipt: null };
  },
};

let out: AssetsStageOutput;
beforeAll(async () => {
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
  out = await resolveAssets({
    project, plans: base, facts, entities: { schemaVersion: 1, entities: [{ personId: "P1", qid: "Q312004", label: "Carolus Clusius", aliases: ["Charles de l'Écluse"], resolvedBy: "wbsearchentities" }] },
    style: TEST_STYLE, primaryScript: script, userPicks: { schemaVersion: 1, picks: [], portraits: [], clips: [] }, previous: { picks: null, frozen: null, ledger: null },
    projectDir, reranker, personAcks: [],
  }, ctx);
}, 300_000);
afterAll(() => cleanup(projectDir, config.paths.home));

describe("resolveAssets (online, fake network)", () => {
  it("produces schema-valid picks from real providers", () => {
    expect(() => PicksDoc.parse(out.picks)).not.toThrow();
    const b1 = out.picks.picks.filter((p) => p.beatId === "CH1-B001");
    expect(b1.length).toBeGreaterThan(0);
    expect(b1.every((p) => ["wikimedia", "loc", "openverse"].includes(out.frozen.assets[p.assetId]!.candidate!.provider))).toBe(true);
  });

  it("identity search uses the QID; a minor/private person is never searched by name", () => {
    expect(net.calls.some((c) => decodeURIComponent(c.url).includes("haswbstatement:P180=Q312004"))).toBe(true);
    const leaked = net.calls.filter((c) => /adriaen|pauw/i.test(decodeURIComponent(c.url.replace(/\+/g, " "))));
    expect(leaked).toEqual([]);
    expect(out.picks.portraits.map((p) => p.personId)).toEqual(["P1"]);
  });

  it("vision rerank gets ≤ 8 JPEG thumbnails and its scores decide the pick", () => {
    const call = rerankCalls.find((c) => c.beatId === "CH1-B001")!;
    expect(call).toBeDefined();
    expect(call.n).toBeLessThanOrEqual(8);
    expect(new Set(call.exts)).toEqual(new Set([".jpg"]));
    const top = out.picks.picks.find((p) => p.beatId === "CH1-B001" && p.slot === 0)!;
    expect(top.score.vision).toBe(1);
    expect(top.focal).toEqual({ x: 0.4, y: 0.3 });
    const cand = out.candidates.find((c) => c.beatId === "CH1-B001")!;
    expect(cand.records.length).toBeLessThanOrEqual(project.assets.maxCandidatesPerBeat);
  });

  it("fal: non-photoreal prompt + receipt for an allowed beat; a denylisted name never reaches fal", () => {
    const posts = net.calls.filter((c) => c.method === "POST" && c.url.includes("queue.fal.run"));
    expect(posts).toHaveLength(1);
    const b2 = out.picks.picks.find((p) => p.beatId === "CH1-B002")!;
    const a = out.frozen.assets[b2.assetId]!;
    expect(a.candidate?.provider).toBe("fal");
    expect(a.candidate?.license.code).toBe("AI-GENERATED");
    expect(a.candidate?.description.endsWith(FAL_PROMPT_SUFFIX)).toBe(true);
    expect(ctx.costs.receipts.filter((r) => r.provider === "fal")).toHaveLength(1);
    const b3 = out.picks.picks.find((p) => p.beatId === "CH1-B003")!;
    expect(out.frozen.assets[b3.assetId]!.candidate?.provider).toBe("procedural");
    expect(out.ledger.entries.find((e) => e.assetId === a.id)?.license.code).toBe("AI-GENERATED");
  });

  it("sends the contact User-Agent only to allowlisted hosts", () => {
    const commons = net.calls.find((c) => c.url.startsWith("https://commons.wikimedia.org/"))!;
    expect(commons.headers["user-agent"]).toContain("contact: https://example.org/contact");
    const others = net.calls.filter((c) => !/^https:\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org|api\.openverse\.org)\//.test(c.url));
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) expect(c.headers["user-agent"]).not.toContain("contact");
  });
});
