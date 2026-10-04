// Beat relevance beyond word overlap: salient nouns, era windows, places, currencies (keyless metadata ranking). The
// candidates are the off-topic picks the online demo made before these rules, with their real Commons metadata.
import { describe, expect, it } from "vitest";
import type { BeatPlan, Candidate, CandidateRecord, FactSheet } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeScript } from "@docmaker/core/testing";
import { licenseInfo, rankCandidates } from "../src/index";
import { RELEVANCE_FLOOR, textCoverage } from "../src/rank";
import {
  beatContext, beatEraWindows, candidateYear, coreEra, currenciesIn, isAnachronistic, placesIn, relevanceFailure, relevanceSignals, salientTokens, storyContext,
} from "../src/relevance";
import { matchQueryTokens } from "../src/util";

const base = makeFactSheet();
/** A story about the Dutch tulip trade of 1593–1637, retold in 1841 and 2007, priced in guilders. */
const facts: FactSheet = {
  ...base, topic: "Tulip mania", oneLinePremise: "In the winter of 1636–37 a Dutch flower briefly cost a fortune, then nothing.", centralQuestion: "Did its collapse ruin the Dutch?",
  people: [
    { ...base.people[0]!, id: "P1", name: "Carolus Clusius", aliases: [], roleInStory: "Botanist who planted tulips in Leiden in 1593" },
    { ...base.people[0]!, id: "P2", name: "Charles Mackay", aliases: [], roleInStory: "Scottish journalist whose 1841 book popularised the story" },
  ],
  timeline: [
    { ...base.timeline[0]!, id: "E1", date: "1593", title: "Clusius plants tulips in Leiden", whatHappened: "Carolus Clusius plants tulips in Leiden." },
    { ...base.timeline[0]!, id: "E2", date: "1634", title: "Speculators enter the market", whatHappened: "Speculators trade bulb contracts in Haarlem." },
    { ...base.timeline[0]!, id: "E4", date: "1637-02-03", title: "The Haarlem auction without buyers", whatHappened: "An auctioneer finds no buyers." },
    { ...base.timeline[0]!, id: "E7", date: "1841", title: "Mackay publishes his account", whatHappened: "A popular history." },
    { ...base.timeline[0]!, id: "E8", date: "2007", title: "Goldgar publishes Tulipmania", whatHappened: "An archival study." },
  ],
  figures: [{ ...base.figures[0]!, id: "N1", label: "Price of a Semper Augustus bulb", value: 10000, unit: "guilders", asOf: "1637" }],
  quotes: [], claims: [],
};
const { plans } = makeBeats(makeScript({ chapters: 1, segmentsPerChapter: 2 }));
const plan = (visualQuery: string, o: Partial<BeatPlan> = {}): BeatPlan => ({
  ...plans.plans.find((p) => p.origin === "llm")!, visualKind: "archival_photo", visualQuery, motionTemplate: "none", personIds: [], cueTags: [], factIds: [], ...o,
});
const cand = (id: string, title: string, description = "", tags: string[] = []): Candidate => ({
  provider: "wikimedia", providerAssetId: id, kind: "image", title, description, tags, previewUrl: "", downloadUrl: "", width: 1920, height: 1080,
  durationSec: null, license: licenseInfo("PDM"), author: null, sourcePageUrl: "", retrievedAt: "2026-10-02T00:00:00.000Z", youtube: null,
});
const story = storyContext(facts);
const verdict = (p: BeatPlan, c: Candidate, rawYear: number | null = null, narration = "") => {
  const ctx = beatContext(p, facts, story, narration);
  return relevanceFailure(relevanceSignals(c, rawYear, [p.visualQuery], ctx));
};

// Real metadata of the demo's off-topic picks (Commons, keyless search).
const safavid = cand("saf", "A rare Safavid oil painting depicting a lady (perhaps Hapsburg Empress Eleonore Magdalena of Pfalz-Neuburg) in European dress standing in an interior, Persia, probably Isfahan, middle or second half of the 17th Century",
  "An undated, unsigned full-length painting shows a lady in European dress standing in an interior; probably brought to Isfahan by Dutch merchants.");
const crab = cand("crab", "Daniel MacDonald - Still Life with Crab, Fish and Vegetables (1843) oil on canvas signed lower right and dated 1843 h 71",
  "Painted in the tradition of the great Dutch still lives of the seventeenth century, this oil on canvas depicts an abundance of food.");
const kroner = cand("kr", "Two 20kr gold coins", "Two 20kr gold coins from the time of the Scandinavian Monetary Union. The left one is Swedish, and the right one is Danish.");
const wedding = cand("wed", "Wedding contract of Johann von Werth 1648 (SOkA Mladá Boleslav)", "Wedding contract (1648) of the important warrior of the Thirty Years' War. (Archive of the Town of Nové Benátky)");

describe("story and beat context", () => {
  it("the story's places, currencies and topic come from the fact sheet", () => {
    expect([...story.places].sort()).toEqual(["britain", "low-countries"]);
    expect([...story.primaryPlaces]).toEqual(["low-countries"]); // the Scottish narrator is mentioned once
    expect([...story.currencies]).toEqual(["guilder"]);
    expect(story.topic).toEqual(["tulip", "mania"]);
  });
  it("places: names are evidence, demonyms only connect; language labels and object adjectives are not places", () => {
    expect([...placesIn("Persia, probably Isfahan", { namesOnly: true })]).toEqual(["persia"]);
    expect([...placesIn("Still Life with Chinese Bowl and Vase of Flowers", { namesOnly: true })]).toEqual([]);
    expect([...placesIn("Dutch Golden Age paintings")]).toEqual(["low-countries"]);
    expect([...placesIn("Den Haag - Mauritshuis")]).toEqual(["low-countries"]);
    expect([...placesIn("Frieze (USA), 1905–15")]).toEqual(["usa"]);
  });
  it("currencies in EN/FR/DE/NL and abbreviations", () => {
    expect([...currenciesIn("Two 20kr gold coins")]).toEqual(["krone"]);
    expect([...currenciesIn("10,000 guilders")]).toEqual(["guilder"]);
    expect([...currenciesIn("dix mille florins")]).toEqual(["guilder"]);
    expect([...currenciesIn("50 rubles gold coin")]).toEqual(["ruble"]);
    expect([...currenciesIn("a pile of gold coins")]).toEqual([]);
  });
  it("era: the story's core cluster, the query's own era, else the cited facts' dates", () => {
    expect(coreEra(facts)).toEqual([1593, 1637]); // the 1841 retelling and the 2007 study do not stretch it
    expect(beatEraWindows(plan("seventeenth century dutch street scene painting"), facts)).toEqual([[1600, 1699]]);
    expect(beatEraWindows(plan("tulip trade 1630s"), facts)).toEqual([[1630, 1639]]);
    expect(beatEraWindows(plan("Mackay book", { factIds: ["E7"] }), facts)).toEqual([[1593, 1637], [1841, 1841]]);
    expect(candidateYear({ title: "Print, satirical print (BM 1863,0613.754-765)" }, 1780)).toEqual({ year: 1780, stated: false }); // museum numbers are not dates
    expect(candidateYear({ title: "Frieze (USA), 1905–15" }, null)).toEqual({ year: 1905, stated: true });
    expect(candidateYear({ title: "Portrait of a lady, Safavid Iran, mid-17th century" }, null)).toEqual({ year: 1650, stated: true });
    expect(isAnachronistic(1843, [[1600, 1699]])).toBe(true);
    expect(isAnachronistic(1648, [[1593, 1637]])).toBe(false);
  });
  it("salient nouns drop media, framing and era words; plurals meet singulars", () => {
    expect(salientTokens("seventeenth century dutch auction painting")).toEqual(["dutch", "auction"]);
    expect(salientTokens("archive contract documents")).toEqual(["contract"]);
    expect(matchQueryTokens("dutch merchants seventeenth century painting")).toEqual(["dutch", "merchant", "17th", "painting"]);
  });
});

describe("relevance rules on the demo's off-topic picks", () => {
  it("a Persian painting never illustrates a Dutch auction or Dutch merchants (no salient noun / foreign place)", () => {
    expect(verdict(plan("seventeenth century dutch auction painting"), safavid, 1650)).toMatch(/foreign place \(persia\)/);
    expect(verdict(plan("seventeenth century dutch auction painting"), cand("saf2", "Portrait of a lady, Safavid Iran, mid-17th century", "Oil on canvas"))).toMatch(/salient/);
    // Even when its description mentions Dutch merchants, its title names Persia and Isfahan.
    expect(verdict(plan("dutch merchants seventeenth century painting"), safavid, 1650)).toMatch(/foreign place \(persia\)/);
  });
  it("an 1843 still life is out of a seventeenth-century beat; Danish kroner never stand for guilders", () => {
    expect(verdict(plan("seventeenth century dutch street scene painting"), crab)).toMatch(/dated 1843/);
    expect(verdict(plan("gold coins pile candlelight", { visualKind: "stock_broll" }), kroner, 2013)).toMatch(/foreign currency \(krone\)/);
    expect(verdict(plan("gold coins pile candlelight", { visualKind: "stock_broll" }), cand("g", "Gold coins"))).toBeNull();
    // Stock b-roll is not held to the era, but a dated old work from another era (a 1920 film advertisement) is refused …
    expect(verdict(plan("gold coins pile candlelight", { visualKind: "stock_broll" }), cand("ad", "Three Gold Coins (1920) - Ad 1"))).toMatch(/dated 1920/);
    // … while a modern photograph is fine.
    expect(verdict(plan("gold coins pile candlelight", { visualKind: "stock_broll" }), cand("g2", "Gold coins 2015"))).toBeNull();
  });
  it("a generic query needs the story: a Bohemian wedding contract is not a tulip contract", () => {
    expect(verdict(plan("archive contract documents"), wedding, 1648)).toMatch(/generic query/);
    // A Scottish royal marriage contract: Scotland is in the story (its narrator), but not what the story is about.
    expect(verdict(plan("archive contract documents"), cand("anna", "Marriage contract between Princess Anna of Denmark and Jacob 6. of Scotland 1589", "", ["16th-century documents of Denmark"]))).toMatch(/generic query/);
    expect(verdict(plan("archive contract documents"), cand("tc", "Contract for the sale of tulip bulbs, Haarlem 1637"))).toBeNull();
    expect(verdict(plan("archive contract documents"), cand("dc", "Dutch notarial contract, Amsterdam archive"))).toBeNull();
  });
  it("on-topic candidates keep their place despite a foreign place or a late date (penalised, not dropped)", () => {
    expect(verdict(plan("single red tulip dark background", { visualKind: "stock_broll" }), cand("fr", "Frieze (USA), 1905–15 (CH 18500107-2)", "Stylized tulips in dark red"), 1905)).toBeNull();
    // A modern photograph of exactly the wanted place passes; a partial match dated by its provider far outside does not.
    expect(verdict(plan("hortus botanicus leiden garden"), cand("h", "Hortus Botanicus Leiden - De Wintertuin", "", ["Hortus Botanicus Leiden", "Gardens in Leiden"]), 2008)).toBeNull();
    expect(verdict(plan("seventeenth century satirical print tulips"), cand("bm", "Print, book-illustration, satirical print (BM 1863,0613.754-765)"), 1780)).toMatch(/dated 1780/);
  });
  it("the floor was raised: one word of a three-word query is not enough", () => {
    expect(RELEVANCE_FLOOR).toBeGreaterThanOrEqual(0.4);
    expect(textCoverage(cand("w", "Wedding contract"), "archive contract documents")).toBeLessThan(RELEVANCE_FLOOR);
  });
  it("ranking: penalties put the right candidate first even when the wrong one has the better text score", () => {
    const p = plan("dutch merchants seventeenth century painting");
    const ships = cand("ships", "Dutch Ships in a Gale RMG BHC0721", "A three-masted merchant ship, possibly a fluyt, is shown labouring before a storm.");
    const recs: CandidateRecord[] = [safavid, ships].map((c) => ({ candidate: c, score: null, raw: { year: 1650 } }));
    const without = rankCandidates({ plan: p, records: recs, reranked: null });
    expect(without[0]!.record.candidate.providerAssetId).toBe("saf");
    const ctx = beatContext(p, facts, story);
    const ranked = rankCandidates({ plan: p, records: recs, reranked: null, relevance: { ctx, queries: [p.visualQuery] } });
    expect(ranked[0]!.record.candidate.providerAssetId).toBe("ships");
    expect(ranked.find((r) => r.record.candidate.providerAssetId === "saf")!.score.notes).toMatch(/foreign-place persia/);
  });
  it("a vision score outranks metadata: the fused total follows the vision score", () => {
    const p = plan("dutch merchants seventeenth century painting");
    const ships = cand("ships", "Dutch Ships in a Gale", "merchant ship");
    const recs: CandidateRecord[] = [ships, safavid].map((c) => ({ candidate: c, score: null, raw: null }));
    const ctx = beatContext(p, facts, story);
    const reranked = new Map([[0, { vision: 0.1, technical: 0.8 }], [1, { vision: 0.95, technical: 0.8 }]]);
    const ranked = rankCandidates({ plan: p, records: recs, reranked, relevance: { ctx, queries: [p.visualQuery] } });
    expect(ranked[0]!.record.candidate.providerAssetId).toBe("saf");
  });
});
