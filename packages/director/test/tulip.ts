// Test-only loader of the tulip-mania fixture (fixtures/tulip-mania/llm, EN): wire JSON → core documents, then a synthetic
// take, procedural-like media and picks. Mirrors the demo content the offline pipeline directs (W2 owns the real mappers).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BeatPlansDoc, BeatSlicesDoc, FactSheet, Outline, SfxCategory, Script, docHash, ids, normWord, tokenizeDisplay,
  type BeatLang, type BeatPlan, type ChapterScript, type CueTag, type ScriptSegment,
} from "@docmaker/core";
import { TEST_NOW, TEST_STYLE, makeFrozen, makeMusicTrack, makePicks, makeSfxEntry, makeTake, planKeyOf } from "@docmaker/core/testing";
import { buildInputs, type Built } from "./fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "..", "..", "fixtures", "tulip-mania", "llm");
type W = Record<string, unknown>;
const read = (f: string): W => JSON.parse(readFileSync(join(dir, f), "utf8")) as W;
const arr = (v: unknown) => (Array.isArray(v) ? (v as W[]) : []);

function facts(): FactSheet {
  const f = read("factsheet.json");
  return FactSheet.parse({
    schemaVersion: 1, topic: f.topic, asOf: f.as_of, oneLinePremise: f.one_line_premise, centralQuestion: f.central_question,
    sources: arr(f.sources).map((s) => ({ id: s.id, url: s.url, title: s.title, publisher: s.publisher, publishedAt: s.published_at ?? "", sourceType: s.source_type, reliability: s.reliability, language: s.language ?? "", fetched: false, cited: 1, snippets: [] })),
    people: arr(f.people).map((p) => ({ id: p.id, name: p.name, roleInStory: p.role_in_story, publicFigure: p.public_figure, isMinorOrPrivateVictim: p.is_minor_or_private_victim, imageQueries: p.image_queries ?? [], wikidataQid: null, aliases: [] })),
    timeline: arr(f.timeline).map((e) => ({ id: e.id, date: e.date, title: e.title, whatHappened: e.what_happened, personIds: e.person_ids, status: e.status, sourceIds: e.source_ids, dramaValue: e.drama_value })),
    quotes: arr(f.quotes).map((q) => ({ id: q.id, speakerId: q.speaker_id, verbatim: q.verbatim, language: q.language, date: q.date, context: q.context, medium: q.medium, sourceId: q.source_id, youtubeSearchQuery: q.youtube_search_query ?? "", verification: "unchecked", verifiedBy: "none" })),
    figures: arr(f.figures).map((n) => ({ id: n.id, label: n.label, value: n.value, unit: n.unit, asOf: n.as_of, sourceIds: n.source_ids, chartable: n.chartable })),
    claims: arr(f.claims).map((c) => ({ id: c.id, summary: c.summary, madeBy: c.made_by, against: c.against, status: c.status, jurisdiction: c.jurisdiction, decisionDate: c.decision_date, subjectResponse: c.subject_response, asOf: f.as_of, sensitivity: c.sensitivity, sourceIds: c.source_ids })),
    angles: f.angles ?? [], gaps: f.gaps ?? [],
  });
}

function outline(): Outline {
  const o = read("outline.json");
  const chapters = arr(o.chapters).map((c) => ({
    id: c.id, act: c.act, title: c.title, targetSec: Math.max(5, Number(c.target_words) / 2.6), targetWords: c.target_words, purpose: c.purpose,
    eventIds: c.event_ids ?? [], claimIds: c.claim_ids ?? [], quoteIds: c.quote_ids ?? [], opensLoops: c.opens_loops ?? [], closesLoops: c.closes_loops ?? [],
    exitHook: c.exit_hook ?? "", adBreakAfter: c.ad_break_after ?? false,
  }));
  const budget = { lang: "en", minutes: 1.5, storyShape: o.story_shape, charsPerSec: 16.5, runtimeSec: 90, narrationSec: 74, chars: 1220, words: 218, chapters: chapters.length, perAct: {}, beatsApprox: 30 };
  return Outline.parse({
    schemaVersion: 1, lang: "en", title: o.title, thesis: o.thesis, thesisConfirmed: true, storyShape: o.story_shape,
    hookTeasers: arr(o.hook_teasers).map((h) => ({ id: h.id, teaser: h.teaser, paidOffIn: h.paid_off_in })),
    loops: arr(o.loops).map((l) => ({ id: l.id, question: l.question, openedIn: l.opened_in, closedIn: l.closed_in })),
    chapters, callbackPlan: o.callback_plan ?? [], nextVideoBridge: o.next_video_bridge ?? "", budget, budgets: {}, generatedBy: "fixture", updatedAt: TEST_NOW,
  });
}

export function tulipDocs(): { script: Script; plans: BeatPlansDoc; slices: BeatSlicesDoc; facts: FactSheet; outline: Outline } {
  const chs = ["CH1", "CH2", "CH3"];
  let title = "";
  const chapters: ChapterScript[] = chs.map((id) => {
    const c = read(`chapter.en.${id}.json`);
    title ||= String(c.video_title ?? "");
    const segments: ScriptSegment[] = arr(c.segments).map((s) => ({
      id: String(s.id), type: s.type as ScriptSegment["type"], displayText: String(s.text ?? ""), ttsText: s.type === "narration" ? String(s.text) : "", ttsTextEdited: false,
      quoteId: s.quote_id ? String(s.quote_id) : null, subtitleTranslation: String(s.subtitle_translation ?? ""), factIds: (s.fact_ids as string[]) ?? [],
      device: (s.device as ScriptSegment["device"]) ?? "none", breathMs: s.type === "music_breath" ? 2000 : 0, primaryHash: null,
    }));
    return { chapterId: id, title: String(c.title), segments, loopsOpened: [], loopsClosed: [], summaryForNext: "", userEdited: false, locked: false };
  });
  const script = Script.parse({ schemaVersion: 1, lang: "en", outlineHash: "0".repeat(64), title, chapters, lint: [], generatedBy: "fixture", updatedAt: TEST_NOW });
  const plans: BeatPlan[] = [];
  const texts: BeatLang[] = [];
  let order = 0;
  for (const id of chs) {
    const wire = read(`beats.${id}.json`);
    const ch = chapters.find((c) => c.chapterId === id)!;
    for (const seg of ch.segments) {
      if (seg.type === "music_breath") {
        const prev = plans.filter((p) => p.chapterId === id).at(-1);
        const p: BeatPlan = {
          id: ids.breathBeat(seg.id), chapterId: id, segmentId: seg.id, order: order++, origin: "breath", purpose: "transition", energy: 4, estSeconds: 2,
          visualKind: prev?.visualKind ?? "stock_broll", visualQuery: prev?.visualQuery ?? ch.title.toLowerCase(), personIds: [], quoteId: null, youtubeQuoteToFind: "",
          motionTemplate: "none", camera: "ken_burns", transitionIn: "cut", sfx: [], musicCue: "none", musicMood: prev?.musicMood ?? "tense", factIds: [],
          cueTags: [{ type: "MONTAGE", value: "" }], planKey: "",
        };
        p.planKey = planKeyOf(p);
        plans.push(p);
        texts.push({ beatId: p.id, lang: "en", text: "", onScreenText: "", cueAnchorIdx: [-1], emphasisIdx: [], motionData: {} });
        continue;
      }
      for (const b of arr(wire.beats).filter((x) => x.segment_id === seg.id)) {
        const words = tokenizeDisplay(String(b.text));
        const find = (w: string) => words.findIndex((x) => x.norm === normWord(w));
        const cues = arr(b.cue_tags).map((c) => ({ type: c.type, value: String(c.value ?? "") }) as CueTag);
        const p: BeatPlan = {
          id: String(b.id), chapterId: id, segmentId: seg.id, order: order++, origin: "llm", purpose: b.purpose as BeatPlan["purpose"], energy: Number(b.energy),
          estSeconds: Number(b.est_seconds), visualKind: b.visual_kind as BeatPlan["visualKind"], visualQuery: String(b.visual_query), personIds: (b.person_ids as string[]) ?? [],
          quoteId: b.quote_id ? String(b.quote_id) : null, youtubeQuoteToFind: String(b.youtube_quote_to_find ?? ""), motionTemplate: b.motion_template as BeatPlan["motionTemplate"],
          camera: b.camera as BeatPlan["camera"], transitionIn: b.transition_in as BeatPlan["transitionIn"], sfx: (b.sfx as BeatPlan["sfx"]) ?? [],
          musicCue: b.music_cue as BeatPlan["musicCue"], musicMood: b.music_mood as BeatPlan["musicMood"], factIds: (b.fact_ids as string[]) ?? [], cueTags: cues, planKey: "",
        };
        p.planKey = planKeyOf(p);
        plans.push(p);
        texts.push({
          beatId: p.id, lang: "en", text: String(b.text), onScreenText: String(b.on_screen_text ?? ""),
          cueAnchorIdx: arr(b.cue_tags).map((c) => (c.word ? find(String(c.word)) : -1)),
          emphasisIdx: ((b.emphasis_words as string[]) ?? []).map(find).filter((k) => k >= 0).slice(0, 3),
          motionData: b.motion_data_json ? (JSON.parse(String(b.motion_data_json)) as Record<string, unknown>) : {},
        });
      }
    }
  }
  const plansDoc = BeatPlansDoc.parse({
    schemaVersion: 1, primaryLang: "en", chapters: chs.map((c) => ({ chapterId: c, skeletonHash: "0".repeat(64), textHash: "0".repeat(64), method: "fixture" })),
    plans, primary: texts, generatedBy: "fixture", updatedAt: TEST_NOW,
  });
  const slices = BeatSlicesDoc.parse({
    schemaVersion: 1, lang: "en", plansHash: docHash(plansDoc), scriptHash: docHash(script), texts, chapters: chs.map((c) => ({ chapterId: c, method: "planned" })),
    validation: [], updatedAt: TEST_NOW,
  });
  return { script, plans: plansDoc, slices, facts: facts(), outline: outline() };
}

export function tulipInputs(): Built {
  const d = tulipDocs();
  const frozen = makeFrozen({ images: 16, videos: 3 });
  const built = buildInputs({
    script: d.script, plans: d.plans, slices: d.slices, take: makeTake(d.script), frozen, outline: d.outline, facts: d.facts,
    over: {
      sfx: SfxCategory.options.flatMap((category) => [0, 1, 2].map((variant) => makeSfxEntry({ category, variant }))),
      music: [makeMusicTrack({ bpm: 70, seconds: 150, mood: "ominous" }), makeMusicTrack({ bpm: 95, seconds: 150, mood: "tense" })],
    },
  });
  built.input.picks = makePicks(d.plans, frozen);
  (built.input as typeof built.input & { outline?: unknown }).outline = d.outline;
  void TEST_STYLE;
  return built;
}
