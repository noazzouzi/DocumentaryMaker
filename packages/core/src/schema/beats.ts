import { z } from "zod";
import {
  BeatId, ChapterId, FactRef, IsoDateTime, Lang, LintIssue, PersonId, QuoteId, SegmentId, Sha16, Sha256, docVersion,
} from "./common";

export const CueType = z.enum([
  "HOOK", "EMPHASIS", "REVEAL", "SHOCK", "TENSION_BUILD", "NUMBER", "PERSON_INTRO", "PLACE", "TIME_JUMP",
  "QUOTE", "DOCUMENT", "ARTICLE", "TWEET", "CLIP_REF", "LIST", "COMPARISON", "IRONY", "FLASHBACK",
  "CHAPTER", "SENSITIVE", "MONTAGE",
]);
export type CueType = z.infer<typeof CueType>;
export const BeatPurpose = z.enum([
  "hook", "context", "escalation", "reveal", "punchline", "transition", "cliffhanger", "payoff", "callback", "cta",
]);
export const VisualKind = z.enum([
  "stock_broll", "archival_photo", "news_footage", "youtube_clip", "motion_graphic",
  "document_screenshot", "social_post", "map", "text_card", "ai_illustration",
]);
export type VisualKind = z.infer<typeof VisualKind>;
export const MotionTemplate = z.enum([
  "none", "kinetic_text", "counter", "money_counter", "timeline", "bar_chart", "line_chart", "map_route",
  "quote_card", "tweet_card", "headline_stack", "document_highlight", "split_compare", "org_chart",
  "photo_burst", "evidence_board", "comment_pile",
]);
export type MotionTemplate = z.infer<typeof MotionTemplate>;
export const CameraIntent = z.enum(["static", "slow_push_in", "punch_in", "ken_burns", "whip_pan", "shake", "zoom_out_reveal"]);
export const TransitionIntent = z.enum(["cut", "whip", "flash", "glitch", "zoom_through", "crossfade", "dip_to_black"]);
export type TransitionIntent = z.infer<typeof TransitionIntent>;
export const SfxIntent = z.enum([
  "whoosh", "impact", "riser", "sub_boom", "record_scratch", "camera_shutter", "typing", "cash_register",
  "notification", "heartbeat", "glitch", "text_pop", "silence_drop",
]);
export const MusicCue = z.enum(["none", "start", "change_mood", "build", "drop_out", "hit", "duck"]);
export const MusicMood = z.enum(["none", "ominous", "tense", "sad", "uplifting", "comedic", "mysterious", "epic", "chill"]);
export type MusicMood = z.infer<typeof MusicMood>;

/** value: number for NUMBER, name for PERSON_INTRO, date for TIME_JUMP, "bleep" for a SENSITIVE word to bleep, … */
export const CueTag = z.object({ type: CueType, value: z.string() });
export type CueTag = z.infer<typeof CueTag>;

/** Language-neutral visual plan of one beat. Shared by all languages. Ids are assigned in code: `${chapterId}-B${seq3}`. */
export const BeatPlan = z.object({
  id: BeatId,
  chapterId: ChapterId,
  segmentId: SegmentId,
  order: z.number().int().nonnegative(), // global order
  origin: z.enum(["llm", "fallback", "clip", "breath", "user"]),
  purpose: BeatPurpose,
  energy: z.number().int().min(1).max(5),
  estSeconds: z.number().positive(),
  visualKind: VisualKind,
  visualQuery: z.string(), // ENGLISH, literal nouns
  personIds: z.array(PersonId),
  quoteId: QuoteId.nullable(),
  youtubeQuoteToFind: z.string(),
  motionTemplate: MotionTemplate,
  camera: CameraIntent,
  transitionIn: TransitionIntent,
  sfx: z.array(SfxIntent),
  musicCue: MusicCue,
  musicMood: MusicMood,
  factIds: z.array(FactRef),
  cueTags: z.array(CueTag),
  /** sha16(hashJson({visualKind, visualQuery, personIds, motionTemplate, quoteId})). Picks/overrides store it; mismatch → orphaned. */
  planKey: Sha16,
});
export type BeatPlan = z.infer<typeof BeatPlan>;

/**
 * Per-language text of a beat. text is an EXACT contiguous slice of the segment's displayText.
 * Clip beats (-CLIP) and breath beats (-BR) carry NO text: text "", cueAnchorIdx [-1…], emphasisIdx [].
 */
export const BeatLang = z.object({
  beatId: BeatId,
  lang: Lang,
  text: z.string(),
  onScreenText: z.string(),
  /** Parallel to BeatPlan.cueTags: display-word index WITHIN the beat text the cue lands on; -1 = beat start. */
  cueAnchorIdx: z.array(z.number().int().min(-1)),
  emphasisIdx: z.array(z.number().int().nonnegative()), // 0–3 display-word indexes within the beat text
  /** Parsed motion_data_json. Keys are WIRE keys (snake_case), validated by MotionData[template] (§4.11). */
  motionData: z.record(z.string(), z.unknown()),
});
export type BeatLang = z.infer<typeof BeatLang>;

/** beats/plans.json — written by stage `beats` (language-neutral). */
export const BeatPlansDoc = z
  .object({
    schemaVersion: docVersion("beatPlans"),
    primaryLang: Lang,
    chapters: z.array(
      z.object({
        chapterId: ChapterId,
        skeletonHash: Sha256, // hashJson([{id,type,quoteId}]) of the primary chapter when planned
        textHash: Sha256, // hashJson(segment displayTexts) of the primary chapter when planned
        method: z.enum(["llm", "fallback", "fixture", "user"]),
      }),
    ),
    plans: z.array(BeatPlan),
    primary: z.array(BeatLang), // the primary-language slices produced at planning time
    generatedBy: z.enum(["llm", "fixture", "fallback-splitter", "user"]),
    updatedAt: IsoDateTime,
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const p of d.plans) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate beat ${p.id}` });
      ids.add(p.id);
      if (!p.id.startsWith(p.chapterId + "-") || !p.segmentId.startsWith(p.chapterId + "-")) {
        ctx.addIssue({ code: "custom", message: `beat ${p.id} chapter/segment prefix mismatch` });
      }
    }
  });
export type BeatPlansDoc = z.infer<typeof BeatPlansDoc>;

/** beats/<lang>.json — written by stage `beatslice[lang]`. */
export const BeatSlicesDoc = z.object({
  schemaVersion: docVersion("beatSlices"),
  lang: Lang,
  plansHash: Sha256, // docHash(beats/plans.json)
  scriptHash: Sha256, // docHash(script/<lang>/script.json)
  texts: z.array(BeatLang),
  chapters: z.array(
    z.object({ chapterId: ChapterId, method: z.enum(["planned", "llm", "fallback"]) }),
  ),
  validation: z.array(LintIssue),
  updatedAt: IsoDateTime,
});
export type BeatSlicesDoc = z.infer<typeof BeatSlicesDoc>;

// ---- inferred types (one per schema constant)
export type BeatPurpose = z.infer<typeof BeatPurpose>;
export type CameraIntent = z.infer<typeof CameraIntent>;
export type SfxIntent = z.infer<typeof SfxIntent>;
export type MusicCue = z.infer<typeof MusicCue>;
