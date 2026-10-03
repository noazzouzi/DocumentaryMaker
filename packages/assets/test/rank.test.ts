import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { BeatPlan, Candidate, CandidateRecord, CandidateScore } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import {
  dedupeRecords, dHash, hamming, licenseInfo, metadataParts, metadataScore, needsVisionRerank, pickAssets, planQueries, providerOrder, rankCandidates, shotsNeeded,
} from "../src/index";
import { relaxQuery } from "../src/plan";
import { eraOf, RELEVANCE_FLOOR, textCoverage } from "../src/rank";
import { canonToken } from "../src/util";
import { tmpDir } from "./helpers";

const { plans } = makeBeats(makeScript({ chapters: 1, segmentsPerChapter: 2 }));
const base: BeatPlan = { ...plans.plans.find((p) => p.origin === "llm")!, visualKind: "archival_photo", visualQuery: "tulip bulb auction tavern", motionTemplate: "none", estSeconds: 4, energy: 3, cueTags: [], purpose: "context", chapterId: "CH2" };

const cand = (o: Partial<Candidate> & { id: string }): Candidate => ({
  provider: "wikimedia", providerAssetId: o.id, kind: "image", title: "", description: "", tags: [], previewUrl: "", downloadUrl: "", width: 1920, height: 1080,
  durationSec: null, license: licenseInfo("CC0"), author: null, sourcePageUrl: "", retrievedAt: "2026-10-02T00:00:00.000Z", youtube: null, ...o,
});
const rec = (c: Candidate): CandidateRecord => ({ candidate: c, score: null, raw: null });

describe("relevance (coverage floor, names, ordinals, era)", () => {
  const mackay = { name: "Charles Mackay", aliases: ["Mackay"] };
  it("a lone surname never counts as a match for a person's name", () => {
    const marsh = cand({ id: "m", title: "Mackay Island Wildlife Refuge 11 LR" });
    const book = cand({ id: "b", title: "Memoirs of Extraordinary Popular Delusions, title page" });
    const q = "charles mackay book title page";
    expect(textCoverage(marsh, q, [mackay])).toBe(0);
    expect(textCoverage(marsh, q)).toBeCloseTo(1 / 5, 5); // without the name rule "mackay" would have counted
    expect(textCoverage(book, q, [mackay])).toBeCloseTo(2 / 5, 5);
    expect(textCoverage(cand({ id: "p", title: "Charles Mackay (8738982379)" }), q, [mackay])).toBeCloseTo(2 / 5, 5);
    const plan = { ...base, visualQuery: q, personIds: ["P1"] };
    expect(metadataParts(marsh, plan, [marsh, book], { people: [mackay] }).textMatch).toBe(0);
  });
  it("zero-overlap candidates sit below the floor; ordinals, centuries and decades are normalised", () => {
    expect(textCoverage(cand({ id: "f", title: "Fishing Boats in a Harbor" }), "an auctioneer kept lowering his price")).toBe(0);
    expect(RELEVANCE_FLOOR).toBeGreaterThan(0.3);
    const tulip = cand({ id: "t", title: "Semper Augustus Tulip 17th century" });
    expect(textCoverage(tulip, "seventeenth century tulip")).toBe(1);
    expect(textCoverage(cand({ id: "y", title: "Flora's Wagon of Fools, c1637" }), "1630s satire")).toBeCloseTo(1 / 2, 5);
    expect(textCoverage(cand({ id: "z", title: "Tulip book 1637" }), "1600s tulip")).toBe(1);
    expect(canonToken("xviie")).toBe("17th");
    expect(canonToken("17e")).toBe("17th");
    expect(canonToken("1600s")).toBe("17th");
  });
  it("archival material far outside the story's era is penalised", () => {
    const facts = makeFactSheet();
    const era = eraOf({ timeline: [{ ...facts.timeline[0]!, date: "1634" }, { ...facts.timeline[0]!, date: "1637-02-03" }] });
    expect(era).toEqual([1634, 1637]);
    const frieze = cand({ id: "fr", title: "tulip frieze" });
    const off = metadataParts(frieze, base, [frieze], { era, year: 1905 });
    const on = metadataParts(frieze, base, [frieze], { era, year: 1640 });
    expect(off.anachronism).toBe(1);
    expect(on.anachronism).toBe(0);
    expect(on.metadata - off.metadata).toBeCloseTo(0.1, 5);
    expect(metadataParts(frieze, { ...base, visualKind: "stock_broll" }, [frieze], { era, year: 1905 }).anachronism).toBe(0);
  });
  it("relaxes over-specific queries: without medium words, then the two-word core", () => {
    expect(relaxQuery("semper augustus tulip watercolour")).toEqual(["semper augustus tulip", "semper augustus"]);
    expect(relaxQuery("flora wagon of fools painting")).toEqual(["flora wagon fools", "flora wagon"]);
    expect(relaxQuery("tulip bulbs in soil")).toEqual(["tulip bulbs soil", "tulip bulbs"]);
    expect(relaxQuery("tulip")).toEqual([]);
  });
});

describe("metadata score (§7.6)", () => {
  it("weights title > tags > description and normalises by the best", () => {
    const a = cand({ id: "a", title: "Tulip bulb auction in a tavern" });
    const b = cand({ id: "b", tags: ["tulip", "auction"] });
    const c = cand({ id: "c", description: "a tulip" });
    const all = [a, b, c];
    const pa = metadataParts(a, base, all);
    expect(pa.textMatch).toBe(1);
    expect(metadataParts(b, base, all).textMatch).toBeCloseTo(3 / 8, 5);
    expect(metadataParts(c, base, all).textMatch).toBeCloseTo(1 / 8, 5);
    expect(metadataScore(a, base, all)).toBeCloseTo(0.45 + 0.2 * 1 + 0.1 * 1 + 0.1 * 1 + 0.15 * 1, 5);
  });
  it("resolution, aspect, duration fit and provider priors", () => {
    const lowres = metadataParts(cand({ id: "l", width: 960, height: 540 }), base, []);
    expect(lowres.resolution).toBe(0);
    expect(metadataParts(cand({ id: "h", width: 1440, height: 810 }), base, []).resolution).toBeCloseTo(0.5, 5);
    expect(metadataParts(cand({ id: "p", width: 1080, height: 1920 }), base, []).aspect).toBe(0);
    expect(metadataParts(cand({ id: "s", width: 1000, height: 1000 }), base, []).aspect).toBeCloseTo(1 - Math.log(16 / 9) / Math.LN2, 5);
    const vid = (d: number, w = 1920) => metadataParts(cand({ id: `v${d}`, kind: "video", durationSec: d, width: w }), { ...base, estSeconds: 4 }, []);
    expect([vid(6).durFit, vid(2).durFit, vid(1).durFit]).toEqual([1, 0.6, 0.2]);
    expect([vid(10, 1920).resolution, vid(10, 1280).resolution, vid(10, 640).resolution]).toEqual([1, 0.6, 0.2]);
    expect(metadataParts(cand({ id: "w" }), base, []).prior).toBe(1);
    expect(metadataParts(cand({ id: "x", provider: "pexels" }), base, []).prior).toBe(0.2);
  });
  it("fuses CLIP and vision scores and sorts deterministically", () => {
    const recs = [rec(cand({ id: "a", title: "tulip" })), rec(cand({ id: "b", title: "tulip" })), rec(cand({ id: "c", title: "tulip auction" }))];
    const plain = rankCandidates({ plan: base, records: recs, reranked: null });
    expect(plain.map((r) => r.record.candidate.providerAssetId)).toEqual(["c", "a", "b"]);
    const vision = new Map<number, Partial<CandidateScore>>([[0, { vision: 0.9, technical: 0.8 }], [2, { vision: 0.2, technical: 0.5, watermark: true }], [1, { vision: 1, nsfw: true }]]);
    const fused = rankCandidates({ plan: base, records: recs, reranked: vision });
    expect(fused[0]!.record.candidate.providerAssetId).toBe("a");
    expect(fused.find((r) => r.record.candidate.providerAssetId === "b")!.score.total).toBe(0);
    const s = fused[0]!.score;
    expect(s.total).toBeCloseTo(0.6 * 0.9 + 0.25 * s.metadata + 0.15 * 0.8, 2);
    const clip = rankCandidates({ plan: base, records: recs, reranked: new Map([[0, { clip: 0.1 }], [1, { clip: 1 }], [2, { clip: 0.1 }]]) });
    expect(clip[0]!.record.candidate.providerAssetId).toBe("b");
  });
  it("needsVisionRerank modes", () => {
    const sc = (m: number) => ({ metadata: m } as CandidateScore);
    const broll = { ...base, visualKind: "stock_broll" as const };
    expect(needsVisionRerank(base, [sc(0.9), sc(0.1)], "off")).toBe(false);
    expect(needsVisionRerank(broll, [sc(0.9), sc(0.1)], "all")).toBe(true);
    expect(needsVisionRerank(base, [sc(0.9), sc(0.1)], "selective")).toBe(true); // archival
    expect(needsVisionRerank({ ...broll, personIds: ["P1"] }, [sc(0.9), sc(0.1)], "selective")).toBe(true);
    expect(needsVisionRerank(broll, [sc(0.9), sc(0.1)], "selective")).toBe(false);
    expect(needsVisionRerank(broll, [sc(0.5), sc(0.46)], "selective")).toBe(true);
  });
});

describe("pickAssets", () => {
  const ranked = ["a", "b", "c"].map((id, k) => ({ record: rec(cand({ id })), score: { metadata: 0.9 - k * 0.1, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0.9 - k * 0.1, focal: null, safeCrop: null, notes: "" } }));
  it("greedy by total with the reuse penalty", () => {
    expect(pickAssets({ plan: base, ranked, shots: 2, recentUse: new Map() }).map((p) => [p.candidate.providerAssetId, p.slot])).toEqual([["a", 0], ["b", 1]]);
    const used = pickAssets({ plan: base, ranked, shots: 2, recentUse: new Map([["wikimedia:a", 1]]) });
    expect(used.map((p) => p.candidate.providerAssetId)).toEqual(["b", "c"]);
    expect(used.find((p) => p.candidate.providerAssetId === "c")!.score.total).toBeCloseTo(0.7, 5);
  });
  it("identity beats are exempt from the reuse penalty", () => {
    expect(pickAssets({ plan: { ...base, personIds: ["P1"] }, ranked, shots: 1, recentUse: new Map([["wikimedia:a", 3]]) })[0]!.candidate.providerAssetId).toBe("a");
  });
});

describe("planQueries / shotsNeeded / providerOrder", () => {
  const facts = makeFactSheet({ people: 3 });
  facts.people[1] = { ...facts.people[1]!, isMinorOrPrivateVictim: true };
  facts.people[2] = { ...facts.people[2]!, publicFigure: false };
  const entities = { schemaVersion: 1 as const, entities: [{ personId: "P1", qid: "Q312004", label: "Carolus Clusius", aliases: [], resolvedBy: "wbsearchentities" as const }] };
  it("identity queries use the QID; minors are never searched; non-public persons only after person-ack", () => {
    const plan = { ...base, personIds: ["P1", "P2", "P3"], visualQuery: "Adriaen Pauw and Wouter Bartelmiesz in Leiden garden" };
    const q = planQueries({ plan, facts, entities, style: TEST_STYLE, personAcks: [] });
    const identity = q.filter((x) => x.personIds.length > 0);
    expect(identity.map((x) => [x.personIds[0], x.entityQid, x.text])).toEqual([["P1", "Q312004", "Carolus Clusius"]]);
    const generic = q.find((x) => x.personIds.length === 0)!;
    expect(generic.text).not.toMatch(/Bartelmiesz|Wouter|Pauw|Adriaen/);
    expect(generic.text).toContain("Leiden");
    const acked = planQueries({ plan, facts, entities, style: TEST_STYLE, personAcks: ["P2", "P3"] });
    expect(acked.filter((x) => x.personIds.length > 0).map((x) => x.personIds[0])).toEqual(["P1", "P3"]);
  });
  it("graphics beats ask for one background; clip beats nothing; stock asks video then image", () => {
    expect(planQueries({ plan: { ...base, visualKind: "motion_graphic", motionTemplate: "counter" }, facts, entities, style: TEST_STYLE, personAcks: [] }).map((q) => [q.kind, q.role])).toEqual([["image", "generated"]]);
    expect(planQueries({ plan: { ...base, visualKind: "youtube_clip", origin: "clip" }, facts, entities, style: TEST_STYLE, personAcks: [] })).toEqual([]);
    expect(planQueries({ plan: { ...base, visualKind: "stock_broll" }, facts, entities, style: TEST_STYLE, personAcks: [] }).map((q) => q.kind)).toEqual(["video", "image"]);
  });
  it("provider order excludes stock for people and fal for PERSON_INTRO/SENSITIVE beats", () => {
    expect(providerOrder({ ...base, personIds: ["P1"] }, "image")).toEqual(["local", "wikimedia", "loc", "openverse"]);
    expect(providerOrder({ ...base, visualKind: "stock_broll" }, "video")).toEqual(["local", "pexels", "pixabay", "internet-archive", "nasa"]);
    expect(providerOrder({ ...base, visualKind: "ai_illustration" }, "image")).toContain("fal");
    expect(providerOrder({ ...base, visualKind: "ai_illustration", cueTags: [{ type: "SENSITIVE", value: "" }] }, "image")).not.toContain("fal");
  });
  it("shotsNeeded follows the ASL formula and special cases", () => {
    const s = TEST_STYLE.cameraPolicy.shots;
    const plan = { ...base, estSeconds: 9, energy: 3 };
    const expected = Math.min(4, Math.max(1, Math.round(9 / (s.targetAslSec * s.aslMul.byEnergy[2]!))));
    expect(shotsNeeded(plan, TEST_STYLE)).toBe(expected);
    expect(shotsNeeded({ ...plan, estSeconds: 0.5 }, TEST_STYLE)).toBe(1);
    expect(shotsNeeded({ ...plan, estSeconds: 60 }, TEST_STYLE)).toBe(4);
    expect(shotsNeeded({ ...plan, cueTags: [{ type: "MONTAGE", value: "" }] }, TEST_STYLE)).toBe(4);
    expect(shotsNeeded({ ...plan, origin: "breath" }, TEST_STYLE)).toBe(4);
    expect(shotsNeeded({ ...plan, motionTemplate: "split_compare" }, TEST_STYLE)).toBe(2);
    expect(shotsNeeded({ ...plan, motionTemplate: "photo_burst" }, TEST_STYLE, { count: 6 })).toBe(6);
    expect(shotsNeeded({ ...plan, motionTemplate: "photo_burst" }, TEST_STYLE)).toBe(4);
    expect(shotsNeeded({ ...plan, purpose: "hook" }, TEST_STYLE)).toBeGreaterThanOrEqual(shotsNeeded(plan, TEST_STYLE));
  });
});

describe("dHash dedupe", () => {
  it("near-identical pictures collapse (Hamming ≤ 6), different ones stay", async () => {
    const dir = tmpDir("dhash");
    const grad = (w: number, h: number) => {
      const buf = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        buf[i] = (x * 255) / w; buf[i + 1] = (y * 255) / h; buf[i + 2] = ((x + y) * 127) / (w + h);
      }
      return sharp(buf, { raw: { width: w, height: h, channels: 3 } });
    };
    const a = path.join(dir, "a.jpg"); const b = path.join(dir, "b.jpg"); const c = path.join(dir, "c.jpg");
    await grad(640, 360).jpeg({ quality: 90 }).toFile(a);
    await grad(640, 360).resize(320, 180).jpeg({ quality: 40 }).toFile(b); // re-encoded, resized copy
    await grad(640, 360).flop().toFile(c); // mirrored
    const [ha, hb, hc] = await Promise.all([dHash(a), dHash(b), dHash(c)]);
    expect(hamming(ha, hb)).toBeLessThanOrEqual(6);
    expect(hamming(ha, hc)).toBeGreaterThan(6);
    const recs = [rec(cand({ id: "a" })), rec(cand({ id: "b" })), rec(cand({ id: "c" })), rec(cand({ id: "a" }))];
    const hashes = new Map([["wikimedia:a", ha], ["wikimedia:b", hb], ["wikimedia:c", hc]]);
    expect(dedupeRecords(recs, hashes).map((r) => r.candidate.providerAssetId)).toEqual(["a", "c"]);
    expect(dedupeRecords(recs).map((r) => r.candidate.providerAssetId)).toEqual(["a", "b", "c"]);
  });
});
