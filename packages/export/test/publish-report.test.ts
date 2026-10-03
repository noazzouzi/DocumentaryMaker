// M2: publish kit (chapters from markers, unreviewed fallbacks, credits, checklist) and editorial report
// (claims, fact-check resolutions, clip seconds/share, AI images, voice, people, not-legal-advice footer).
import { describe, expect, it } from "vitest";
import type { FactCheck, Ledger, LedgerEntry, Timeline, UsageDoc } from "@docmaker/core";
import { makeFactSheet, makeScript, makeTake, makeTimeline } from "@docmaker/core/testing";
import { chapterLines, chapterStamp, clipUsage, writeEditorialReport, writePublishKit } from "../src/index";

const t = makeTimeline({ seconds: 120 });

describe("writePublishKit", () => {
  it("uses Project.publish when set, chapters from the chapter markers, and the credits block", () => {
    const md = writePublishKit({ t, publish: { title: "The Tulip Crash", thumbnailText: "BULB BUBBLE", description: "How a flower broke Holland." }, credits: "## Images\n- Rijksmuseum, CC0", lang: "en" });
    expect(md).toContain("## Title\n\nThe Tulip Crash");
    expect(md).toContain("BULB BUBBLE");
    expect(md).toContain("How a flower broke Holland.");
    expect(md).not.toContain("unreviewed");
    for (const m of t.markers.filter((x) => x.kind === "chapter")) expect(md).toContain(`${chapterStamp(m.frame, t.fps)} ${m.name}`);
    expect(md).toContain("- Rijksmuseum, CC0");
    expect(md).toMatch(/Disclosure checklist/);
    expect(md).toMatch(/- \[ \] "Altered or synthetic content"/);
  });
  it("marks fallbacks as unreviewed and speaks French", () => {
    const md = writePublishKit({ t, publish: null, credits: "", lang: "fr" });
    expect(md.match(/non relu/g)!.length).toBe(3);
    expect(md).toContain(t.title);
    expect(md).toContain("Kit de publication");
  });
  it("chapter lines always start at 00:00, merge same-second markers and flag YouTube's rules", () => {
    const tt = structuredClone(t) as Timeline;
    tt.markers = [
      { id: "mk:chapter:a", frame: 45, dur: 0, name: "Origins", note: "", color: "blue", kind: "chapter" },
      { id: "mk:chapter:b", frame: 50, dur: 0, name: "dup", note: "", color: "blue", kind: "chapter" },
      { id: "mk:chapter:c", frame: 40 * 30, dur: 0, name: "Crash", note: "", color: "blue", kind: "chapter" },
      { id: "mk:ad:x", frame: 600, dur: 0, name: "ad", note: "", color: "red", kind: "ad-break" },
    ];
    const c = chapterLines(tt, "en");
    expect(c.lines).toEqual(["00:00 Intro", "00:01 Origins", "00:40 Crash"]);
    expect(c.youtubeOk).toBe(false); // "Intro" is 1.5 s long
    expect(chapterStamp(3725 * 30, 30)).toBe("1:02:05");
  });
});

const entry = (assetId: string, o: Partial<LedgerEntry>): LedgerEntry => ({
  assetId, provider: "openverse", title: "x", sourcePageUrl: `https://example.org/${assetId.slice(0, 6)}`, fileUrl: "", author: null,
  license: { code: "CC-BY", version: "4.0", url: null, commercialOk: true, derivativesOk: true, attributionRequired: true, attributionText: "x, CC BY 4.0", restrictions: [] },
  attributionText: "x", retrievedAt: "2026-10-01T00:00:00.000Z", youtube: null, declaration: null, transformations: [], ...o,
});

describe("writeEditorialReport", () => {
  const facts = makeFactSheet({ people: 3 });
  facts.people[1]!.publicFigure = false;
  facts.people[2]!.isMinorOrPrivateVictim = true;
  facts.claims[0]!.status = "appeal_pending";
  const tt = structuredClone(t) as Timeline;
  const videoAsset = Object.values(tt.assets).find((a) => a.kind === "video")!;
  const imageAsset = Object.values(tt.assets).find((a) => a.kind === "image")!;
  const factCheck: FactCheck = {
    schemaVersion: 1, lang: "en", scriptHash: "a".repeat(64), slicesHash: "b".repeat(64), publishHash: "c".repeat(64), createdAt: "2026-10-01T00:00:00.000Z",
    needsMoreResearch: ["exact auction prices"], titleThumbnailIssues: [],
    items: [
      { id: "FC-0000000a", where: "CH1-S01", surface: "narration", sentence: "The crash | ruined Holland.", claimKind: "fact", verdict: "contradicted", risk: "high", factIds: [facts.claims[0]!.id], problem: "overstated", suggestedRewrite: "The crash hurt some traders.", origin: "llm", rule: null, resolution: "rewritten", note: "" },
      { id: "FC-0000000b", where: "title", surface: "title", sentence: "Ruin!", claimKind: "opinion", verdict: "opinion_ok", risk: "low", factIds: [], problem: "", suggestedRewrite: "", origin: "deterministic", rule: "c", resolution: "acknowledged", note: "framed as opinion in the voice-over" },
    ],
  };
  const ledger: Ledger = {
    schemaVersion: 1,
    entries: [
      entry(videoAsset.id, { provider: "youtube", license: { ...entry("x", {}).license, code: "YOUTUBE-FAIR-USE", restrictions: ["fair-use-user-risk"] }, youtube: { videoId: "abc", channel: "Museum TV", channelVerified: true, publishedAt: "2020-01-01", url: "https://www.youtube.com/watch?v=abc", startMs: 70_000, endMs: 85_000, transcriptLang: "en", transcriptKind: "manual", matchScore: 0.9, matchedText: "" } }),
      entry(imageAsset.id, { provider: "fal", title: "a tulip field at dawn, engraving", license: { ...entry("x", {}).license, code: "AI-GENERATED", restrictions: ["synthetic"], attributionText: null } }),
    ],
  };
  const usage: UsageDoc = { schemaVersion: 1, lang: "en", usage: [{ assetId: videoAsset.id, itemIds: [] }, { assetId: imageAsset.id, itemIds: [] }] };
  const voice = makeTake(makeScript());
  const md = writeEditorialReport({ t: tt, facts, factCheck, ledger, usage, voice, lang: "en" });

  it("lists the claims referenced by the fact-check with status, asOf and source URLs (pending flagged)", () => {
    const c = facts.claims[0]!;
    expect(md).toContain(c.summary);
    expect(md).toContain("appeal_pending (pending status — recheck before publishing)");
    expect(md).toContain(c.asOf);
    expect(md).toContain(facts.sources.find((s) => s.id === c.sourceIds[0])!.url);
    expect(md).not.toContain(facts.claims[1]!.summary);
  });
  it("lists fact-check items with resolutions and notes (pipes escaped)", () => {
    expect(md).toContain("The crash \\| ruined Holland.");
    expect(md).toContain("rewritten");
    expect(md).toContain("framed as opinion in the voice-over");
    expect(md).toContain("exact auction prices");
  });
  it("computes clip seconds, cumulative seconds and share of runtime", () => {
    const uses = clipUsage(tt, ledger, usage);
    expect(uses).toHaveLength(1);
    const frames = tt.video.filter((v) => v.source.kind === "video" && v.source.assetId === videoAsset.id).reduce((a, v) => a + v.dur, 0);
    expect(uses[0]!.seconds).toBeCloseTo(frames / tt.fps, 6);
    expect(uses[0]!.share).toBeCloseTo(frames / tt.durationInFrames, 6);
    expect(md).toContain("https://www.youtube.com/watch?v=abc");
    expect(md).toContain("Museum TV (verified)");
    expect(md).toMatch(/00:01:1\d–00:01:\d\d/); // source timecodes offset by the passage start (70 s)
  });
  it("lists AI images, the voice provider and licence, people rules and the footer", () => {
    expect(md).toContain("a tulip field at dawn, engraving");
    expect(md).toContain(`Provider: ${voice.provider}`);
    expect(md).toContain("synthetic voice");
    expect(md).toContain(`**${facts.people[1]!.name}**`);
    expect(md).toContain(`[${facts.people[2]!.id}]`);
    expect(md).not.toContain(`**${facts.people[2]!.name}**`);
    expect(md).toContain("not legal advice");
  });
  it("is deterministic and localised", () => {
    expect(writeEditorialReport({ t: tt, facts, factCheck, ledger, usage, voice, lang: "en" })).toBe(md);
    const fr = writeEditorialReport({ t: tt, facts, factCheck, ledger, usage, voice: null, lang: "fr" });
    expect(fr).toContain("Rapport éditorial");
    expect(fr).toContain("n'est pas un avis juridique");
  });
});
