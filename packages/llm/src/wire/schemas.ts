// Wire schemas (snake_case) sent to Claude structured outputs (output_config.format). Ported from
// $SP/script-pipeline/schemas.ts. Structured-output limits: every field required, unions only as enums, no
// min/max/maxItems server-side, no recursion. Ranges and ids are checked by the mappers (wire/map.ts).
import { z } from "zod";
import {
  BeatPurpose, CameraIntent, ClaimStatus, CueType, Device, FactCheckSurface, FactCheckVerdict, MotionTemplate, MusicCue,
  MusicMood, QuoteMedium, Reliability, RiskFlag, SegmentType, Sensitivity, SfxIntent, SourceType, TopicType,
  TransitionIntent, VisualKind,
} from "@docmaker/core";

/** Source/quote languages (wider than the project languages). */
export const WireLang = z.enum(["fr", "en", "es", "de", "it", "pt", "nl"]);

// ---------------------------------------------------------------- 1b fact sheet
export const SourceWire = z.object({
  id: z.string().describe("S1, S2... (ONLY ids from <source_list>)"),
  url: z.string(),
  title: z.string(),
  publisher: z.string(),
  published_at: z.string().describe("ISO date or '' if unknown"),
  source_type: SourceType,
  reliability: Reliability,
  language: WireLang,
});
export const PersonWire = z.object({
  id: z.string().describe("P1..."),
  name: z.string(),
  role_in_story: z.string(),
  public_figure: z.boolean(),
  is_minor_or_private_victim: z.boolean().describe("true => never name/show without explicit editorial approval"),
  image_queries: z.array(z.string()),
});
export const TimelineEventWire = z.object({
  id: z.string().describe("E1..."),
  date: z.string().describe("YYYY, YYYY-MM or YYYY-MM-DD"),
  title: z.string(),
  what_happened: z.string(),
  person_ids: z.array(z.string()),
  status: ClaimStatus,
  source_ids: z.array(z.string()),
  drama_value: z.number().describe("0-10, how strong as a story beat"),
});
export const QuoteWire = z.object({
  id: z.string().describe("Q1..."),
  speaker_id: z.string(),
  verbatim: z.string().describe("exact words in original language, never paraphrased"),
  language: WireLang,
  date: z.string(),
  context: z.string(),
  medium: QuoteMedium,
  source_id: z.string(),
  youtube_search_query: z.string().describe("query likely to find the video containing this quote, '' if not video"),
});
export const FigureWire = z.object({
  id: z.string().describe("N1..."),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  as_of: z.string(),
  source_ids: z.array(z.string()),
  chartable: z.boolean(),
});
export const ClaimWire = z.object({
  id: z.string().describe("C1... (controversies, accusations, legal matters)"),
  summary: z.string(),
  made_by: z.string(),
  against: z.string(),
  status: ClaimStatus,
  jurisdiction: z.string().describe("e.g. 'UK High Court', 'Fairfax County VA jury', '' if none"),
  decision_date: z.string(),
  subject_response: z.string().describe("denial / statement by the accused, '' if none found"),
  sensitivity: Sensitivity.describe("high = crime, sexual misconduct, abuse, health, minors, fraud"),
  source_ids: z.array(z.string()),
});
export const FactSheetWire = z.object({
  topic: z.string(),
  as_of: z.string().describe("ISO date research was done; statuses may change"),
  one_line_premise: z.string(),
  central_question: z.string().describe("the main open loop the video answers"),
  sources: z.array(SourceWire),
  people: z.array(PersonWire),
  timeline: z.array(TimelineEventWire),
  quotes: z.array(QuoteWire),
  figures: z.array(FigureWire),
  claims: z.array(ClaimWire),
  angles: z.array(z.string()).describe("possible theses / takes"),
  gaps: z.array(z.string()).describe("things not verified; do not assert in script"),
});
export type FactSheetWire = z.infer<typeof FactSheetWire>;

// ---------------------------------------------------------------- 2 style suggestion
export const StyleSuggestionWire = z.object({
  topic_type: TopicType,
  ranked: z.array(z.object({ style_id: z.string(), score: z.number().describe("0-1"), why: z.string() })),
  recommended_style_id: z.string(),
  recommended_minutes: z.number(),
  title_options: z.array(z.string()),
  thumbnail_text_options: z.array(z.string()),
  risk_flags: z.array(RiskFlag),
  theme_override: z.object({
    accent: z.string().describe("#RRGGBB accent colour themed to the topic, '' to keep the style's"),
    backdrop_recipe: z.enum(["gradientGrid", "paper", "darkNoise", "blurSelf", ""]),
    texture: z.enum(["none", "paper", "film", "scanlines", "halftone", ""]),
  }),
});
export type StyleSuggestionWire = z.infer<typeof StyleSuggestionWire>;

// ---------------------------------------------------------------- 3 outline
const OutlineChapterFields = {
  id: z.string().describe("CH1..."),
  title: z.string(),
  target_words: z.number(),
  purpose: z.string(),
  event_ids: z.array(z.string()),
  claim_ids: z.array(z.string()),
  quote_ids: z.array(z.string()).describe("clips to play in this chapter"),
  opens_loops: z.array(z.string()).describe("loop ids L1.. opened here"),
  closes_loops: z.array(z.string()),
  exit_hook: z.string().describe("the cliffhanger/teaser sentence idea that ends the chapter"),
  ad_break_after: z.boolean(),
};
/** OutlineWire for one story shape: `act` is an enum of the shape's act ids. */
export function buildOutlineWire(acts: readonly string[]) {
  if (acts.length === 0) throw new Error("buildOutlineWire: no acts");
  const act = z.enum(acts as [string, ...string[]]);
  return z.object({
    language: WireLang,
    story_shape: z.string(),
    title: z.string(),
    thesis: z.string(),
    hook_teasers: z.array(z.object({ id: z.string(), teaser: z.string(), paid_off_in: z.string() })),
    loops: z.array(z.object({ id: z.string(), question: z.string(), opened_in: z.string(), closed_in: z.string() })),
    chapters: z.array(z.object({ ...OutlineChapterFields, act })),
    callback_plan: z.array(z.string()).describe("hook element -> where it is called back"),
    next_video_bridge: z.string(),
  });
}
export type OutlineWire = z.infer<ReturnType<typeof buildOutlineWire>>;

// ---------------------------------------------------------------- 4 chapter script
export const ScriptSegmentWire = z.object({
  id: z.string().describe("CH3-S07"),
  type: SegmentType,
  text: z.string().describe("narration text OR, for clip, the exact verbatim quote expected in the clip"),
  quote_id: z.string().describe("for clip: Q id; else ''"),
  fact_ids: z.array(z.string()).describe("S/E/N/C/Q ids backing every factual assertion in this segment"),
  device: Device,
  subtitle_translation: z.string().describe("clip whose quote language differs from the script language: natural subtitle; else ''"),
});
export const ChapterScriptWire = z.object({
  chapter_id: z.string(),
  title: z.string().describe("chapter card title in the script language"),
  video_title: z.string().describe("first chapter only: the video title in the script language; '' otherwise"),
  segments: z.array(ScriptSegmentWire),
  loops_opened: z.array(z.string()),
  loops_closed: z.array(z.string()),
  summary_for_next: z.string().describe("<=80 words, used as continuity context for the next chapter"),
});
export type ChapterScriptWire = z.infer<typeof ChapterScriptWire>;

// ---------------------------------------------------------------- 5 beats
export const CueTagWire = z.object({
  type: CueType,
  word: z.string().describe("exact word of the beat text the cue lands on; '' = beat start"),
  value: z.string().describe("number for NUMBER, name for PERSON_INTRO/PLACE, date for TIME_JUMP, 'bleep' for SENSITIVE, else ''"),
});
export const BeatWire = z.object({
  id: z.string().describe("CH3-B014 (ignored: ids are assigned in code)"),
  segment_id: z.string(),
  text: z.string().describe("EXACT contiguous substring of the segment narration; concatenation of beats == segment"),
  est_seconds: z.number(),
  purpose: BeatPurpose,
  energy: z.number().describe("1 calm .. 5 peak"),
  visual_kind: VisualKind,
  visual_query: z.string().describe("search query in English (stock/image APIs) - literal, concrete nouns"),
  person_ids: z.array(z.string()),
  youtube_quote_to_find: z.string().describe("verbatim words to locate in transcript, '' if n/a"),
  motion_template: MotionTemplate,
  motion_data_json: z.string().describe("JSON string with template props, '' if none (kept as string to avoid schema bloat)"),
  on_screen_text: z.string(),
  emphasis_words: z.array(z.string()).describe("words for caption highlight / punch-in"),
  camera: CameraIntent,
  transition_in: TransitionIntent,
  sfx: z.array(SfxIntent),
  music_cue: MusicCue,
  music_mood: MusicMood,
  fact_ids: z.array(z.string()),
  cue_tags: z.array(CueTagWire),
});
export type BeatWire = z.infer<typeof BeatWire>;
export const ChapterBeatsWire = z.object({ chapter_id: z.string(), beats: z.array(BeatWire) });
export type ChapterBeatsWire = z.infer<typeof ChapterBeatsWire>;

export const BeatSliceWire = z.object({
  chapter_id: z.string(),
  beats: z.array(z.object({
    id: z.string(),
    text: z.string(),
    on_screen_text: z.string(),
    emphasis_words: z.array(z.string()),
    cue_anchor_words: z.array(z.string()),
    motion_data_json: z.string(),
  })),
});
export type BeatSliceWire = z.infer<typeof BeatSliceWire>;

// ---------------------------------------------------------------- 6 fact-check
export const FactCheckWire = z.object({
  items: z.array(z.object({
    segment_id: z.string(),
    where: z.string().describe("segment id, beat id (on-screen text), 'title', 'thumbnail' or 'description'"),
    surface: FactCheckSurface,
    sentence: z.string(),
    claim_kind: z.enum(["fact", "allegation", "judicial_finding", "opinion", "quote", "number", "speculation"]),
    verdict: FactCheckVerdict,
    risk: z.enum(["none", "low", "medium", "high"]),
    fact_ids: z.array(z.string()),
    problem: z.string(),
    suggested_rewrite: z.string(),
  })),
  needs_more_research: z.array(z.string()).describe("search queries to resolve unsupported items"),
  title_thumbnail_issues: z.array(z.string()),
});
export type FactCheckWire = z.infer<typeof FactCheckWire>;

/** 6b recheck: status delta of the rechecked claims (sources = URLs returned by the recheck searches). */
export const RecheckWire = z.object({
  claims: z.array(z.object({
    id: z.string(),
    status: ClaimStatus,
    jurisdiction: z.string(),
    decision_date: z.string(),
    subject_response: z.string(),
    changed: z.boolean(),
    note: z.string().describe("what changed since the previous status, '' if nothing"),
    source_urls: z.array(z.string()).describe("URLs from the search results that support the current status"),
  })),
});
export type RecheckWire = z.infer<typeof RecheckWire>;

export const TranscreateWire = z.object({ display_text: z.string(), subtitle_translation: z.string() });
export type TranscreateWire = z.infer<typeof TranscreateWire>;

// ---------------------------------------------------------------- 7/8 assets helpers
export const RerankWire = z.object({
  images: z.array(z.object({
    index: z.number(),
    relevance: z.number(),
    technical_quality: z.number(),
    has_watermark_or_burned_text: z.boolean(),
    nsfw: z.boolean(),
    focal_x: z.number(),
    focal_y: z.number(),
    crop_x: z.number(),
    crop_y: z.number(),
    crop_w: z.number(),
    crop_h: z.number(),
    notes: z.string(),
  })),
});
export type RerankWire = z.infer<typeof RerankWire>;
export const PassageWire = z.object({ best_index: z.number(), confidence: z.number(), reason: z.string() });
export type PassageWire = z.infer<typeof PassageWire>;
