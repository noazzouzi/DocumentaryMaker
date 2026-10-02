// packages/core/src/testing/factories.ts — deterministic factories every package tests against (§4.18 "./testing").
// Browser-safe (no node:*). Every factory returns a schema-valid document; the same options always give the same bytes.
import type { Lang, LintIssue } from "../schema/common";
import { Project } from "../schema/project";
import { FactSheet } from "../schema/research";
import { Script, type ScriptSegment, type ChapterScript, type Device } from "../schema/script";
import { BeatPlansDoc, BeatSlicesDoc, type BeatLang, type BeatPlan, type CueTag, type MotionTemplate } from "../schema/beats";
import { ProgramLayout, type LayoutBeat, type LayoutSegment, type LayoutWord } from "../schema/layout";
import {
  Timeline, type Anchor, type CaptionGroup, type FxCue, type MusicSection, type OverlayItem, type SfxCue, type SilenceMark,
  type Transition, type VisualClip, type TimelineAsset, type VoClip, type ClipAudio, type Marker,
} from "../schema/timeline";
import { MusicTrack, SfxCategory, SfxEntry, SfxManifest } from "../schema/media";
import { FrozenAsset, PicksDoc, type AssetPick, type ClipResolution } from "../schema/assets";
import type { LicenseInfo } from "../schema/license";
import type { StyleData } from "../schema/style";
import { VoiceTrack, type SegmentTake } from "../schema/voice";
import { COMPONENT_META, type OverlayComponentId } from "../schema/components";
import { ids } from "../util/ids";
import { P } from "../util/paths";
import { docHash, hashJson, sha16, sha256Hex, sha12 } from "../util/sha256";
import { frameToMs, framesAt, msToFrame } from "../util/time";
import { beatWordRanges, chapterCardReadMs, spokenText, tokenizeDisplay } from "../util/tokenize";
import { defaultProject } from "../util/project-defaults";
import { dramaCommentaryData } from "./drama";

/** A full, valid StyleData (copy of Appendix A at P0). Test data only — the real style lives in @docmaker/styles. */
export const TEST_STYLE: StyleData = dramaCommentaryData;

/** Fixed clock for every factory document. */
export const TEST_NOW = "2026-10-02T00:00:00.000Z";
export const TEST_SLUG = "tulip-mania";
export const TEST_SEED = 1637;

const PROCEDURAL_LICENSE: LicenseInfo = {
  code: "PROCEDURAL", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false,
  attributionText: null, restrictions: [],
};
const SYNTHETIC_VOICE_LICENSE: LicenseInfo = { ...PROCEDURAL_LICENSE, restrictions: ["synthetic"] };

const fakeSha = (label: string) => sha256Hex(`docmaker-testing:${label}`);

// ------------------------------------------------------------------------------------------------ project & facts
export function makeProject(over?: Partial<Project>): Project {
  const p = defaultProject(
    { idea: "The tulip mania of 1637: how a flower bankrupted Holland", slug: TEST_SLUG, languages: ["en"], targetMinutes: 20, styleId: "drama-commentary", llm: "fixture", fixtureId: "tulip-mania", seed: TEST_SEED },
    new Date(TEST_NOW),
    { hasElevenLabs: false, kokoro: false, piper: false, homeDefaults: null },
  );
  return Project.parse({ ...p, ...over });
}

const PEOPLE = [
  { name: "Carolus Clusius", role: "botanist who brought tulips to Leiden" },
  { name: "Adriaen Pauw", role: "owner of a famous Semper Augustus collection" },
  { name: "Wouter Bartelmiesz", role: "Alkmaar tavern keeper whose bulbs were auctioned" },
  { name: "Pieter Cos", role: "florist who catalogued tulip prices" },
  { name: "Nicolaes Wassenaer", role: "chronicler of the bulb trade" },
];
const QUOTES = [
  "It is all a fever, and fevers break.",
  "Nobody knew what a bulb was worth, only what the next man would pay.",
  "The flower is beautiful; the trade is madness.",
  "We sold paper for paper and called it riches.",
];

export function makeFactSheet(o?: { people?: number; quotes?: number; figures?: number }): FactSheet {
  const nPeople = Math.max(1, o?.people ?? 3);
  const nQuotes = o?.quotes ?? 2;
  const nFigures = o?.figures ?? 2;
  const sources = [1, 2, 3].map((i) => ({
    id: `S${i}`, url: `https://example.org/tulip-source-${i}`, title: `Tulip mania source ${i}`, publisher: ["Rijksmuseum", "The Economist", "Smithsonian Magazine"][i - 1]!,
    publishedAt: "2020-01-01", sourceType: "major_news" as const, reliability: "high" as const, language: "en", fetched: true, cited: 1, snippets: [],
  }));
  const people = Array.from({ length: nPeople }, (_, i) => {
    const b = PEOPLE[i % PEOPLE.length]!;
    return { id: `P${i + 1}`, name: i < PEOPLE.length ? b.name : `${b.name} ${i + 1}`, roleInStory: b.role, publicFigure: true, isMinorOrPrivateVictim: false, imageQueries: [b.name], wikidataQid: null, aliases: [] };
  });
  const quotes = Array.from({ length: nQuotes }, (_, i) => ({
    id: `Q${i + 1}`, speakerId: `P${(i % nPeople) + 1}`, verbatim: QUOTES[i % QUOTES.length]!, language: "en", date: "1637-02",
    context: "pamphlet", medium: "print" as const, sourceId: "S1", youtubeSearchQuery: "", verification: "unchecked" as const, verifiedBy: "none" as const,
  }));
  const figures = Array.from({ length: nFigures }, (_, i) => ({
    id: `N${i + 1}`, label: i === 0 ? "Price of one Semper Augustus bulb" : `Figure ${i + 1}`, value: i === 0 ? 5500 : 1000 * (i + 1), unit: "guilders",
    asOf: "1637", sourceIds: ["S2"], chartable: true,
  }));
  return FactSheet.parse({
    schemaVersion: 1, topic: "Tulip mania", asOf: "2026-10-02", oneLinePremise: "A flower became the first speculative bubble.",
    centralQuestion: "How did a flower bankrupt a nation of merchants?", sources, people,
    timeline: [
      { id: "E1", date: "1593", title: "Clusius plants tulips in Leiden", whatHappened: "First bulbs in the Hortus.", personIds: ["P1"], status: "established_fact", sourceIds: ["S1"], dramaValue: 4 },
      { id: "E2", date: "1637-02-03", title: "The Haarlem auction fails", whatHappened: "Buyers stop showing up.", personIds: [], status: "established_fact", sourceIds: ["S2"], dramaValue: 9 },
    ],
    quotes, figures,
    claims: [
      { id: "C1", summary: "The crash ruined the Dutch economy", madeBy: "popular accounts", against: "", status: "disputed", jurisdiction: "", decisionDate: "", subjectResponse: "", asOf: "2026-10-02", sensitivity: "low", sourceIds: ["S3"] },
      { id: "C2", summary: "Courts declined to enforce futures contracts", madeBy: "historians", against: "", status: "established_fact", jurisdiction: "Court of Holland", decisionDate: "1638", subjectResponse: "", asOf: "2026-10-02", sensitivity: "low", sourceIds: ["S1"] },
    ],
    angles: ["first speculative bubble"], gaps: [],
  });
}

// ------------------------------------------------------------------------------------------------ text banks
const SENTENCES: Record<Lang, string[]> = {
  en: [
    "In 1637, a single tulip bulb sold for 5,500 guilders in Haarlem.",
    "Merchants traded bulbs they had never seen, on paper, in smoky taverns.",
    "Prices doubled in weeks, then doubled again.",
    "Nobody asked what a flower was actually worth.",
    "By February, the buyers simply stopped showing up.",
    "Carolus Clusius had brought the first bulbs to Leiden in 1593.",
    "A Semper Augustus was said to cost as much as a canal house.",
    "The courts refused to enforce most of the contracts.",
    "It collapsed.",
    "Then came the panic.",
    "One pamphlet called it “a fever of the mind”.",
    "Within 3 days, the market was gone.",
  ],
  fr: [
    "En 1637, un seul bulbe de tulipe s’est vendu 5 500 florins à Haarlem.",
    "Les marchands échangeaient des bulbes qu’ils n’avaient jamais vus, sur papier, dans des tavernes enfumées.",
    "Les prix doublaient en quelques semaines, puis doublaient encore.",
    "Personne ne se demandait ce que valait vraiment une fleur.",
    "En février, les acheteurs ont tout simplement disparu.",
    "Charles de l’Écluse avait rapporté les premiers bulbes à Leyde en 1593.",
    "Un Semper Augustus coûtait, disait-on, autant qu’une maison sur un canal.",
    "Les tribunaux ont refusé de faire appliquer la plupart des contrats.",
    "Tout s’est effondré.",
    "Puis vint la panique.",
    "Un pamphlet parlait d’une « fièvre de l’esprit ».",
    "En 3 jours, le marché avait disparu.",
  ],
};
const CHAPTER_TITLES: Record<Lang, string[]> = {
  en: ["The Bulb", "The Bubble", "The Crash", "The Courts", "The Aftermath", "The Legend", "The Lesson", "The Echo"],
  fr: ["Le bulbe", "La bulle", "Le krach", "Les tribunaux", "Les lendemains", "La légende", "La leçon", "L’écho"],
};
const FR_TRANSLATION = "« C’est une fièvre, et les fièvres retombent. »";
const VIDEO_TITLE: Record<Lang, string> = { en: "Tulip Mania: The Flower That Broke Holland", fr: "La tulipomanie : la fleur qui a ruiné la Hollande" };

const OUTLINE_HASH = fakeSha("outline");

function segment(id: string, type: ScriptSegment["type"], displayText: string, o: Partial<ScriptSegment> = {}): ScriptSegment {
  return {
    id, type, displayText, ttsText: type === "narration" ? displayText : "", ttsTextEdited: false, quoteId: null,
    subtitleTranslation: "", factIds: type === "narration" ? ["S1"] : [], device: "none", breathMs: type === "music_breath" ? 2000 : 0,
    primaryHash: null, ...o,
  };
}

function scriptDoc(lang: Lang, chapters: ChapterScript[]): Script {
  return Script.parse({
    schemaVersion: 1, lang, outlineHash: OUTLINE_HASH, title: VIDEO_TITLE[lang], chapters, lint: [] as LintIssue[], generatedBy: "fixture", updatedAt: TEST_NOW,
  });
}

function chapterDoc(lang: Lang, ci: number, segments: ScriptSegment[]): ChapterScript {
  return {
    chapterId: ids.chapter(ci + 1), title: CHAPTER_TITLES[lang][ci % CHAPTER_TITLES[lang].length]!, segments,
    loopsOpened: [], loopsClosed: [], summaryForNext: "", userEdited: false, locked: false,
  };
}

function clipSegment(lang: Lang, id: string): ScriptSegment {
  return segment(id, "clip", QUOTES[0]!, { quoteId: "Q1", factIds: ["Q1"], subtitleTranslation: lang === "fr" ? FR_TRANSLATION : "" });
}

/** chapters × segments of narration (+ optional clip and music_breath segments); EN or FR filler text with digits and « ». */
export function makeScript(o?: { lang?: Lang; chapters?: number; segmentsPerChapter?: number; withClip?: boolean; withBreath?: boolean }): Script {
  const lang = o?.lang ?? "en";
  const nCh = Math.max(1, o?.chapters ?? 3);
  const nSeg = Math.max(1, o?.segmentsPerChapter ?? 4);
  const bank = SENTENCES[lang];
  const clipChapter = nCh >= 2 ? 1 : 0;
  const chapters: ChapterScript[] = [];
  for (let ci = 0; ci < nCh; ci++) {
    const chId = ids.chapter(ci + 1);
    const segs: ScriptSegment[] = [];
    let n = 1;
    for (let si = 0; si < nSeg; si++) {
      const a = bank[(ci * 5 + si * 2) % bank.length]!;
      const b = bank[(ci * 5 + si * 2 + 1) % bank.length]!;
      const device: Device = si === nSeg - 1 ? "cliffhanger" : "none";
      segs.push(segment(ids.segment(chId, n++), "narration", `${a} ${b}`, { device }));
      if (o?.withClip && ci === clipChapter && si === Math.min(1, nSeg - 1)) segs.push(clipSegment(lang, ids.segment(chId, n++)));
    }
    if (o?.withBreath && ci === 0) segs.push(segment(ids.segment(chId, n++), "music_breath", ""));
    chapters.push(chapterDoc(lang, ci, segs));
  }
  return scriptDoc(lang, chapters);
}

// ------------------------------------------------------------------------------------------------ beats
const PLAN_ROTATION: { visualKind: BeatPlan["visualKind"]; visualQuery: string; motionTemplate: MotionTemplate }[] = [
  { visualKind: "archival_photo", visualQuery: "tulip painting seventeenth century", motionTemplate: "none" },
  { visualKind: "stock_broll", visualQuery: "tulip field netherlands", motionTemplate: "kinetic_text" },
  { visualKind: "document_screenshot", visualQuery: "old dutch contract", motionTemplate: "none" },
  { visualKind: "motion_graphic", visualQuery: "price chart", motionTemplate: "counter" },
];

export function planKeyOf(p: Pick<BeatPlan, "visualKind" | "visualQuery" | "personIds" | "motionTemplate" | "quoteId">): string {
  return sha16(hashJson({ visualKind: p.visualKind, visualQuery: p.visualQuery, personIds: p.personIds, motionTemplate: p.motionTemplate, quoteId: p.quoteId }));
}

/** Splits a narration displayText into sentence slices (exact, trimmed). */
function sentenceSlices(text: string): string[] {
  const parts = text.split(/(?<=[.!?»”])\s+(?=\S)/u).map((s) => s.trim()).filter((s) => s !== "");
  return parts.length > 0 ? parts : [text.trim()];
}

function cueFor(text: string, cues: boolean): { cueTags: CueTag[]; cueAnchorIdx: number[] } {
  if (!cues) return { cueTags: [], cueAnchorIdx: [] };
  const words = tokenizeDisplay(text);
  const num = words.find((w) => /\d/.test(w.norm));
  if (num) return { cueTags: [{ type: "NUMBER", value: num.norm.replace(/[^\d.]/g, "") || num.norm }], cueAnchorIdx: [num.idx] };
  return { cueTags: [{ type: "EMPHASIS", value: words[0]?.norm ?? "" }], cueAnchorIdx: [0] };
}

export function makeBeats(script: Script, o?: { cues?: boolean; revealIn?: { segmentId: string; wordIdx: number } | null }): { plans: BeatPlansDoc; slices: BeatSlicesDoc } {
  const cues = o?.cues ?? true;
  const plans: BeatPlan[] = [];
  const texts: BeatLang[] = [];
  let order = 0;
  for (const ch of script.chapters) {
    let seq = 1;
    const st: { prev: BeatPlan | null } = { prev: null };
    for (const seg of ch.segments) {
      if (seg.type === "sponsor_slot") continue;
      if (seg.type === "clip") {
        const p: BeatPlan = {
          id: ids.clipBeat(seg.id), chapterId: ch.chapterId, segmentId: seg.id, order: order++, origin: "clip", purpose: "context", energy: 3,
          estSeconds: 4, visualKind: "youtube_clip", visualQuery: "", personIds: [], quoteId: seg.quoteId, youtubeQuoteToFind: seg.displayText,
          motionTemplate: "none", camera: "static", transitionIn: "cut", sfx: [], musicCue: "duck", musicMood: "none",
          factIds: seg.quoteId ? [seg.quoteId] : [], cueTags: [{ type: "CLIP_REF", value: seg.quoteId ?? "" }], planKey: "",
        };
        p.planKey = planKeyOf(p);
        plans.push(p);
        texts.push({ beatId: p.id, lang: script.lang, text: "", onScreenText: "", cueAnchorIdx: [-1], emphasisIdx: [], motionData: {} });
        continue;
      }
      if (seg.type === "music_breath") {
        const p: BeatPlan = {
          id: ids.breathBeat(seg.id), chapterId: ch.chapterId, segmentId: seg.id, order: order++, origin: "breath", purpose: "transition", energy: 4,
          estSeconds: (seg.breathMs || 2000) / 1000, visualKind: st.prev?.visualKind ?? "stock_broll", visualQuery: st.prev?.visualQuery ?? ch.title.toLowerCase(),
          personIds: [], quoteId: null, youtubeQuoteToFind: "", motionTemplate: "none", camera: "ken_burns", transitionIn: "cut", sfx: [],
          musicCue: "none", musicMood: "tense", factIds: [], cueTags: [{ type: "MONTAGE", value: "" }], planKey: "",
        };
        p.planKey = planKeyOf(p);
        plans.push(p);
        texts.push({ beatId: p.id, lang: script.lang, text: "", onScreenText: "", cueAnchorIdx: [-1], emphasisIdx: [], motionData: {} });
        continue;
      }
      const slices = sentenceSlices(spokenText(seg, "vo"));
      const ranges = beatWordRanges(seg.displayText, slices);
      slices.forEach((text, k) => {
        const rot = PLAN_ROTATION[(order + k) % PLAN_ROTATION.length]!;
        let { cueTags, cueAnchorIdx } = cueFor(text, cues);
        const reveal = o?.revealIn;
        if (reveal && reveal.segmentId === seg.id && reveal.wordIdx >= ranges[k]!.wordStart && reveal.wordIdx < ranges[k]!.wordEnd) {
          cueTags = [...cueTags, { type: "REVEAL", value: tokenizeDisplay(seg.displayText)[reveal.wordIdx]!.norm }];
          cueAnchorIdx = [...cueAnchorIdx, reveal.wordIdx - ranges[k]!.wordStart];
        }
        const nWords = ranges[k]!.wordEnd - ranges[k]!.wordStart;
        const motionData: Record<string, unknown> =
          rot.motionTemplate === "kinetic_text" ? { lines: [text.split(/\s+/).slice(0, 4).join(" ").slice(0, 48)], emphasis: [] }
          : rot.motionTemplate === "counter" ? { figure_id: "N1", value: 5500, from: 0, label: "guilders", unit: "", decimals: 0, format: "number" }
          : {};
        const p: BeatPlan = {
          id: ids.beat(ch.chapterId, seq++), chapterId: ch.chapterId, segmentId: seg.id, order: order++, origin: "llm",
          purpose: k === 0 ? "context" : "escalation", energy: 2 + ((order + k) % 3), estSeconds: Math.max(0.5, Math.round((nWords / 2.6) * 10) / 10),
          visualKind: rot.visualKind, visualQuery: rot.visualQuery, personIds: [], quoteId: null, youtubeQuoteToFind: "",
          motionTemplate: rot.motionTemplate, camera: "ken_burns", transitionIn: "cut", sfx: [], musicCue: k === 0 ? "none" : "build",
          musicMood: "tense", factIds: rot.motionTemplate === "counter" ? ["S1", "N1"] : ["S1"], cueTags, planKey: "",
        };
        p.planKey = planKeyOf(p);
        st.prev = p;
        plans.push(p);
        texts.push({ beatId: p.id, lang: script.lang, text, onScreenText: "", cueAnchorIdx, emphasisIdx: nWords > 1 ? [1] : [], motionData });
      });
    }
  }
  const plansDoc = BeatPlansDoc.parse({
    schemaVersion: 1, primaryLang: script.lang,
    chapters: script.chapters.map((c) => ({
      chapterId: c.chapterId,
      skeletonHash: hashJson(c.segments.map((s) => ({ id: s.id, type: s.type, quoteId: s.quoteId }))),
      textHash: hashJson(c.segments.map((s) => s.displayText)),
      method: "fixture" as const,
    })),
    plans, primary: texts, generatedBy: "fixture", updatedAt: TEST_NOW,
  });
  const slices = BeatSlicesDoc.parse({
    schemaVersion: 1, lang: script.lang, plansHash: docHash(plansDoc), scriptHash: docHash(script), texts,
    chapters: script.chapters.map((c) => ({ chapterId: c.chapterId, method: "planned" as const })), validation: [], updatedAt: TEST_NOW,
  });
  return { plans: plansDoc, slices };
}

// ------------------------------------------------------------------------------------------------ voice
const WORD_FLOOR_MS = 120;
/** Synthetic word timings for a text at `cps` characters per second (relative to the segment file start). */
function synthWords(text: string, cps: number): { words: { idx: number; text: string; startMs: number; endMs: number }[]; durationMs: number } {
  const dw = tokenizeDisplay(text);
  let t = 60;
  const words = dw.map((w) => {
    const len = [...w.norm].length || 1;
    const dur = Math.max(WORD_FLOOR_MS, Math.round((len * 1000) / cps));
    const startMs = t;
    const endMs = t + dur;
    t = endMs + (/[.!?…»”]$/.test(w.text) ? 280 : /[,;:]$/.test(w.text) ? 140 : 40);
    return { idx: w.idx, text: w.text, startMs, endMs };
  });
  const last = words[words.length - 1];
  return { words, durationMs: last ? last.endMs + 120 : 200 };
}

/** Synthetic take with estimated word timings (cps 16.5) — no audio files. */
export function makeTake(script: Script, o?: { cps?: number }): VoiceTrack {
  const cps = o?.cps ?? 16.5;
  const voice = { provider: "synthetic", voiceId: "synthetic-m1", cps };
  const settingsHash = hashJson(voice);
  const pending: Omit<SegmentTake, "file">[] = [];
  for (const ch of script.chapters) {
    for (const seg of ch.segments) {
      if (seg.type !== "narration") continue;
      const text = spokenText(seg, "vo");
      const { words, durationMs } = synthWords(text, cps);
      const ttsText = seg.ttsText || text;
      pending.push({
        segmentId: seg.id, mode: "narration", sha256: fakeSha(`seg:${script.lang}:${seg.id}:${text}`), durationMs, ttsText,
        ttsTextHash: hashJson(ttsText), cacheKey: hashJson({ segmentId: seg.id, ttsText, settingsHash }), leadTrimMs: 0,
        words: words.map((w) => ({ wordId: ids.word(seg.id, w.idx), text: w.text, startMs: w.startMs, endMs: w.endMs, confidence: null, source: "synthetic" as const })),
        providerRequestId: null, asrWer: null, pickup: false,
      });
    }
  }
  const takeId = `scratch-${sha12(["synthetic", "synthetic-m1", settingsHash, ...pending.map((s) => s.cacheKey).sort()].join("|"))}`;
  return VoiceTrack.parse({
    schemaVersion: 1, id: takeId, kind: "scratch", lang: script.lang, provider: "synthetic", voiceId: "synthetic-m1", modelId: null,
    settingsHash, license: SYNTHETIC_VOICE_LICENSE, createdAt: TEST_NOW,
    segments: pending.map((s) => ({ ...s, file: P.takeSegment(script.lang, takeId, s.segmentId) })),
    missingSegmentIds: [], charsBilled: 0, costUsd: 0, timing: { source: "synthetic", meanConfidence: null }, notes: [],
  });
}

// ------------------------------------------------------------------------------------------------ media
const IMG_IDS = (n: number) => Array.from({ length: n }, (_, i) => fakeSha(`image:${i}`));
const VID_IDS = (n: number) => Array.from({ length: n }, (_, i) => fakeSha(`video:${i}`));
const CLIP_ASSET = fakeSha("clip:Q1");
const MUSIC_ASSET = fakeSha("music:tense:92");
const VO_PROGRAM_ASSET = (lang: Lang, takeId: string) => fakeSha(`vo_program:${lang}:${takeId}`);
const VIDEO_FRAMES = 900; // 30 s @ 30 fps: enough media for every factory shot + handles

export function makeFrozen(o?: { images?: number; videos?: number; portrait?: boolean }): Record<string, FrozenAsset> {
  const out: Record<string, FrozenAsset> = {};
  const base = (id: string, kind: "image" | "video", i: number): FrozenAsset => {
    const ext = kind === "image" ? "jpg" : "mp4";
    const portrait = kind === "image" && o?.portrait === true && i === 0;
    return FrozenAsset.parse({
      id, originalSha256: fakeSha(`original:${id}`), kind, role: "broll", mime: kind === "image" ? "image/jpeg" : "video/mp4", ext,
      bytes: kind === "image" ? 412_345 + i : 8_765_432 + i, width: portrait ? 1080 : 1920, height: portrait ? 1350 : 1080,
      durationMs: kind === "video" ? frameToMs(VIDEO_FRAMES, 30) : null, fps: kind === "video" ? 30 : null, hasAudio: kind === "video",
      lufs: kind === "video" ? -23 : null, cacheRel: `blobs/${id.slice(0, 2)}/${id}.${ext}`, projectRel: P.media(id, ext), candidate: null,
      declaration: null,
      conform: { recipe: kind === "image" ? "image-v1" : "video-cfr-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 1000, handleTailMs: 1000 },
      analysis: { grayscale: false, meanLuma: 0.42, year: null, lowRes: false }, frozenAt: TEST_NOW,
    });
  };
  IMG_IDS(o?.images ?? 4).forEach((id, i) => (out[id] = base(id, "image", i)));
  VID_IDS(o?.videos ?? 1).forEach((id, i) => (out[id] = base(id, "video", i)));
  return out;
}

const SCORE = { metadata: 0.5, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0.5, focal: null, safeCrop: null, notes: "" };

export function makePicks(plans: BeatPlansDoc, frozen: Record<string, FrozenAsset>): PicksDoc {
  const all = Object.values(frozen).sort((a, b) => (a.id < b.id ? -1 : 1));
  const visuals = all.filter((a) => a.kind === "image" || a.kind === "video");
  const videos = all.filter((a) => a.kind === "video");
  const picks: AssetPick[] = [];
  const clips: ClipResolution[] = [];
  let k = 0;
  for (const p of plans.plans) {
    if (p.id.endsWith("-CLIP")) {
      const v = videos[0];
      clips.push({
        segmentId: p.segmentId, quoteId: p.quoteId ?? "Q1", assetId: v ? v.id : null, status: v ? "found" : "skipped-offline", source: "auto",
        youtube: null, passageInMs: v ? 1000 : null, passageOutMs: v ? 5000 : null, reason: v ? "" : "no video asset",
      });
      continue;
    }
    if (visuals.length === 0) continue;
    const a = visuals[k++ % visuals.length]!;
    picks.push({
      beatId: p.id, slot: 0, assetId: a.id, role: "primary", focal: { x: 0.5, y: 0.45 }, crop: null,
      sourceInMs: a.kind === "video" ? 1000 : null, sourceOutMs: a.kind === "video" ? 6000 : null, score: SCORE, pickedBy: "auto", planKey: p.planKey,
    });
  }
  return PicksDoc.parse({ schemaVersion: 1, plansHash: docHash(plans), picks, clips, portraits: [], orphans: [], updatedAt: TEST_NOW });
}

const SFX_PEAK: Partial<Record<SfxCategory, { durationMs: number; peakOffsetMs: number; syncPoint: "peak" | "onset" | "end" }>> = {
  riser: { durationMs: 2000, peakOffsetMs: 1970, syncPoint: "end" },
  "swell.reverse": { durationMs: 1500, peakOffsetMs: 1470, syncPoint: "end" },
  "whoosh.heavy": { durationMs: 900, peakOffsetMs: 420, syncPoint: "peak" },
  "whoosh.light": { durationMs: 600, peakOffsetMs: 260, syncPoint: "peak" },
  "whoosh.whip": { durationMs: 400, peakOffsetMs: 160, syncPoint: "peak" },
  "whoosh.up": { durationMs: 700, peakOffsetMs: 520, syncPoint: "peak" },
  drone: { durationMs: 8000, peakOffsetMs: 0, syncPoint: "onset" },
  "ambience.room": { durationMs: 8000, peakOffsetMs: 0, syncPoint: "onset" },
  "ambience.crowd": { durationMs: 8000, peakOffsetMs: 0, syncPoint: "onset" },
  keys: { durationMs: 3000, peakOffsetMs: 0, syncPoint: "onset" },
  heartbeat: { durationMs: 2000, peakOffsetMs: 40, syncPoint: "peak" },
};
const LOOPABLE = new Set<SfxCategory>(["drone", "ambience.room", "ambience.crowd", "keys"]);

export function makeSfxEntry(over?: Partial<SfxEntry>): SfxEntry {
  const category: SfxCategory = over?.category ?? "impact";
  const variant = over?.variant ?? 0;
  const pk = SFX_PEAK[category] ?? { durationMs: 800, peakOffsetMs: 8, syncPoint: "peak" as const };
  return SfxEntry.parse({
    id: `procedural:${category}/${variant}`, category, variant, pack: "procedural",
    file: `/tmp/docmaker-testing/sfx/procedural/1/${category}-${variant}.wav`, assetId: fakeSha(`sfx:${category}:${variant}`),
    durationMs: pk.durationMs, syncPoint: pk.syncPoint, peakOffsetMs: pk.peakOffsetMs, peakDbfs: -3,
    lufs: pk.durationMs >= 400 ? -20 : null, energy: category.startsWith("impact") || category.startsWith("boom") ? 5 : 3,
    loopable: LOOPABLE.has(category), direction: category.startsWith("whoosh") ? "LR" : "none", tags: [category], license: PROCEDURAL_LICENSE,
    ...over,
  });
}

/** One entry per category, analytic peak offsets. */
export function makeSfxManifest(): SfxManifest {
  return SfxManifest.parse({
    schemaVersion: 1, pack: "procedural", version: "1", generatedAt: TEST_NOW,
    entries: SfxCategory.options.map((category) => makeSfxEntry({ category })),
  });
}

export function makeMusicTrack(o?: { bpm?: number; seconds?: number; mood?: MusicTrack["moods"][number] }): MusicTrack {
  const bpm = o?.bpm ?? 92;
  const durationMs = Math.round((o?.seconds ?? 120) * 1000);
  const beat = 60000 / bpm;
  const beatsMs: number[] = [];
  for (let i = 0; i * beat < durationMs; i++) beatsMs.push(Math.round(i * beat));
  const mood = o?.mood ?? "tense";
  return MusicTrack.parse({
    assetId: o?.bpm === undefined && o?.mood === undefined ? MUSIC_ASSET : fakeSha(`music:${mood}:${bpm}`), title: `Procedural ${mood} ${bpm} BPM`, source: "procedural",
    moods: [mood], energy: "mid", bpm, beatsMs, downbeatsMs: beatsMs.filter((_, i) => i % 4 === 0), durationMs, lufs: -18, loopable: true, license: PROCEDURAL_LICENSE,
  });
}

// ------------------------------------------------------------------------------------------------ scenario (script + beats + take + layout)
interface Scenario {
  script: Script; plans: BeatPlansDoc; slices: BeatSlicesDoc; take: VoiceTrack; layout: ProgramLayout; layoutHash: string;
  clipSegments: Set<string>; revealBeat: string | null;
}
const scenarioCache = new Map<string, Scenario>();

function defaultChapters(seconds: number): number {
  if (seconds < 45) return 1;
  return Math.min(6, Math.max(2, Math.round(seconds / 300)));
}

function buildScenario(o: { seconds: number; chapters?: number; fps: 24 | 25 | 30; withClip: boolean; withBreath: boolean; withReveal: boolean }): Scenario {
  const key = JSON.stringify(o);
  const hit = scenarioCache.get(key);
  if (hit) return hit;
  const lang: Lang = "en";
  const fps = o.fps;
  const pauses = TEST_STYLE.pauses;
  const totalMs = Math.round(o.seconds * 1000);
  const nCh = Math.max(1, o.chapters ?? defaultChapters(o.seconds));
  const bank = SENTENCES[lang];
  const cps = 16.5;
  const TAIL_MIN = Math.min(pauses.tailMs, 400);
  const CLIP_MS = 4000;
  const titles = Array.from({ length: nCh }, (_, ci) => CHAPTER_TITLES[lang][ci % CHAPTER_TITLES[lang].length]!);
  const gaps = titles.map((t, ci) => (ci === 0 ? 0 : Math.max(pauses.chapterGapMs, chapterCardReadMs(t, 12))));
  const contentMs = Math.max(0, totalMs - pauses.headMs - TAIL_MIN - gaps.reduce((a, b) => a + b, 0));
  const perChapter = contentMs / nCh;

  // 1. script: fill each chapter's budget with sentences (segments of ≤ 2 sentences)
  const chapters: ChapterScript[] = [];
  let sentenceIx = 0;
  const durOf = (text: string) => synthWords(text, cps).durationMs;
  for (let ci = 0; ci < nCh; ci++) {
    const chId = ids.chapter(ci + 1);
    const segs: ScriptSegment[] = [];
    let n = 1;
    let budget = perChapter;
    if (o.withClip && ci === Math.min(1, nCh - 1)) budget -= CLIP_MS + pauses.clipLeadMs + pauses.clipTailMs;
    if (o.withBreath && ci === 0) budget -= 2000;
    let narr = 0;
    for (let guard = 0; guard < 400; guard++) {
      // pick up to 2 sentences that fit
      const picked: string[] = [];
      for (let tries = 0; tries < bank.length && picked.length < 2; tries++) {
        const s = bank[(sentenceIx + tries) % bank.length]!;
        const cand = [...picked, s].join(" ");
        if (durOf(cand) + pauses.deviceGapMs <= budget) {
          picked.push(s);
          sentenceIx = (sentenceIx + tries + 1) % bank.length;
          tries = -1;
        }
      }
      if (picked.length === 0) {
        if (narr === 0) picked.push(lang === "en" ? "Tulips." : "Tulipes.");
        else break;
      }
      const text = picked.join(" ");
      segs.push(segment(ids.segment(chId, n++), "narration", text));
      budget -= durOf(text) + pauses.segmentGapMs;
      narr++;
      if (o.withClip && ci === Math.min(1, nCh - 1) && narr === 1) segs.push(clipSegment(lang, ids.segment(chId, n++)));
    }
    if (o.withClip && ci === Math.min(1, nCh - 1) && !segs.some((s) => s.type === "clip")) segs.push(clipSegment(lang, ids.segment(chId, n++)));
    if (o.withBreath && ci === 0) segs.push(segment(ids.segment(chId, n++), "music_breath", ""));
    const lastNarr = [...segs].reverse().find((s) => s.type === "narration");
    if (lastNarr && nCh > 1) lastNarr.device = "cliffhanger";
    chapters.push(chapterDoc(lang, ci, segs));
  }
  const script = scriptDoc(lang, chapters);

  // REVEAL: last chapter, first narration segment with ≥ 4 words, word 2
  let revealIn: { segmentId: string; wordIdx: number } | null = null;
  if (o.withReveal) {
    const ch = script.chapters[script.chapters.length - 1]!;
    const seg = ch.segments.find((s) => s.type === "narration" && tokenizeDisplay(s.displayText).length >= 4);
    if (seg) revealIn = { segmentId: seg.id, wordIdx: 2 };
  }
  const { plans, slices } = makeBeats(script, { cues: true, revealIn });
  const take = makeTake(script, { cps });
  const takeSeg = new Map(take.segments.map((s) => [s.segmentId, s]));

  // 2. layout (§9.2, simplified: synthetic take, clips "found")
  const lsegs: LayoutSegment[] = [];
  const lwordsRaw: { id: string; segmentId: string; idx: number; text: string; norm: string; startMs: number; endMs: number }[] = [];
  const chapterStarts: number[] = [];
  const clipSegments = new Set<string>();
  let t = pauses.headMs;
  script.chapters.forEach((ch, ci) => {
    if (ci > 0) {
      chapterStarts.push(t);
      t += gaps[ci]!;
    } else chapterStarts.push(0);
    for (const seg of ch.segments) {
      if (seg.type === "sponsor_slot") continue;
      const mode: LayoutSegment["mode"] = seg.type === "narration" ? "vo" : seg.type === "clip" ? "clip" : "breath";
      if (mode === "clip") t += pauses.clipLeadMs;
      const insertions: LayoutSegment["insertions"] = [];
      const tk = takeSeg.get(seg.id);
      if (revealIn && revealIn.segmentId === seg.id && tk) {
        const k = revealIn.wordIdx;
        if (k === 0) t += pauses.preRevealMs;
        else insertions.push({ afterWordIdx: k - 1, splitAtMs: Math.round((tk.words[k - 1]!.endMs + tk.words[k]!.startMs) / 2), ms: pauses.preRevealMs });
      }
      const start = frameToMs(msToFrame(t, fps), fps);
      const durMs = mode === "vo" ? tk!.durationMs + insertions.reduce((a, x) => a + x.ms, 0) : mode === "clip" ? CLIP_MS : seg.breathMs || 2000;
      const wordStart = lwordsRaw.length;
      if (mode === "vo" && tk) {
        const tok = tokenizeDisplay(spokenText(seg, "vo"));
        tk.words.forEach((w, i) => {
          const shift = insertions.filter((x) => i > x.afterWordIdx).reduce((a, x) => a + x.ms, 0);
          lwordsRaw.push({ id: w.wordId, segmentId: seg.id, idx: i, text: w.text, norm: tok[i]!.norm, startMs: Math.max(0, start + w.startMs + shift), endMs: Math.max(0, start + w.endMs + shift) });
        });
      }
      if (mode === "clip") clipSegments.add(seg.id);
      const from = msToFrame(start, fps);
      const endMs = start + durMs;
      lsegs.push({
        segmentId: seg.id, chapterId: ch.chapterId, mode, from, dur: Math.max(1, msToFrame(endMs, fps) - from), startMs: start, endMs,
        voFile: mode === "vo" ? tk!.file : null, voAssetId: mode === "vo" ? tk!.sha256 : null,
        clipAssetId: mode === "clip" ? CLIP_ASSET : null, clipPassageInMs: mode === "clip" ? 1000 : null,
        insertions, wordStart, wordEnd: lwordsRaw.length,
      });
      t = start + durMs;
      t += mode === "clip" ? pauses.clipTailMs : mode === "vo" && ["cliffhanger", "reveal", "rhetorical_question"].includes(seg.device) ? pauses.deviceGapMs : mode === "vo" ? pauses.segmentGapMs : 0;
    }
  });
  // exact target duration whenever the content fits; otherwise the minimum tail
  const endMs = Math.max(totalMs, t + TAIL_MIN);
  const durationInFrames = Math.max(1, msToFrame(endMs, fps));
  const words: LayoutWord[] = lwordsRaw.map((w, i) => {
    const from = msToFrame(w.startMs, fps);
    const next = lwordsRaw[i + 1];
    const nextFrom = next ? msToFrame(next.startMs, fps) : Number.POSITIVE_INFINITY;
    const end = Math.max(from + 1, Math.min(msToFrame(w.endMs, fps), nextFrom));
    return { id: w.id, segmentId: w.segmentId, idx: w.idx, text: w.text, norm: w.norm, from, dur: end - from, startMs: w.startMs, endMs: w.endMs };
  });
  const shape = TEST_STYLE.scriptProfile.storyShapes[0]!;
  const lchapters: ProgramLayout["chapters"] = script.chapters.map((ch, ci) => {
    const from = msToFrame(chapterStarts[ci]!, fps);
    const end = ci + 1 < script.chapters.length ? msToFrame(chapterStarts[ci + 1]!, fps) : durationInFrames;
    const act = shape.acts[Math.min(ci, shape.acts.length - 1)]!;
    const fw = words.find((w) => w.segmentId.startsWith(ch.chapterId + "-"));
    return { chapterId: ch.chapterId, title: ch.title, act: act.id, macroAct: act.macro, from, dur: end - from, firstWordFrame: fw ? fw.from : null };
  });
  // beats tile their chapter
  const segByIdx = new Map(lsegs.map((s) => [s.segmentId, s]));
  const lbeats: LayoutBeat[] = [];
  let revealBeat: string | null = null;
  for (const ch of lchapters) {
    const planned = plans.plans.filter((p) => p.chapterId === ch.chapterId).sort((a, b) => a.order - b.order);
    const rows: { beatId: string; segmentId: string; onset: number; wordStart: number; wordEnd: number }[] = [];
    const bySeg = new Map<string, BeatPlan[]>();
    for (const p of planned) bySeg.set(p.segmentId, [...(bySeg.get(p.segmentId) ?? []), p]);
    for (const [segId, ps] of bySeg) {
      const ls = segByIdx.get(segId);
      if (!ls) continue;
      if (ls.mode === "vo") {
        const seg = script.chapters.flatMap((c) => c.segments).find((s) => s.id === segId)!;
        const textOf = new Map(slices.texts.map((x) => [x.beatId, x.text]));
        const ranges = beatWordRanges(spokenText(seg, "vo"), ps.map((p) => textOf.get(p.id)!));
        ps.forEach((p, i) => {
          const ws = ls.wordStart + ranges[i]!.wordStart;
          const we = ls.wordStart + ranges[i]!.wordEnd;
          rows.push({ beatId: p.id, segmentId: segId, onset: words[ws]!.from, wordStart: ws, wordEnd: we });
          if (revealIn && revealIn.segmentId === segId && p.cueTags.some((c) => c.type === "REVEAL")) revealBeat = p.id;
        });
      } else {
        for (const p of ps) rows.push({ beatId: p.id, segmentId: segId, onset: ls.from, wordStart: ls.wordStart, wordEnd: ls.wordEnd });
      }
    }
    const chEnd = ch.from + ch.dur;
    const froms = rows.map((r, i) => (i === 0 ? ch.from : r.onset));
    rows.forEach((r, i) => {
      const from = froms[i]!;
      const end = i + 1 < rows.length ? froms[i + 1]! : chEnd;
      lbeats.push({ beatId: r.beatId, segmentId: r.segmentId, chapterId: ch.chapterId, from, dur: Math.max(1, end - from), onsetFrame: r.onset, wordStart: r.wordStart, wordEnd: r.wordEnd });
    });
  }
  const layout = ProgramLayout.parse({
    schemaVersion: 1, lang, fps, takeId: take.id, takeKind: take.kind, scriptHash: docHash(script), plansHash: docHash(plans),
    slicesHash: docHash(slices), onlyChapters: null, pauses, durationInFrames, durationMs: frameToMs(durationInFrames, fps),
    chapters: lchapters, segments: lsegs, beats: lbeats, words, sponsorMarkers: [],
    voProgram: { assetId: VO_PROGRAM_ASSET(lang, take.id), projectRel: P.voProgram(lang), bakedGainDb: -3.2, durationMs: frameToMs(durationInFrames, fps) },
  });
  const sc: Scenario = { script, plans, slices, take, layout, layoutHash: docHash(layout), clipSegments, revealBeat };
  scenarioCache.set(key, sc);
  return sc;
}

export function makeLayout(o?: { seconds?: number; chapters?: number; fps?: 24 | 25 | 30; withClip?: boolean; withBreath?: boolean; withReveal?: boolean }): ProgramLayout {
  return structuredClone(buildScenario({
    seconds: o?.seconds ?? 60, chapters: o?.chapters, fps: o?.fps ?? 30, withClip: o?.withClip ?? false, withBreath: o?.withBreath ?? false, withReveal: o?.withReveal ?? false,
  }).layout);
}

/** The script/beats/take/layout set a makeLayout()/makeTimeline() call with the same options was built from. */
export function makeScenario(o?: { seconds?: number; chapters?: number; fps?: 24 | 25 | 30; withClip?: boolean; withBreath?: boolean; withReveal?: boolean }): {
  script: Script; plans: BeatPlansDoc; slices: BeatSlicesDoc; take: VoiceTrack; layout: ProgramLayout; layoutHash: string;
} {
  const s = buildScenario({
    seconds: o?.seconds ?? 60, chapters: o?.chapters, fps: o?.fps ?? 30, withClip: o?.withClip ?? false, withBreath: o?.withBreath ?? false, withReveal: o?.withReveal ?? false,
  });
  return structuredClone({ script: s.script, plans: s.plans, slices: s.slices, take: s.take, layout: s.layout, layoutHash: s.layoutHash });
}

// ------------------------------------------------------------------------------------------------ timeline
const A = {
  beat: (beatId: string, edge: "start" | "end", offset = 0): Anchor => ({ ref: "beat", beatId, edge, offset }),
  seg: (segmentId: string, edge: "start" | "end", offset = 0): Anchor => ({ ref: "segment", segmentId, edge, offset }),
  ch: (chapterId: string, edge: "start" | "end", offset = 0): Anchor => ({ ref: "chapter", chapterId, edge, offset }),
  word: (wordId: string, edge: "start" | "end", expectNorm: string, offset = 0): Anchor => ({ ref: "word", wordId, edge, offset, expectNorm }),
};

const M1_ROTATION: OverlayComponentId[] = ["LowerThird", "NumberCounter", "DateStamp", "MapPin", "DocumentCard", "KineticText", "KeywordSlam", "Stamp", "SourceLabel"];

function overlayProps(c: OverlayComponentId, n: number, lang: Lang, style: StyleData): Record<string, unknown> {
  const pal = style.tokens.palette;
  switch (c) {
    case "LowerThird": return { name: PEOPLE[n % PEOPLE.length]!.name, role: "Botanist, Leiden", align: "left" };
    case "NumberCounter": return { value: 5500, from: 0, format: "currency", currency: "NLG", decimals: 0, label: "for one bulb", locale: lang === "fr" ? "fr-FR" : "en-US", color: pal.money };
    case "DateStamp": return { text: "February 1637", zone: "topLeft" };
    case "MapPin": return { places: [{ label: "Haarlem", lon: 4.6462, lat: 52.3874, at: 0 }, { label: "Leiden", lon: 4.497, lat: 52.1601, at: 20 }], route: true, region: "europe", look: "paper" };
    case "DocumentCard": return { docType: "contract", title: "Bulb sale contract", lines: ["Sold: one Semper Augustus", "Price: 5,500 guilders", "Delivery: June 1637"], redactions: [], stamp: "VOID", sourceLabel: "Source: Rijksmuseum", stampAt: 20, redactAt: 0 };
    case "KineticText": return { lines: ["PRICES DOUBLED", "THEN DOUBLED AGAIN"], emphasis: ["DOUBLED"], align: "center" };
    case "KeywordSlam": return { text: "COLLAPSED", color: pal.danger, background: "black" };
    case "Stamp": return { text: "BANKRUPT", color: pal.danger, rotationDeg: -8, x: 0.5, y: 0.5, scale: 1 };
    case "SourceLabel": return { text: "Source: Rijksmuseum, 1640", kind: "source", zone: "topRight" };
    case "ChapterCard": return { index: n + 1, total: n + 1, title: "Chapter", kicker: lang === "fr" ? `CHAPITRE ${n + 1}` : `CHAPTER ${n + 1}`, letterbox: false, backdrop: "gradientGrid" };
    case "TitleSting": return { title: VIDEO_TITLE[lang].slice(0, 80), kicker: "", mode: "slam", backdrop: "darkNoise" };
    default: return {};
  }
}

const zFor = (band: string) => (band === "picture" ? 10 : band === "graphics" ? 100 : 200);

export function makeTimeline(o?: { seconds?: number; overlays?: boolean; audio?: boolean; transitions?: boolean; fps?: 24 | 25 | 30 }): Timeline {
  const fps = o?.fps ?? 30;
  const sc = buildScenario({ seconds: o?.seconds ?? 60, fps, withClip: false, withBreath: false, withReveal: false });
  const withOverlays = o?.overlays ?? true;
  const withAudio = o?.audio ?? true;
  const withTransitions = o?.transitions ?? true;
  const { layout, script, take } = sc;
  const lang = layout.lang;
  const N = layout.durationInFrames;
  const style = TEST_STYLE;
  const assets: Record<string, TimelineAsset> = {};
  const addAsset = (id: string, a: Omit<TimelineAsset, "id">) => { assets[id] = { id, ...a }; };
  const images = IMG_IDS(4);
  const videos = VID_IDS(1);
  const maxShot = framesAt(fps, 150);

  // ---- picture: every beat split into ≤ 5 s shots; cut points from beat starts (+ offsets)
  const video: VisualClip[] = [];
  const chapterFirst = new Set(layout.chapters.map((c) => c.from));
  let shotNo = 0;
  for (const b of layout.beats) {
    const n = Math.max(1, Math.ceil(b.dur / maxShot));
    const step = Math.floor(b.dur / n);
    for (let s = 0; s < n; s++) {
      const off = s * step;
      const from = b.from + off;
      const end = s + 1 < n ? b.from + (s + 1) * step : b.from + b.dur;
      const dur = end - from;
      const k = shotNo++;
      const kind = k % 5 === 3 ? "video" : k % 7 === 5 ? "generated" : "image";
      const assetId = kind === "video" ? videos[0]! : images[k % images.length]!;
      const source: VisualClip["source"] =
        kind === "image" ? { kind: "image", assetId, crop: null, focal: { x: 0.5, y: 0.45 } }
        : kind === "video" ? { kind: "video", assetId, sourceInFrames: framesAt(fps, 30), crop: null, focal: { x: 0.5, y: 0.5 } }
        : { kind: "generated", recipe: "gradientGrid", text: "1637", palette: [style.tokens.palette.ink, style.tokens.palette.accent], seed: k };
      if (kind === "image") addAsset(assetId, { kind: "image", ext: "jpg", mime: "image/jpeg", width: 1920, height: 1080, durationFrames: null, hasAudio: false, projectRel: P.media(assetId, "jpg") });
      if (kind === "video") addAsset(assetId, { kind: "video", ext: "mp4", mime: "video/mp4", width: 1920, height: 1080, durationFrames: framesAt(fps, VIDEO_FRAMES), hasAudio: true, projectRel: P.media(assetId, "mp4") });
      const card = kind === "image" && k % 4 === 2;
      let transitionIn: Transition = { kind: "cut", accent: { type: "none" } };
      const prev = video[video.length - 1];
      if (withTransitions && prev && !chapterFirst.has(from)) {
        if (k % 6 === 1) transitionIn = { kind: "cut", accent: { type: "pulse", amt: 0.05, frames: framesAt(fps, 8) } };
        else if (k % 6 === 4) transitionIn = { kind: "cover", presentation: "flash", durationFrames: 8, direction: "left", color: "#FFFFFF", peak: 0.6 };
        else if (k % 6 === 2 && prev.source.kind === "image" && kind === "image" && Math.min(prev.dur, dur) >= 14) {
          transitionIn = { kind: "overlap", presentation: "dissolve", durationFrames: 10, direction: "left" };
        }
      }
      video.push({
        id: ids.shot(b.beatId, s), start: A.beat(b.beatId, "start", off), end: s + 1 < n ? A.beat(b.beatId, "start", (s + 1) * step) : A.beat(b.beatId, "end"),
        from, dur, chapterId: b.chapterId, beatId: b.beatId, source, layout: card ? "card" : "cover",
        layoutParams: card ? { backdrop: "gradientGrid", heightFrac: 0.78, borderPx: 12, tiltDeg: -1.5, shadow: true, stroke: null, entry: "scale", backdropSeed: k } : null,
        camera: {
          kind: "kenBurns", keys: [{ f: 0, scale: 1.04, x: 0, y: 0, rot: 0 }, { f: dur, scale: 1.04 + 0.03 * (dur / fps), x: -12, y: 0, rot: 0 }],
          ease: "kb", origin: { x: 0.5, y: 0.45 }, blurFromPx: 0, handheld: null, direction: k % 2 ? "in" : "left",
        },
        treatment: "none", transitionIn, sourceLabel: null, name: `${b.beatId} shot ${s + 1}`,
      });
    }
  }

  // ---- overlays (graphics band; every M1 component when the program is long enough)
  const overlays: OverlayItem[] = [];
  const sfx: SfxCue[] = [];
  const sfxAssets = new Set<string>();
  if (withOverlays) {
    const metaOf = (c: OverlayComponentId) => COMPONENT_META[c];
    const push = (c: OverlayComponentId, ref: string, n: number, start: Anchor, end: Anchor, from: number, dur: number, beatId: string | null) => {
      const m = metaOf(c);
      const item = {
        id: ids.overlay(ref, c, n), start, end, from, dur, beatId, band: m.band, z: zFor(m.band) + overlays.length % 10, zone: m.defaultZone,
        enterFrames: framesAt(fps, m.enter30), exitFrames: framesAt(fps, m.exit30), followsCamera: m.followsCamera, component: c,
        props: overlayProps(c, n, lang, style),
      } as OverlayItem;
      overlays.push(item);
      const cat = m.defaultSfx[0];
      if (withAudio && cat && from >= 4) {
        const e = makeSfxEntry({ category: cat });
        const peak = Math.min(2, from);
        const sdur = Math.min(framesAt(fps, 20), N - (from - peak));
        if (sdur >= 1) {
          sfxAssets.add(e.assetId);
          sfx.push({
            id: ids.sfx(item.id, cat), start: { ...start, offset: (start as { offset: number }).offset - peak }, end: { ...start, offset: (start as { offset: number }).offset - peak + sdur },
            from: from - peak, dur: sdur, sfxId: e.id, assetId: e.assetId, category: cat, eventFrame: from, peakOffsetFrames: peak, gainDb: -6, pan: 0,
            panSweep: null, loop: false, fadeInFrames: 0, fadeOutFrames: 0, priority: 3, combo: null, reason: `${c} entry`, sourceItemId: item.id,
          });
        }
      }
    };
    // structural: TitleSting at the program start, ChapterCard at every later chapter start
    for (const [ci, ch] of layout.chapters.entries()) {
      const c: OverlayComponentId = ci === 0 ? "TitleSting" : "ChapterCard";
      const hold = Math.min(framesAt(fps, metaOf(c).minHold30), ch.dur);
      if (hold < 1) continue;
      const item = { off: ci === 0 ? 0 : 0 };
      push(c, ch.chapterId, ci, A.ch(ch.chapterId, "start", item.off), A.ch(ch.chapterId, "start", item.off + hold), ch.from, hold, null);
    }
    let rot = 0;
    for (const b of layout.beats) {
      const lead = framesAt(fps, 6);
      const avail = b.dur - lead;
      const c = M1_ROTATION[rot % M1_ROTATION.length]!;
      const want = framesAt(fps, metaOf(c).minHold30);
      if (avail < Math.min(want, framesAt(fps, 30))) continue;
      if (layout.chapters.some((ch) => ch.from === b.from)) continue; // keep chapter starts for the structural cards
      const hold = Math.min(want, avail);
      push(c, b.beatId, 0, A.beat(b.beatId, "start", lead), A.beat(b.beatId, "start", lead + hold), b.from + lead, hold, b.beatId);
      rot++;
    }
  }

  // ---- captions: SRT groups of ≤ 4 words + one burned keyword caption per segment
  const captions: CaptionGroup[] = [];
  for (const seg of layout.segments) {
    if (seg.mode !== "vo") continue;
    const ws = layout.words.slice(seg.wordStart, seg.wordEnd);
    for (let g = 0, n = 0; g < ws.length; g += 4, n++) {
      const grp = ws.slice(g, g + 4);
      const first = grp[0]!;
      const last = grp[grp.length - 1]!;
      captions.push({
        id: ids.caption(seg.segmentId, n), start: A.word(first.id, "start", first.norm), end: A.word(last.id, "end", last.norm),
        from: first.from, dur: last.from + last.dur - first.from, segmentId: seg.segmentId, variant: "srt", burn: false,
        words: grp.map((w) => ({ wordId: w.id, text: w.text, from: w.from, dur: w.dur, tone: "normal" as const, hero: false })),
      });
    }
    const kw = ws.find((w) => /\d/.test(w.norm)) ?? ws[Math.min(1, ws.length - 1)];
    if (kw) {
      const dur = Math.max(kw.dur, framesAt(fps, 18));
      if (kw.from + dur <= N) {
        captions.push({
          id: ids.keywordCaption(seg.segmentId, 0), start: A.word(kw.id, "start", kw.norm), end: A.word(kw.id, "start", kw.norm, dur),
          from: kw.from, dur, segmentId: seg.segmentId, variant: "keywords", burn: true,
          words: [{ wordId: kw.id, text: kw.text, from: kw.from, dur: kw.dur, tone: /\d/.test(kw.norm) ? "money" : "keyword", hero: true }],
        });
      }
    }
  }

  // ---- fx: one punch per chapter on its first numeric (or second) word
  const fx: FxCue[] = [];
  for (const ch of layout.chapters) {
    const ws = layout.words.filter((w) => w.segmentId.startsWith(ch.chapterId + "-"));
    const w = ws.find((x) => /\d/.test(x.norm)) ?? ws[1] ?? ws[0];
    if (!w) continue;
    const dur = framesAt(fps, 8);
    if (w.from + dur > N) continue;
    const shot = video.find((v) => v.from <= w.from && w.from < v.from + v.dur)!;
    fx.push({
      id: ids.fx(shot.id, "punch"), start: A.word(w.id, "start", w.norm), end: A.word(w.id, "start", w.norm, dur), from: w.from, dur, fx: "punch", shape: "hit",
      pre: 2, curve: 2, fade: 0, amt: 0.06, decay: 9, hz: null, ampY: null, rotDeg: null, x: 0.5, y: 0.45, color: null, seed: TEST_SEED, target: "picture+followers",
    });
  }

  // ---- audio
  const d = { musicDuckDb: -12, sfxDuckDb: -4, clipDuckDb: -10, musicUnderClipDb: -12, attackMs: 150, releaseMs: 400, bridgeMs: 600, padBeforeMs: 80, padAfterMs: 120 };
  const voSpans: [number, number][] = [];
  for (const seg of layout.segments) {
    if (seg.mode !== "vo" && seg.mode !== "clip-narrated") continue;
    for (const w of layout.words.slice(seg.wordStart, seg.wordEnd)) {
      const a = w.from;
      const b = w.from + w.dur;
      const last = voSpans[voSpans.length - 1];
      if (last && frameToMs(a - last[1], fps) < d.bridgeMs) last[1] = Math.max(last[1], b);
      else voSpans.push([a, b]);
    }
  }
  const vo: VoClip[] = [];
  const music: MusicSection[] = [];
  const silences: SilenceMark[] = [];
  const clipAudio: ClipAudio[] = [];
  const voProgramId = layout.voProgram.assetId;
  addAsset(voProgramId, { kind: "audio", ext: "wav", mime: "audio/wav", width: null, height: null, durationFrames: N, hasAudio: true, projectRel: layout.voProgram.projectRel });
  if (withAudio) {
    const takeSeg = new Map(take.segments.map((s) => [s.segmentId, s]));
    for (const seg of layout.segments) {
      if (seg.mode !== "vo") continue;
      const ts = takeSeg.get(seg.segmentId)!;
      vo.push({ id: ids.vo(seg.segmentId), start: A.seg(seg.segmentId, "start"), end: A.seg(seg.segmentId, "end"), from: seg.from, dur: seg.dur, segmentId: seg.segmentId, assetId: ts.sha256, sourceInFrames: 0, gainDb: layout.voProgram.bakedGainDb });
      addAsset(ts.sha256, { kind: "audio", ext: "wav", mime: "audio/wav", width: null, height: null, durationFrames: msToFrame(ts.durationMs, fps), hasAudio: true, projectRel: ts.file });
    }
    const track = makeMusicTrack();
    addAsset(track.assetId, { kind: "audio", ext: "wav", mime: "audio/wav", width: null, height: null, durationFrames: msToFrame(track.durationMs, fps), hasAudio: true, projectRel: P.media(track.assetId, "wav") });
    for (const ch of layout.chapters) {
      music.push({
        id: ids.music(ch.chapterId), start: A.ch(ch.chapterId, "start"), end: A.ch(ch.chapterId, "end"), from: ch.from, dur: ch.dur, assetId: track.assetId,
        sourceInFrames: 0, loop: true, gainDb: 0, fadeInFrames: Math.min(15, ch.dur), fadeOutFrames: Math.min(30, ch.dur), endMode: "fade", alignDownbeatAt: null,
        mood: "tense", energy: "mid", bpm: track.bpm,
      });
    }
    for (const ch of layout.chapters.slice(1)) {
      const dur = Math.min(framesAt(fps, 12), ch.dur);
      silences.push({ id: ids.silence("chapter", ch.chapterId), start: A.ch(ch.chapterId, "start"), end: A.ch(ch.chapterId, "start", dur), from: ch.from, dur, reason: "chapter", affects: ["music"] });
    }
    for (const id of sfxAssets) addAsset(id, { kind: "audio", ext: "wav", mime: "audio/wav", width: null, height: null, durationFrames: framesAt(fps, 240), hasAudio: true, projectRel: P.media(id, "wav") });
  }

  const markers: Marker[] = layout.chapters.map((ch) => ({ id: ids.marker("chapter", ch.chapterId), frame: ch.from, dur: 0, name: ch.title, note: "", color: "blue", kind: "chapter" }));

  return Timeline.parse({
    schemaVersion: 1, projectSlug: TEST_SLUG, lang, title: script.title, styleId: style.manifest.id, seed: TEST_SEED, fps, width: 1920, height: 1080,
    durationInFrames: N, layoutHash: sc.layoutHash, takeId: take.id, takeKind: take.kind, onlyChapters: null, directorVersion: "2.0.0",
    captionsMode: "burn",
    chapters: layout.chapters.map((c) => ({ id: c.chapterId, title: c.title, act: c.act, from: c.from, dur: c.dur })),
    video, overlays, captions, fx,
    audio: { voProgram: { assetId: voProgramId, bakedGainDb: layout.voProgram.bakedGainDb }, voSpans, vo, music, sfx: withAudio ? sfx : [], clip: clipAudio, silences, ducking: d },
    grade: style.grade, markers, assets,
    render: { styleId: style.manifest.id, tokens: style.tokens, motion: style.motion, captionDNA: style.captionDNA, stills: style.stills.card, theme: null, fonts: [] },
  });
}
