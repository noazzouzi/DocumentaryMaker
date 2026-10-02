// Test inputs built from @docmaker/core/testing factories (deterministic).
import {
  docHash, ids, Outline, P, sha256Hex, type BeatPlansDoc, type BeatSlicesDoc, type ClipResolution, type FactSheet, type FrozenAsset,
  type Lang, type ProgramLayout, type Script, type StyleData, type StyleRenderTokens, type VoiceTrack,
} from "@docmaker/core";
import {
  TEST_NOW, TEST_STYLE, makeFactSheet, makeFrozen, makeMusicTrack, makePicks, makeProject, makeSfxManifest, makeTake,
} from "@docmaker/core/testing";
import { layoutProgram, type DirectorInput, type LayoutInput } from "../src/index";

export const fakeSha = (label: string) => sha256Hex(`director-test:${label}`);

export function makeOutline(script: Script, style: StyleData = TEST_STYLE, o?: { adBreakAfter?: string[]; acts?: string[] }): Outline {
  const shape = style.scriptProfile.storyShapes.find((s) => s.id === style.scriptProfile.defaultShape)!;
  const n = script.chapters.length;
  const chapters = script.chapters.map((c, ci) => {
    const ai = o?.acts?.[ci] ?? (ci === 0 ? shape.acts[0]!.id : shape.acts[Math.min(shape.acts.length - 1, Math.max(1, Math.round((ci * (shape.acts.length - 1)) / Math.max(1, n - 1))))]!.id);
    return {
      id: c.chapterId, act: ai, title: c.title, targetSec: 60, targetWords: 150, purpose: "", eventIds: [], claimIds: [], quoteIds: [],
      opensLoops: [], closesLoops: [], exitHook: "", adBreakAfter: o?.adBreakAfter?.includes(c.chapterId) ?? false,
    };
  });
  const budget = {
    lang: script.lang, minutes: 10, storyShape: shape.id, charsPerSec: 16.5, runtimeSec: 600, narrationSec: 500, chars: 8000, words: 1500,
    chapters: n, perAct: {}, beatsApprox: 150,
  };
  return Outline.parse({
    schemaVersion: 1, lang: script.lang, title: script.title, thesis: "t", thesisConfirmed: true, storyShape: shape.id, hookTeasers: [], loops: [],
    chapters, callbackPlan: [], nextVideoBridge: "", budget, budgets: {}, generatedBy: "fixture", updatedAt: TEST_NOW,
  });
}

export function renderTokensOf(style: StyleData = TEST_STYLE): StyleRenderTokens {
  return { styleId: style.manifest.id, tokens: style.tokens, motion: style.motion, captionDNA: style.captionDNA, stills: style.stills.card, theme: null, fonts: [] };
}

export interface Built {
  layoutInput: LayoutInput; layout: ProgramLayout; layoutHash: string; input: DirectorInput;
  script: Script; plans: BeatPlansDoc; slices: BeatSlicesDoc; take: VoiceTrack; facts: FactSheet; frozen: Record<string, FrozenAsset>;
}

/** Layout input from a script/beats/take set, then the director input around the computed layout. */
export function buildInputs(o: {
  script: Script; plans: BeatPlansDoc; slices: BeatSlicesDoc; take?: VoiceTrack; clips?: ClipResolution[]; frozen?: Record<string, FrozenAsset>;
  fps?: 24 | 25 | 30; style?: StyleData; outline?: Outline; lang?: Lang; clipFallback?: "narrated" | "card"; facts?: FactSheet;
  over?: Partial<DirectorInput>;
}): Built {
  const style = o.style ?? TEST_STYLE;
  const fps = o.fps ?? 30;
  const take = o.take ?? makeTake(o.script);
  const frozen = o.frozen ?? makeFrozen({ images: 12, videos: 2 });
  const outline = o.outline ?? makeOutline(o.script, style);
  const layoutInput: LayoutInput = {
    lang: o.script.lang, fps, script: o.script, plans: o.plans.plans, texts: o.slices.texts, take, clips: o.clips ?? [], frozen,
    pauses: style.pauses, clipFallback: o.clipFallback ?? "narrated", outline, style: { scriptProfile: style.scriptProfile, budgets: style.budgets },
    storyShapeId: outline.storyShape, scriptHash: docHash(o.script), plansHash: docHash(o.plans), slicesHash: docHash(o.slices), onlyChapters: null,
  };
  const partial = layoutProgram(layoutInput);
  const layout: ProgramLayout = {
    ...partial,
    voProgram: { assetId: fakeSha(`vo_program:${take.id}`), projectRel: P.voProgram(o.script.lang), bakedGainDb: -3.2, durationMs: partial.durationMs },
  };
  const layoutHash = docHash(layout);
  const facts = o.facts ?? makeFactSheet({ people: 3, quotes: 2, figures: 2 });
  const picks = makePicks(o.plans, frozen);
  if (o.clips) picks.clips = o.clips;
  const input: DirectorInput = {
    project: makeProject(),
    lang: o.script.lang, style, renderTokens: renderTokensOf(style), layout, layoutHash, script: o.script,
    plans: o.plans.plans, texts: o.slices.texts, facts, picks, frozen, clipWords: {},
    sfx: makeSfxManifest().entries, music: [makeMusicTrack({ seconds: 150 })], voiceProvider: "synthetic", takeKind: "scratch",
    pickupSegments: [], personAcks: [], riskFlags: [], factCheck: null, overrides: null, validateAsset: () => [],
    ...o.over,
  };
  return { layoutInput, layout, layoutHash, input, script: o.script, plans: o.plans, slices: o.slices, take, facts, frozen };
}

/** A clip resolution for a clip segment, pointing at a frozen video. */
export function foundClip(segmentId: string, assetId: string, inMs = 1000, outMs = 5000): ClipResolution {
  return {
    segmentId, quoteId: "Q1", assetId, status: "found", source: "auto",
    youtube: {
      videoId: "abc123", channel: "Rijksmuseum Channel", channelVerified: true, publishedAt: "2016-05-01", url: "https://www.youtube.com/watch?v=abc123",
      startMs: 70000, endMs: 74000, transcriptLang: "en", transcriptKind: "manual", matchScore: 0.95, matchedText: "",
    },
    passageInMs: inMs, passageOutMs: outMs, reason: "",
  };
}

export const videoIds = (frozen: Record<string, FrozenAsset>) => Object.values(frozen).filter((a) => a.kind === "video").map((a) => a.id).sort();
export const imageIds = (frozen: Record<string, FrozenAsset>) => Object.values(frozen).filter((a) => a.kind === "image").map((a) => a.id).sort();
export { ids };
