// Valid sample documents for every DOC_REGISTRY kind (plus a few non-registry schemas). Test-only.
import {
  type DocKind, type LicenseInfo, P, sha256Hex,
} from "../src/index";
import {
  TEST_NOW, makeBeats, makeFactSheet, makeFrozen, makeLayout, makePicks, makeProject, makeScript, makeTake, makeTimeline, makeMusicTrack,
  makeSfxManifest,
} from "../src/testing/index";

export const H = (s: string) => sha256Hex(s);
const lic: LicenseInfo = { code: "CC0", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false, attributionText: null, restrictions: [] };

const script = makeScript({ withClip: true, withBreath: true });
const beats = makeBeats(script);
const frozen = makeFrozen();
const picks = makePicks(beats.plans, frozen);
const take = makeTake(script);
const timeline = makeTimeline({ seconds: 20 });
const candidate = {
  provider: "openverse", providerAssetId: "abc", kind: "image", title: "Tulips", description: "", tags: ["tulip"], previewUrl: "https://example.org/p.jpg",
  downloadUrl: "https://example.org/f.jpg", width: 1920, height: 1080, durationSec: null, license: lic, author: { name: "A", url: null },
  sourcePageUrl: "https://example.org/page", retrievedAt: TEST_NOW, youtube: null,
};
const declaration = { kind: "own-work", license: null, author: "me", url: "", note: "" };
const costLine = { label: "x", provider: "anthropic", unit: "input_tokens", quantity: 10, unitPriceUsd: 0.001, totalUsd: 0.01 };
const renderResult = {
  outFile: "/tmp/final.mp4", durationInFrames: 150, frames: 150, chunks: [{ index: 0, from: 0, to: 149, file: "c.ts", hash: H("c"), cached: false, ms: 10 }],
  renderMs: 100, gl: "swangle", codeHash: H("code"), loudness: null,
};

/** One valid sample per registry kind, with the path it lives at and a REQUIRED key whose removal must fail. */
export const SAMPLES: Record<DocKind, { rel: string | null; value: Record<string, unknown>; required: string }> = {
  project: { rel: P.project, value: makeProject(), required: "slug" },
  state: { rel: P.state, value: { schemaVersion: 1, stages: [{ stage: "research", lang: null, variant: null, status: "done", stageVersion: 1, inputsHash: H("i"), outputsHash: H("o"), startedAt: TEST_NOW, finishedAt: TEST_NOW, error: null, costUsd: 0, artifacts: [] }] }, required: "stages" },
  approvals: { rel: P.approvals, value: { schemaVersion: 1, approvals: [{ gate: "cost", stage: "research", lang: null, planHash: H("p"), approvedAt: TEST_NOW, by: "cli", note: "", items: [], itemNotes: {} }] }, required: "approvals" },
  jobsIndex: { rel: P.jobsIndex, value: { schemaVersion: 1, jobs: [{ id: "job-20261002-000000-abcdef", request: { slug: "tulip-mania", kind: "demo", stage: null, from: null, to: null, langs: [], force: false, options: {}, preset: "draft" }, status: "queued", createdAt: TEST_NOW, startedAt: null, endedAt: null, error: null, coalescedInto: null, resumeOf: null }] }, required: "jobs" },
  estimate: { rel: P.estimate("research", null), value: { schemaVersion: 1, id: "est-1", stage: "research", lang: null, lines: [costLine], totalUsd: 0.01, confidence: "estimate", planHash: H("plan"), createdAt: TEST_NOW }, required: "lines" },
  dossier: { rel: P.dossier, value: { schemaVersion: 1, topic: "t", asOf: "2026-10-02", searchLanguages: ["en"], markdown: "# x [S1]", searchesUsed: 1, fetchesUsed: 1, turns: 1, rawFiles: [], generatedBy: "fixture" }, required: "markdown" },
  registry: { rel: P.registry, value: { schemaVersion: 1, entries: [{ id: "S1", url: "https://example.org", title: "x", pageAge: null, fetched: true, cited: 1, snippets: [] }] }, required: "entries" },
  factsheet: { rel: P.factsheet, value: makeFactSheet(), required: "sources" },
  verification: { rel: P.verification, value: { schemaVersion: 1, checkedAt: TEST_NOW, items: [{ ref: "Q1", check: "quote-verbatim", ok: false, detail: "skipped-offline" }], invalidRefs: [] }, required: "items" },
  styleSuggestion: { rel: P.styleSuggestion, value: { schemaVersion: 1, topicType: "scandal_expose", ranked: [{ styleId: "drama-commentary", score: 0.9, why: "x" }], recommendedStyleId: "drama-commentary", recommendedMinutes: 20, titleOptions: [], thumbnailTextOptions: [], riskFlags: ["none"], themeOverride: null, source: "offline", stage: "idea" }, required: "ranked" },
  outline: {
    rel: P.outline,
    value: {
      schemaVersion: 1, lang: "en", title: "T", thesis: "x", thesisConfirmed: false, storyShape: "rise-fall", hookTeasers: [], loops: [{ id: "L1", question: "?", openedIn: "CH1", closedIn: "CH2" }],
      chapters: [{ id: "CH1", act: "cold_open", title: "x", targetSec: 60, targetWords: 150, purpose: "", eventIds: [], claimIds: [], quoteIds: [], opensLoops: [], closesLoops: [], exitHook: "", adBreakAfter: false }],
      callbackPlan: [], nextVideoBridge: "",
      budget: { lang: "en", minutes: 20, storyShape: "rise-fall", charsPerSec: 16.5, runtimeSec: 1200, narrationSec: 1000, chars: 16500, words: 2900, chapters: 8, perAct: { cold_open: 100 }, beatsApprox: 300 },
      budgets: {}, generatedBy: "fixture", updatedAt: TEST_NOW,
    },
    required: "chapters",
  },
  script: { rel: P.script("en"), value: script, required: "chapters" },
  factcheck: {
    rel: P.factcheck("en"),
    value: {
      schemaVersion: 1, lang: "en", scriptHash: H("s"), slicesHash: H("b"), publishHash: H("p"),
      items: [{ id: "FC-0a1b2c3d", where: "CH1-S01", surface: "narration", sentence: "x", claimKind: "fact", verdict: "supported", risk: "none", factIds: [], problem: "", suggestedRewrite: "", origin: "deterministic", rule: "a", resolution: "open", note: "" }],
      needsMoreResearch: [], titleThumbnailIssues: [], createdAt: TEST_NOW,
    },
    required: "items",
  },
  beatPlans: { rel: P.beatPlans, value: beats.plans, required: "plans" },
  beatSlices: { rel: P.beatSlices("en"), value: beats.slices, required: "texts" },
  candidates: { rel: P.candidates("CH1-B001"), value: { schemaVersion: 1, beatId: "CH1-B001", queries: [], records: [{ candidate, score: null, raw: {} }] }, required: "records" },
  userPicks: { rel: P.userPicks, value: { schemaVersion: 1, picks: picks.picks.slice(0, 1), portraits: [], clips: [] }, required: "picks" },
  picks: { rel: P.picks, value: picks, required: "plansHash" },
  frozen: { rel: P.frozen, value: { schemaVersion: 1, assets: frozen }, required: "assets" },
  ledger: { rel: P.ledger, value: { schemaVersion: 1, entries: [{ assetId: H("a"), provider: "openverse", title: "x", sourcePageUrl: "u", fileUrl: "u", author: null, license: lic, attributionText: "x", retrievedAt: TEST_NOW, youtube: null, declaration: null, transformations: [] }] }, required: "entries" },
  music: { rel: P.music, value: { schemaVersion: 1, tracks: [makeMusicTrack()] }, required: "tracks" },
  entities: { rel: P.entities, value: { schemaVersion: 1, entities: [{ personId: "P1", qid: "Q42", label: "x", aliases: [], resolvedBy: "user" }] }, required: "entities" },
  localIndex: { rel: P.localIndex, value: { schemaVersion: 1, files: [{ path: "/x.jpg", sha256: H("x"), kind: "image", tokens: [], tags: [], declaration }] }, required: "files" },
  clipWords: { rel: P.clipWords("CH2-S03"), value: { schemaVersion: 1, segmentId: "CH2-S03", assetId: H("clip"), words: [{ text: "a", startMs: 0, endMs: 100, confidence: null }] }, required: "words" },
  activeTake: { rel: P.activeTake("en"), value: { schemaVersion: 1, lang: "en", takeId: take.id, setAt: TEST_NOW }, required: "takeId" },
  voiceTrack: { rel: P.take("en", take.id), value: take, required: "segments" },
  layout: { rel: P.layout("en"), value: makeLayout({ seconds: 20 }), required: "words" },
  timeline: { rel: P.timeline("en"), value: timeline, required: "video" },
  overrides: { rel: P.overrides("en"), value: { schemaVersion: 1, lang: "en", overrides: [{ id: "o1", createdAt: TEST_NOW, target: { itemId: "x", component: null, beatId: null, planKey: null, assetId: null, wordNorm: null }, override: { op: "removeItem", itemId: "x" } }] }, required: "overrides" },
  timelineLint: { rel: P.timelineLint("en"), value: { schemaVersion: 1, lang: "en", issues: [], stats: {}, rejectedOverrides: [] }, required: "issues" },
  usage: { rel: P.usage("en"), value: { schemaVersion: 1, lang: "en", usage: [{ assetId: H("a"), itemIds: ["v:CH1-B001:0"] }] }, required: "usage" },
  loudness: { rel: P.loudness("en"), value: { schemaVersion: 1, lang: "en", integratedLufs: -14, truePeakDbtp: -1.2, lra: 5, gainDb: 1, limiterMaxGrDb: 0, stems: ["vo", "music", "sfx", "clip"] }, required: "integratedLufs" },
  render: { rel: P.renderDoc("en", "draft"), value: { ...renderResult, schemaVersion: 1, lang: "en", preset: "draft", timelineHash: H("t"), mixHash: null, onlyChapters: null, createdAt: TEST_NOW }, required: "chunks" },
  qa: { rel: P.qaReport("en", "draft"), value: { schemaVersion: 1, lang: "en", preset: "draft", createdAt: TEST_NOW, checks: [], probe: null, loudness: null, contactSheets: [], audioNotListenedNotice: "The mix was checked by meters only; nobody listened to it." }, required: "checks" },
  // non-registry kinds
  fixture: { rel: null, value: { schemaVersion: 1, id: "tulip-mania", title: "T", idea: "Tulip mania", languages: ["en", "fr"], primaryLang: "en", targetMinutes: 20, styleId: "drama-commentary", asOf: "2026-10-02", seed: 1637, autoApproveGates: true }, required: "id" },
  cacheIndex: { rel: null, value: { schemaVersion: 1, blobs: [{ sha256: H("b"), ext: "jpg", bytes: 10, lastUsed: TEST_NOW }] }, required: "blobs" },
  homeConfig: { rel: null, value: { schemaVersion: 1, remotionLicense: null, contact: null, uiLang: "auto", defaults: { languages: ["en"], targetMinutes: 20, styleId: null }, onboardingDone: false }, required: "uiLang" },
  glProbe: { rel: null, value: { schemaVersion: 1, chosen: "swangle", results: [{ gl: "swangle", ok: true, ms: 10, renderer: "SwiftShader" }], gpu: false, probedAt: TEST_NOW }, required: "chosen" },
  browser: { rel: null, value: { schemaVersion: 1, executable: "/x/chrome", version: "1", installedAt: TEST_NOW }, required: "executable" },
  sfxManifest: { rel: null, value: makeSfxManifest(), required: "entries" },
};
