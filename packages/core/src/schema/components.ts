import { z } from "zod";
import { AssetId, Color, NormRect, Unit } from "./common";
import { SfxCategory } from "./media";
import type { CueType, MotionTemplate } from "./beats";

export const OverlayComponentId = z.enum([
  "LowerThird", "ChapterCard", "TitleSting", "QuoteCard", "SocialPost", "ArticleHighlight", "DocumentCard",
  "HeadlineStack", "Stamp", "KeywordSlam", "NumberCounter", "DateStamp", "MapPin", "TimelineGraphic",
  "BarChart", "SplitScreen", "CensorBar", "Spotlight", "KineticText", "SourceLabel", "Letterbox",
  "FreezeLabel", "PhotoBurst", "EvidenceBoard", "CommentPile",
]);
export type OverlayComponentId = z.infer<typeof OverlayComponentId>;
export const OverlayBand = z.enum(["picture", "graphics", "hud"]); // picture = inside camera rig & grade
export type OverlayBand = z.infer<typeof OverlayBand>;
export const ZoneName = z.enum(["center", "lowerThird", "topLeft", "topRight", "full", "captionBand"]);
export type ZoneName = z.infer<typeof ZoneName>;
/** card = contain-fit framed photo (border, tilt, shadow) over a drifting style backdrop (Moon/SunnyV2 look). */
export const ClipLayout = z.enum(["cover", "contain-blur", "card", "pip", "split-left", "split-right"]);
export type ClipLayout = z.infer<typeof ClipLayout>;

const int = z.number().int();
const at = int.nonnegative(); // frame offset RELATIVE TO THE ITEM'S `from` (VO-synced sub-beats; derived, §4.13)

export const LowerThirdProps = z.object({ name: z.string().min(1).max(48), role: z.string().max(72), align: z.enum(["left", "right"]) });
export const ChapterCardProps = z.object({
  index: int.positive(), total: int.positive(), title: z.string().min(1).max(60),
  kicker: z.string().max(40), // "CHAPTER 3" | "CHAPITRE 3"
  letterbox: z.boolean(),
  backdrop: z.enum(["gradientGrid", "paper", "darkNoise"]), // never flat ink (QA blackdetect)
});
export const TitleStingProps = z.object({
  title: z.string().min(1).max(80), // the video title (Script.title)
  kicker: z.string().max(60), // "CHAPTER 1 · <chapter title>" | ""
  mode: z.enum(["slam", "type"]),
  backdrop: z.enum(["gradientGrid", "paper", "darkNoise"]),
});
export const QuoteCardProps = z.object({
  text: z.string().min(1).max(400), speaker: z.string().max(60), sourceLabel: z.string().max(80),
  portraitAssetId: AssetId.nullable(), translated: z.boolean(),
  words: z.array(z.object({ text: z.string(), at, emphasis: z.boolean() })), // [] → static text
});
export const SocialPostProps = z.object({
  variant: z.enum(["post", "comment", "forum"]), displayName: z.string().max(50), handle: z.string().max(40),
  body: z.string().max(400), timestampLabel: z.string().max(40),
  likes: z.number().nullable(), reposts: z.number().nullable(), replies: z.number().nullable(),
  avatarAssetId: AssetId.nullable(), imageAssetId: AssetId.nullable(), verified: z.boolean(), // generic card, NO platform logos
  theme: z.enum(["light", "dark"]),
  revealAt: at, // counters start running / body highlight when the VO reaches the quoted body
});
export const ArticleHighlightProps = z.object({
  outlet: z.string().max(60), headline: z.string().max(160), dateLabel: z.string().max(40),
  paragraphs: z.array(z.string().max(600)).min(1).max(6),
  highlight: z.object({ paragraph: int.nonnegative(), start: int.nonnegative(), end: int.positive() }).nullable(),
  highlightAt: at, // highlighter sweep starts when the VO reaches the highlighted passage
  screenshotAssetId: AssetId.nullable(),
});
export const DocumentCardProps = z.object({
  docType: z.enum(["court", "letter", "report", "contract", "pamphlet"]), title: z.string().max(120),
  lines: z.array(z.string().max(120)).min(1).max(14),
  redactions: z.array(z.object({ line: int.nonnegative(), start: int.nonnegative(), end: int.positive() })),
  stamp: z.string().max(24).nullable(), sourceLabel: z.string().max(80),
  stampAt: at, redactAt: at,
});
export const HeadlineStackProps = z.object({
  items: z.array(z.object({
    outlet: z.string().max(40), headline: z.string().max(140), dateLabel: z.string().max(30),
    at, tiltDeg: z.number().min(-4).max(4),
  })).min(1).max(5),
});
export const StampProps = z.object({ text: z.string().min(1).max(24), color: Color, rotationDeg: z.number().min(-15).max(15), x: Unit, y: Unit, scale: z.number().min(0.5).max(2) });
export const KeywordSlamProps = z.object({ text: z.string().min(1).max(28), color: Color, background: z.enum(["black", "transparent", "blur"]) });
export const NumberCounterProps = z.object({
  value: z.number(), from: z.number(), format: z.enum(["number", "currency", "percent", "compact"]),
  currency: z.enum(["USD", "EUR", "GBP", "NLG"]).nullable(), decimals: int.min(0).max(3), label: z.string().max(60),
  locale: z.enum(["en-US", "fr-FR"]), color: Color,
});
export const DateStampProps = z.object({ text: z.string().min(1).max(48), zone: z.enum(["topLeft", "topRight"]) });
export const MapPinProps = z.object({
  places: z.array(z.object({ label: z.string().max(40), lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), at })).min(1).max(6),
  route: z.boolean(), region: z.enum(["world", "europe", "north-america", "auto"]), look: z.enum(["paper", "dark"]),
});
export const TimelineGraphicProps = z.object({
  events: z.array(z.object({ dateLabel: z.string().max(24), label: z.string().max(60), at })).min(2).max(8),
  activeIndex: int.min(-1),
});
export const BarChartProps = z.object({
  title: z.string().max(80), unit: z.string().max(16), sourceLabel: z.string().max(80),
  bars: z.array(z.object({ label: z.string().max(30), value: z.number(), highlight: z.boolean() })).min(2).max(8),
});
export const SplitScreenProps = z.object({
  left: z.object({ assetId: AssetId.nullable(), label: z.string().max(40) }),
  right: z.object({ assetId: AssetId.nullable(), label: z.string().max(40) }),
  dividerColor: Color,
});
export const CensorBarProps = z.object({ rect: NormRect, mode: z.enum(["bar", "pixelate", "blur"]), label: z.string().max(24).nullable() });
export const SpotlightProps = z.object({ cx: Unit, cy: Unit, rx: Unit, ry: Unit, dim: Unit, drawCircle: z.boolean(), color: Color });
export const KineticTextProps = z.object({ lines: z.array(z.string().max(48)).min(1).max(4), emphasis: z.array(z.string()), align: z.enum(["left", "center"]) });
export const SourceLabelProps = z.object({
  text: z.string().min(1).max(80),
  kind: z.enum(["source", "illustration", "reconstruction", "translated", "synthetic-voice", "archive", "scratch-voice", "pickup-tts"]),
  zone: z.enum(["topLeft", "topRight"]),
});
export const LetterboxProps = z.object({ ratio: z.number().min(1.85).max(2.76) });
/** Freeze-frame + name slam on a VIDEO shot: the item renders the frozen source frame itself (self-contained). */
export const FreezeLabelProps = z.object({
  assetId: AssetId, sourceFrame: int.nonnegative(), // media frame to freeze (the underlying shot's source frame at item.from)
  name: z.string().min(1).max(48), role: z.string().max(72),
  desaturate: Unit, darken: Unit, // over 3 f: desaturate .8, darken .25
});
export const PhotoBurstProps = z.object({
  items: z.array(z.object({ assetId: AssetId, at, tiltDeg: z.number().min(-6).max(6), x: Unit, y: Unit })).min(3).max(8),
  scaleFrom: z.number().min(0.9).max(1.2), scaleTo: z.number().min(0.9).max(1.3),
  caption: z.string().max(60),
});
export const EvidenceBoardProps = z.object({
  items: z.array(z.object({
    assetId: AssetId.nullable(), label: z.string().max(40),
    x: z.number().min(0).max(3840), y: z.number().min(0).max(2160), w: z.number().min(200).max(1600), rotDeg: z.number().min(-6).max(6),
    at,
  })).min(2).max(6),
  moves: z.array(z.object({ at, focus: int.min(-1), frames: int.min(12).max(40) })), // focus -1 = overview
  links: z.array(z.tuple([int.nonnegative(), int.nonnegative()])),
  backdrop: z.enum(["cork", "paper", "dark"]),
});
export const CommentPileProps = z.object({
  items: z.array(z.object({
    displayName: z.string().max(40), handle: z.string().max(40), body: z.string().max(160),
    at, x: Unit, y: Unit, rotDeg: z.number().min(-5).max(5),
  })).min(3).max(10),
  dim: Unit, theme: z.enum(["light", "dark"]),
});

export const OVERLAY_PROPS = {
  LowerThird: LowerThirdProps, ChapterCard: ChapterCardProps, TitleSting: TitleStingProps, QuoteCard: QuoteCardProps,
  SocialPost: SocialPostProps, ArticleHighlight: ArticleHighlightProps, DocumentCard: DocumentCardProps,
  HeadlineStack: HeadlineStackProps, Stamp: StampProps, KeywordSlam: KeywordSlamProps, NumberCounter: NumberCounterProps,
  DateStamp: DateStampProps, MapPin: MapPinProps, TimelineGraphic: TimelineGraphicProps, BarChart: BarChartProps,
  SplitScreen: SplitScreenProps, CensorBar: CensorBarProps, Spotlight: SpotlightProps, KineticText: KineticTextProps,
  SourceLabel: SourceLabelProps, Letterbox: LetterboxProps, FreezeLabel: FreezeLabelProps, PhotoBurst: PhotoBurstProps,
  EvidenceBoard: EvidenceBoardProps, CommentPile: CommentPileProps,
} as const satisfies Record<OverlayComponentId, z.ZodType>;

/**
 * How long a component must stay readable (§9.5):
 *  formula  — readHold = enter + S(max(1.5, chars/15 + 1.5))          (chars over textFields; CJK chars/4.5)
 *  glance   — readHold = enter + S(0.4)   (DateStamp: enter + typeFrames + F30(30))
 *  title    — readHold = enter + S(max(1.2, chars/20 + 0.8))          (big single-line titles)
 *  narrated — readHold = (last narrated word end − item.from) + S(0.6) when VO-synced, else formula
 *  none     — no text to read
 * dur = clamp(readHold, minHold, maxHold); readHold > maxHold → text truncated (formula) or a READABILITY warning — never an error.
 */
export interface ReadPolicy { mode: "formula" | "glance" | "title" | "narrated" | "none"; textFields: readonly string[] }
export interface ComponentMeta {
  band: OverlayBand;
  defaultZone: ZoneName;
  nle: "overlay" | "marker"; // overlay = ProRes 4444 item render when --overlays (M3), else marker
  overshootAllowed: boolean; // whitelisted impact components only
  minHold30: number; // frames @30fps (scale with framesAt())
  maxHold30: number;
  enter30: number;
  exit30: number;
  fullFrame: boolean; // occludes picture/captions
  defaultSfx: SfxCategory[];
  priority: number; // conflict resolution (higher wins)
  read: ReadPolicy;
  followsCamera: boolean; // punch/zoom fx (not shake) also apply to this graphics item ("zoom on the tweet")
  continuousMotion: boolean; // the component itself keeps moving over its hold (push 1.0→1.05 + backdrop drift)
  milestone: "M1" | "M2"; // implementation priority; unimplemented components render FallbackCard (KineticText look)
}
const M = (m: ComponentMeta) => m;
export const COMPONENT_META: Record<OverlayComponentId, ComponentMeta> = {
  LowerThird:       M({ band: "graphics", defaultZone: "lowerThird", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 150, enter30: 10, exit30: 8, fullFrame: false, defaultSfx: ["pop"], priority: 5, read: { mode: "formula", textFields: ["name", "role"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  ChapterCard:      M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 72, maxHold30: 150, enter30: 12, exit30: 10, fullFrame: true, defaultSfx: ["impact"], priority: 10, read: { mode: "title", textFields: ["title"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  TitleSting:       M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 120, enter30: 8, exit30: 10, fullFrame: true, defaultSfx: ["impact"], priority: 10, read: { mode: "title", textFields: ["title"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  QuoteCard:        M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 600, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["paper"], priority: 9, read: { mode: "narrated", textFields: ["text"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  SocialPost:       M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 300, enter30: 12, exit30: 8, fullFrame: false, defaultSfx: ["notification"], priority: 7, read: { mode: "narrated", textFields: ["displayName", "body"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  ArticleHighlight: M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 300, enter30: 12, exit30: 8, fullFrame: true, defaultSfx: ["paper", "marker"], priority: 7, read: { mode: "narrated", textFields: ["headline"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  DocumentCard:     M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 300, enter30: 12, exit30: 8, fullFrame: true, defaultSfx: ["paper", "thud"], priority: 7, read: { mode: "narrated", textFields: ["title"] }, followsCamera: true, continuousMotion: true, milestone: "M1" }),
  HeadlineStack:    M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 15, exit30: 8, fullFrame: true, defaultSfx: ["paper"], priority: 7, read: { mode: "narrated", textFields: ["items.headline"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  Stamp:            M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: true, minHold30: 45, maxHold30: 120, enter30: 3, exit30: 6, fullFrame: false, defaultSfx: ["thud", "click"], priority: 6, read: { mode: "glance", textFields: ["text"] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  KeywordSlam:      M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 12, maxHold30: 20, enter30: 6, exit30: 0, fullFrame: true, defaultSfx: ["boom.sub"], priority: 8, read: { mode: "glance", textFields: ["text"] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  NumberCounter:    M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 150, enter30: 8, exit30: 8, fullFrame: false, defaultSfx: ["tick", "ding"], priority: 8, read: { mode: "formula", textFields: ["label"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  DateStamp:        M({ band: "graphics", defaultZone: "topLeft", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 120, enter30: 0, exit30: 6, fullFrame: false, defaultSfx: ["keys"], priority: 4, read: { mode: "glance", textFields: ["text"] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  MapPin:           M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["whoosh.light", "pop"], priority: 7, read: { mode: "glance", textFields: ["places.label"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  TimelineGraphic:  M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["tick"], priority: 7, read: { mode: "glance", textFields: ["events.label"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  BarChart:         M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["tick"], priority: 7, read: { mode: "formula", textFields: ["title"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  SplitScreen:      M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 60, maxHold30: 240, enter30: 10, exit30: 0, fullFrame: true, defaultSfx: ["whoosh.light"], priority: 6, read: { mode: "glance", textFields: ["left.label", "right.label"] }, followsCamera: false, continuousMotion: true, milestone: "M2" }),
  CensorBar:        M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 6, maxHold30: 9000, enter30: 0, exit30: 0, fullFrame: false, defaultSfx: [], priority: 10, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M2" }),
  Spotlight:        M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 30, maxHold30: 180, enter30: 9, exit30: 6, fullFrame: false, defaultSfx: ["marker"], priority: 5, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M2" }),
  KineticText:      M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 180, enter30: 8, exit30: 6, fullFrame: false, defaultSfx: ["pop"], priority: 6, read: { mode: "formula", textFields: ["lines"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  SourceLabel:      M({ band: "hud", defaultZone: "topLeft", nle: "marker", overshootAllowed: false, minHold30: 45, maxHold30: 9000, enter30: 6, exit30: 6, fullFrame: false, defaultSfx: [], priority: 3, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  Letterbox:        M({ band: "hud", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 20, maxHold30: 9000, enter30: 20, exit30: 20, fullFrame: false, defaultSfx: [], priority: 2, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M2" }),
  FreezeLabel:      M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 120, enter30: 3, exit30: 8, fullFrame: true, defaultSfx: ["shutter", "impact"], priority: 8, read: { mode: "formula", textFields: ["name"] }, followsCamera: false, continuousMotion: true, milestone: "M2" }),
  PhotoBurst:       M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 60, maxHold30: 240, enter30: 0, exit30: 8, fullFrame: true, defaultSfx: ["shutter", "riser", "impact"], priority: 8, read: { mode: "none", textFields: [] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  EvidenceBoard:    M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 450, enter30: 12, exit30: 10, fullFrame: true, defaultSfx: ["whoosh.heavy", "click"], priority: 7, read: { mode: "glance", textFields: ["items.label"] }, followsCamera: false, continuousMotion: true, milestone: "M2" }),
  CommentPile:      M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 60, maxHold30: 240, enter30: 0, exit30: 8, fullFrame: true, defaultSfx: ["pop"], priority: 6, read: { mode: "narrated", textFields: ["items.body"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
};

/**
 * Lenient schemas for the LLM's motion_data_json (snake_case wire keys, kept as-is in BeatLang.motionData).
 * Fact refs are REQUIRED for every string that would put words in a real person's/outlet's mouth or show a number:
 * validateBeats (§6.3) checks them against the FactSheet; a failed check downgrades the beat to kinetic_text +
 * SourceLabel{reconstruction}. Numeric fields of secondary languages are copied from the primary language.
 */
const s = z.string();
export const MotionData = {
  kinetic_text: z.object({ lines: z.array(s).min(1).max(4), emphasis: z.array(s).default([]) }),
  counter: z.object({ figure_id: s, value: z.number(), from: z.number().default(0), label: s.default(""), unit: s.default(""), decimals: int.min(0).max(3).default(0), format: z.enum(["number", "percent", "compact"]).default("number") }),
  money_counter: z.object({ figure_id: s, value: z.number(), from: z.number().default(0), currency: z.enum(["USD", "EUR", "GBP", "NLG"]).default("USD"), label: s.default(""), compact: z.boolean().default(true) }),
  timeline: z.object({ events: z.array(z.object({ date: s, label: s, event_id: s.default("") })).min(2).max(8), active_index: int.default(-1) }),
  bar_chart: z.object({ title: s.default(""), unit: s.default(""), source_id: s.default(""), bars: z.array(z.object({ label: s, value: z.number(), figure_id: s, highlight: z.boolean().default(false) })).min(2).max(8) }),
  line_chart: z.object({ title: s.default(""), unit: s.default(""), source_id: s.default(""), bars: z.array(z.object({ label: s, value: z.number(), figure_id: s, highlight: z.boolean().default(false) })).min(2).max(8) }), // rendered as BarChart in v1
  map_route: z.object({ places: z.array(z.object({ label: s, lon: z.number(), lat: z.number() })).min(1).max(6), route: z.boolean().default(false), region: z.enum(["world", "europe", "north-america", "auto"]).default("auto") }),
  quote_card: z.object({ quote_id: s, text: s, speaker: s, source: s.default(""), date: s.default("") }),
  tweet_card: z.object({ quote_id: s, display_name: s, handle: s.default(""), body: s, date: s.default(""), likes: z.number().nullable().default(null), reposts: z.number().nullable().default(null), replies: z.number().nullable().default(null), variant: z.enum(["post", "comment", "forum"]).default("post") }),
  headline_stack: z.object({ items: z.array(z.object({ source_id: s, outlet: s, headline: s, date: s.default("") })).min(1).max(5) }),
  document_highlight: z.object({ source_id: s, quote_id: s.default(""), kind: z.enum(["article", "court", "letter", "report", "pamphlet"]).default("article"), outlet: s.default(""), title: s, date: s.default(""), paragraphs: z.array(s).min(1).max(6), highlight: s.default(""), redact: z.array(s).default([]) }),
  split_compare: z.object({ left_label: s, right_label: s, left_query: s.default(""), right_query: s.default("") }),
  org_chart: z.object({ nodes: z.array(z.object({ label: s, role: s.default("") })).min(1).max(8) }), // rendered as KineticText in v1
  photo_burst: z.object({ count: int.min(3).max(8).default(5), caption: s.default("") }), // images = beat picks slots 0..count-1
  evidence_board: z.object({ items: z.array(z.object({ label: s, person_id: s.default(""), source_id: s.default("") })).min(2).max(6), links: z.array(z.tuple([int, int])).default([]) }),
  comment_pile: z.object({ items: z.array(z.object({ quote_id: s })).min(3).max(10) }), // bodies = Quote.verbatim; names from speakers
} as const;
export type MotionDataKey = keyof typeof MotionData;

/** Motion template → overlay component (§4.11 table). */
export const TEMPLATE_COMPONENT: Readonly<Record<Exclude<MotionTemplate, "none">, OverlayComponentId>> = {
  kinetic_text: "KineticText", counter: "NumberCounter", money_counter: "NumberCounter", timeline: "TimelineGraphic",
  bar_chart: "BarChart", line_chart: "BarChart", map_route: "MapPin", quote_card: "QuoteCard", tweet_card: "SocialPost",
  headline_stack: "HeadlineStack", document_highlight: "DocumentCard", // kind "article" → ArticleHighlight
  split_compare: "SplitScreen", org_chart: "KineticText", photo_burst: "PhotoBurst", evidence_board: "EvidenceBoard",
  comment_pile: "CommentPile",
};
/**
 * Cue types for which the director has a DERIVATION rule (§9.3 step 7g) per component. A style trigger outside this
 * table is a style lint error (validateStyleData). Structural components (ChapterCard, TitleSting) and template-only
 * components have [] here.
 */
export const DERIVABLE_TRIGGERS: Readonly<Record<OverlayComponentId, readonly CueType[]>> = {
  LowerThird: ["PERSON_INTRO"], ChapterCard: [], TitleSting: [], QuoteCard: ["QUOTE"], SocialPost: ["TWEET"],
  ArticleHighlight: [], DocumentCard: [], HeadlineStack: [], Stamp: ["REVEAL"], KeywordSlam: ["SHOCK"],
  NumberCounter: ["NUMBER"], DateStamp: ["TIME_JUMP"], MapPin: [], TimelineGraphic: [], BarChart: [],
  SplitScreen: ["COMPARISON"], CensorBar: ["SENSITIVE"], Spotlight: ["DOCUMENT", "EMPHASIS"], KineticText: ["LIST", "EMPHASIS"],
  SourceLabel: ["CLIP_REF"], Letterbox: [], FreezeLabel: ["PERSON_INTRO"], PhotoBurst: ["LIST", "MONTAGE"],
  EvidenceBoard: ["LIST"], CommentPile: [],
};
/** Words a Stamp may show (REVEAL). Status-gated words need a cited claim with that status on the beat. */
export const STAMP_LEXICON = {
  en: ["BANKRUPT", "CANCELLED", "FIRED", "DELISTED", "SOLD", "SETTLED", "DISMISSED", "ACQUITTED", "OVERTURNED", "CLOSED", "DEBUNKED", "CONFIRMED", "DENIED", "OVER", "COLLAPSED", "RECALLED"],
  fr: ["FAILLITE", "ANNULÉ", "LICENCIÉ", "RADIÉ", "VENDU", "RÉGLÉ", "REJETÉ", "ACQUITTÉ", "INFIRMÉ", "FERMÉ", "DÉMENTI", "CONFIRMÉ", "NIÉ", "TERMINÉ", "EFFONDRÉ", "RAPPELÉ"],
  statusGated: { CONVICTED: "criminal_conviction", GUILTY: "criminal_conviction", "CONDAMNÉ": "criminal_conviction", "COUPABLE": "criminal_conviction", LIABLE: "judicial_finding_civil", "RESPONSABLE": "judicial_finding_civil" },
} as const;

// ---- inferred types (one per schema constant)
export type LowerThirdProps = z.infer<typeof LowerThirdProps>;
export type ChapterCardProps = z.infer<typeof ChapterCardProps>;
export type TitleStingProps = z.infer<typeof TitleStingProps>;
export type QuoteCardProps = z.infer<typeof QuoteCardProps>;
export type SocialPostProps = z.infer<typeof SocialPostProps>;
export type ArticleHighlightProps = z.infer<typeof ArticleHighlightProps>;
export type DocumentCardProps = z.infer<typeof DocumentCardProps>;
export type HeadlineStackProps = z.infer<typeof HeadlineStackProps>;
export type StampProps = z.infer<typeof StampProps>;
export type KeywordSlamProps = z.infer<typeof KeywordSlamProps>;
export type NumberCounterProps = z.infer<typeof NumberCounterProps>;
export type DateStampProps = z.infer<typeof DateStampProps>;
export type MapPinProps = z.infer<typeof MapPinProps>;
export type TimelineGraphicProps = z.infer<typeof TimelineGraphicProps>;
export type BarChartProps = z.infer<typeof BarChartProps>;
export type SplitScreenProps = z.infer<typeof SplitScreenProps>;
export type CensorBarProps = z.infer<typeof CensorBarProps>;
export type SpotlightProps = z.infer<typeof SpotlightProps>;
export type KineticTextProps = z.infer<typeof KineticTextProps>;
export type SourceLabelProps = z.infer<typeof SourceLabelProps>;
export type LetterboxProps = z.infer<typeof LetterboxProps>;
export type FreezeLabelProps = z.infer<typeof FreezeLabelProps>;
export type PhotoBurstProps = z.infer<typeof PhotoBurstProps>;
export type EvidenceBoardProps = z.infer<typeof EvidenceBoardProps>;
export type CommentPileProps = z.infer<typeof CommentPileProps>;
