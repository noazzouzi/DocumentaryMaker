import { z } from "zod";
import {
  ActId, AnyWordId, AssetId, BeatId, ChapterId, Color, Fps, Frame, FrameDelta, IsoDateTime, Lang, NormPoint, NormRect,
  PosFrames, SegmentId, Sha16, Sha256, Slug, TakeId, Unit, WordId, docVersion,
} from "./common";
import { MusicMood } from "./beats";
import { SfxCategory } from "./media";
import { AssetKind } from "./assets";
import { CaptionsMode } from "./project";
import { Grade, StyleRenderTokens } from "./style";
import {
  ArticleHighlightProps, BarChartProps, CensorBarProps, ChapterCardProps, ClipLayout, CommentPileProps, DateStampProps,
  DocumentCardProps, EvidenceBoardProps, FreezeLabelProps, HeadlineStackProps, KeywordSlamProps, KineticTextProps,
  LetterboxProps, LowerThirdProps, MapPinProps, NumberCounterProps, OverlayBand, type OverlayComponentId,
  PhotoBurstProps, QuoteCardProps, SocialPostProps, SourceLabelProps, SplitScreenProps, SpotlightProps, StampProps,
  TimelineGraphicProps, TitleStingProps, ZoneName,
} from "./components";

// ---------------------------------------------------------------- anchors (audio is the clock)
export const Edge = z.enum(["start", "end"]);
export const Anchor = z.discriminatedUnion("ref", [
  // expectNorm: normWord of the anchored word when the anchor was made; overrides re-match by NW on mismatch, else reject
  z.object({ ref: z.literal("word"), wordId: WordId, edge: Edge, offset: FrameDelta, expectNorm: z.string().nullable() }),
  z.object({ ref: z.literal("segment"), segmentId: SegmentId, edge: Edge, offset: FrameDelta }),
  z.object({ ref: z.literal("beat"), beatId: BeatId, edge: Edge, offset: FrameDelta }),
  z.object({ ref: z.literal("chapter"), chapterId: ChapterId, edge: Edge, offset: FrameDelta }),
  z.object({ ref: z.literal("program"), edge: Edge, offset: FrameDelta }), // absolute: {program,start,offset:f}
]);
export type Anchor = z.infer<typeof Anchor>;

/**
 * Every timed item carries anchors + resolved integer frames. The director writes both. resolveTimeline() is valid
 * ONLY against the layout whose hash equals Timeline.layoutHash (it re-resolves override items and is checked for
 * idempotence by lint RESOLVE_MISMATCH). Any layout change → full re-direct. Derived fields: see §4.13 table.
 */
const timed = { start: Anchor, end: Anchor, from: Frame, dur: PosFrames };

// ---------------------------------------------------------------- picture track (V1, contiguous)
export const VisualSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), assetId: AssetId, crop: NormRect.nullable(), focal: NormPoint }),
  z.object({ kind: z.literal("video"), assetId: AssetId, sourceInFrames: Frame, crop: NormRect.nullable(), focal: NormPoint }), // muted; audio via audio.clip
  z.object({
    kind: z.literal("generated"),
    recipe: z.enum(["gradientGrid", "paper", "darkNoise", "keywordCard"]),
    text: z.string(),
    palette: z.array(Color).min(2).max(4),
    seed: z.number().int(),
  }),
  z.object({ kind: z.literal("solid"), color: Color }),
]);
export type VisualSource = z.infer<typeof VisualSource>;

export const CameraKey = z.object({
  f: Frame, // local frame, 0 = clip `from` (the cut frame, NOT including overlap handles)
  scale: z.number().positive(),
  x: z.number(), // px at 1920×1080, +x right
  y: z.number(), // px, +y down
  rot: z.number(), // deg, clockwise
});
export const CameraMove = z.object({
  kind: z.enum(["static", "kenBurns", "creep", "pullBack", "reframe", "handheld"]),
  keys: z.array(CameraKey).min(1),
  ease: z.enum(["linear", "kb", "expoOut", "inOutCubic", "monotone"]), // kb = MotionTokens.kbEase
  origin: z.object({ x: Unit, y: Unit }), // transform-origin (focal point)
  blurFromPx: z.number().min(0), // pullBack entry blur → 0 over the first keys segment; 0 = none
  handheld: z.object({ ampPx: z.number(), fps: z.number() }).nullable(),
  direction: z.enum(["in", "out", "left", "right", "up", "down", "none"]), // Ken Burns direction ledger (no repeats/reversals)
});
export type CameraMove = z.infer<typeof CameraMove>;

export const Direction = z.enum(["left", "right", "up", "down"]);
export const CutAccent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("pulse"), amt: z.number().min(0).max(0.1), frames: PosFrames }), // +5 % decaying .25 s
  z.object({ type: z.literal("flash"), peak: z.number().min(0).max(0.9), frames: z.number().int().min(1).max(6), color: Color }),
  z.object({
    type: z.literal("velocity"), // hard cut with exit anim on A + entry anim on B (no dual render)
    preset: z.enum(["zoomThrough", "zoomThroughInverse", "whip", "cutTheCurve", "pushCut"]),
    direction: Direction,
    exitFrames: z.number().int().min(0).max(20),
    entryFrames: z.number().int().min(0).max(30),
    flash: z.number().min(0).max(0.5),
  }),
]);
export type CutAccent = z.infer<typeof CutAccent>;
export const CoverPresentation = z.enum([
  "flash", "dipToBlack", "dipToWhite", "lightLeak", "filmBurn", "whipStreaks", "glitch", "paperRip", "dotWipe", "iris",
]);
export const OverlapPresentation = z.enum(["dissolve", "blurDissolve", "push", "wipe"]);
export const Transition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cut"), accent: CutAccent }),
  z.object({ // class 2: overlay covers the cut, centred on it; no timeline shortening, no dual render
    kind: z.literal("cover"), presentation: CoverPresentation, durationFrames: z.number().int().min(2).max(40),
    direction: Direction, color: Color, peak: z.number().min(0).max(1),
  }),
  z.object({ // class 3: TransitionSeries.Transition centred on the cut; clips extended by d/2 handles. d is EVEN.
    kind: z.literal("overlap"), presentation: OverlapPresentation, durationFrames: z.number().int().min(4).max(30).multipleOf(2),
    direction: Direction,
  }),
]);
export type Transition = z.infer<typeof Transition>;

export const LayoutParams = z.object({ // card / pip styling (null for cover/contain-blur/split)
  backdrop: z.enum(["gradientGrid", "paper", "blurSelf", "darkNoise"]),
  heightFrac: z.number().min(0.4).max(1), // card: image height / 1080; pip: frame width / 1920
  borderPx: z.number().min(0).max(24),
  tiltDeg: z.number().min(-4).max(4),
  shadow: z.boolean(),
  stroke: Color.nullable(), // pip stroke (accent or white)
  entry: z.enum(["none", "scale", "tvOn", "slide"]),
  backdropSeed: z.number().int(),
});
export type LayoutParams = z.infer<typeof LayoutParams>;

export const VisualClip = z.object({
  id: z.string(), // "v:<beatId>:<shotIndex>" (positional within the beat; overrides are fingerprinted)
  ...timed,
  chapterId: ChapterId,
  beatId: BeatId.nullable(),
  source: VisualSource,
  layout: ClipLayout,
  layoutParams: LayoutParams.nullable(),
  camera: CameraMove,
  treatment: z.enum(["none", "bw", "archival", "duotone"]),
  transitionIn: Transition, // transition at this clip's `from` (first clip of the program: cut/none)
  sourceLabel: z.string().nullable(), // e.g. "Source: <channel>, 2016" (pip/clip)
  name: z.string(), // NLE clip name
});
export type VisualClip = z.infer<typeof VisualClip>;

// ---------------------------------------------------------------- overlays (closed vocabulary)
const overlayBase = {
  id: z.string(), // "ov:<beatId|chapterId>:<component>:<n>"
  ...timed,
  beatId: BeatId.nullable(),
  band: OverlayBand,
  z: z.number().int(),
  zone: ZoneName,
  enterFrames: Frame,
  exitFrames: Frame,
  followsCamera: z.boolean(), // = COMPONENT_META.followsCamera (copied so remotion needs no lookup)
};
const ov = <C extends OverlayComponentId, P extends z.ZodType>(component: C, props: P) =>
  z.object({ ...overlayBase, component: z.literal(component), props });
export const OverlayItem = z.discriminatedUnion("component", [
  ov("LowerThird", LowerThirdProps), ov("ChapterCard", ChapterCardProps), ov("TitleSting", TitleStingProps),
  ov("QuoteCard", QuoteCardProps), ov("SocialPost", SocialPostProps), ov("ArticleHighlight", ArticleHighlightProps),
  ov("DocumentCard", DocumentCardProps), ov("HeadlineStack", HeadlineStackProps), ov("Stamp", StampProps),
  ov("KeywordSlam", KeywordSlamProps), ov("NumberCounter", NumberCounterProps), ov("DateStamp", DateStampProps),
  ov("MapPin", MapPinProps), ov("TimelineGraphic", TimelineGraphicProps), ov("BarChart", BarChartProps),
  ov("SplitScreen", SplitScreenProps), ov("CensorBar", CensorBarProps), ov("Spotlight", SpotlightProps),
  ov("KineticText", KineticTextProps), ov("SourceLabel", SourceLabelProps), ov("Letterbox", LetterboxProps),
  ov("FreezeLabel", FreezeLabelProps), ov("PhotoBurst", PhotoBurstProps), ov("EvidenceBoard", EvidenceBoardProps),
  ov("CommentPile", CommentPileProps),
]);
export type OverlayItem = z.infer<typeof OverlayItem>;

// ---------------------------------------------------------------- captions
export const CaptionTone = z.enum(["normal", "keyword", "money", "danger"]);
export const CaptionWord = z.object({
  wordId: AnyWordId, // WordId | clip:<segmentId>:<n> | tr:<segmentId>:<page>:<n>
  text: z.string(),
  from: Frame,
  dur: PosFrames,
  tone: CaptionTone,
  hero: z.boolean(), // scale captionDNA.heroScale + keyword colour; ≥ heroWordMinGapSec apart
});
export const CaptionGroup = z.object({
  id: z.string(), // "cap:<segmentId>:<n>" | "kw:<segmentId>:<n>" (keyword captions) | "capt:<segmentId>:<page>" (translation)
  ...timed,
  segmentId: SegmentId,
  variant: z.enum(["keywords", "pop", "karaoke", "rail", "clip", "translation", "srt"]), // srt = never burned (subtitle file only)
  burn: z.boolean(), // false → SRT only (variant srt, suppressed groups, captionsMode != "burn")
  words: z.array(CaptionWord).min(1),
});
export type CaptionGroup = z.infer<typeof CaptionGroup>;

// ---------------------------------------------------------------- fx cues (envelope model)
export const FxKind = z.enum(["punch", "zoom", "shake", "flash", "dark", "rgb", "glitch", "blur"]);
export type FxKind = z.infer<typeof FxKind>;
export const FxCue = z.object({
  id: z.string(), // "fx:<sourceId>:<kind>"
  ...timed, // from = hit frame f, dur = frames after f
  fx: FxKind,
  shape: z.enum(["hit", "span"]),
  pre: Frame, // ramp-in frames before f (q² curve)
  curve: z.number().positive(), // hit = (1 - t/dur)^curve
  fade: Frame, // span fade in/out frames
  amt: z.number(), // punch: +scale; shake: px; flash: 0..1; dark: 0..1; rgb: px; blur: px; zoom: +scale
  decay: z.number().nullable(), // plate punch exp decay (e.g. 9) — overrides `hit` curve when set
  hz: z.number().nullable(), // plate shake frequency (12) — sin/cos(1.31×) model when set, else seeded noise
  ampY: z.number().nullable(),
  rotDeg: z.number().nullable(), // impact shake rotation amplitude
  x: Unit.nullable(), // effect origin (punch/zoom: the focal point)
  y: Unit.nullable(),
  color: Color.nullable(),
  seed: z.number().int(),
  target: z.enum(["picture", "picture+followers", "all"]), // followers = graphics items with followsCamera (punch/zoom); all = whole frame (impact shake on slams)
});
export type FxCue = z.infer<typeof FxCue>;

// ---------------------------------------------------------------- audio (rendered offline; previewed with the same gain tables)
/** Per-segment VO clip for NLE export. gainDb is APPLIED to the (un-normalised) segment file = voProgram.bakedGainDb. */
export const VoClip = z.object({
  id: z.string(), // "vo:<segmentId>" | "vo:<segmentId>:b" (part after a REVEAL insertion)
  ...timed, segmentId: SegmentId, assetId: AssetId, sourceInFrames: Frame, gainDb: z.number(),
});
export const MusicSection = z.object({
  id: z.string(), // "mus:<chapterId>" | "mus:<chapterId>:r<n>" (restart after a reveal/drop)
  ...timed, assetId: AssetId, sourceInFrames: Frame, loop: z.boolean(), gainDb: z.number(),
  fadeInFrames: Frame, fadeOutFrames: Frame, endMode: z.enum(["fade", "hardStop", "crossfade"]),
  alignDownbeatAt: Frame.nullable(), // program frame where a track downbeat lands (sourceInFrames chosen for it)
  mood: MusicMood, energy: z.enum(["low", "mid", "high"]), bpm: z.number().nullable(),
});
export type MusicSection = z.infer<typeof MusicSection>;
export const SfxCue = z.object({
  id: z.string(), // "sfx:<sourceItemId>:<category>" (+ ":<n>" for repeated ticks/pops of one item)
  ...timed, // from = eventFrame - peakOffsetFrames (start of file); dur = played length (loop/clamp)
  sfxId: z.string(), // manifest entry id "procedural:impact/2"
  assetId: AssetId,
  category: SfxCategory,
  eventFrame: Frame,
  peakOffsetFrames: Frame,
  gainDb: z.number(),
  pan: z.number().min(-1).max(1),
  panSweep: z.enum(["LR", "RL"]).nullable(), // follow the whip direction (mixer mirrors channels for RL on an LR file)
  loop: z.boolean(), // drones/ambience/keys
  fadeInFrames: Frame,
  fadeOutFrames: Frame,
  priority: z.number().int().min(1).max(5),
  combo: z.enum(["reveal", "riser-impact", "click-whoosh"]).nullable(),
  reason: z.string(),
  sourceItemId: z.string().nullable(),
});
export type SfxCue = z.infer<typeof SfxCue>;
export const ClipAudio = z.object({
  id: z.string(), // "ca:<segmentId>"
  ...timed, segmentId: SegmentId, assetId: AssetId,
  sourceInFrames: Frame, // = picture sourceInFrames − (picture.from − from): J/L cuts stay lip-synced
  gainDb: z.number(), duckUnderVo: z.boolean(),
});
export const SilenceMark = z.object({
  id: z.string(), // "sil:<reason>:<beatId|chapterId|wordId>"
  ...timed,
  reason: z.enum(["reveal", "chapter", "drop_out", "irony", "bleep", "user"]),
  affects: z.array(z.enum(["music", "sfx", "clip", "vo"])).min(1), // "vo" only for bleeps
});
export const DuckingSpec = z.object({
  musicDuckDb: z.number().max(0), // -12
  sfxDuckDb: z.number().max(0), // -4
  clipDuckDb: z.number().max(0), // -10 (VO over clip audio, L-cuts)
  musicUnderClipDb: z.number().max(0), // -12
  attackMs: z.number().int().positive(), // 150
  releaseMs: z.number().int().positive(), // 400
  bridgeMs: z.number().int().nonnegative(), // 600: gaps shorter than this stay ducked
  padBeforeMs: z.number().int().nonnegative(), // 80
  padAfterMs: z.number().int().nonnegative(), // 120
});
export type DuckingSpec = z.infer<typeof DuckingSpec>;
export const AudioTimeline = z.object({
  /** vo_program.wav is ALREADY normalised: preview and mixer apply 0 dB to it. bakedGainDb is informational. */
  voProgram: z.object({ assetId: AssetId, bakedGainDb: z.number() }),
  voSpans: z.array(z.tuple([Frame, Frame])), // merged speech spans [from, to) (bridged < bridgeMs), drives ducking
  vo: z.array(VoClip), // per-segment clips (NLE export only)
  music: z.array(MusicSection),
  sfx: z.array(SfxCue),
  clip: z.array(ClipAudio),
  silences: z.array(SilenceMark),
  ducking: DuckingSpec,
});
export type AudioTimeline = z.infer<typeof AudioTimeline>;

// ---------------------------------------------------------------- markers, assets table, the Timeline
export const MarkerColor = z.enum(["red", "blue", "green", "yellow", "purple", "cyan", "orange"]);
export const Marker = z.object({
  id: z.string(), frame: Frame, dur: Frame, name: z.string(), note: z.string(), color: MarkerColor,
  kind: z.enum(["chapter", "ad-break", "sponsor", "factcheck", "source", "nle-note", "qa", "pickup"]),
});
export type Marker = z.infer<typeof Marker>;

export const TimelineAsset = z.object({
  id: AssetId,
  kind: AssetKind,
  ext: z.enum(["jpg", "png", "mp4", "wav"]),
  mime: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationFrames: Frame.nullable(),
  hasAudio: z.boolean(),
  projectRel: z.string(), // media/<id>.<ext> | program/<lang>/vo_program.wav | voice/…/seg.wav (the ONLY path field)
  // A procedural fallback (assets §7.9: gradient-grid / archive-still / paper-drift …): a backdrop with no subject of its own,
  // bare like a generated source for the dead-air rule (§9.3 step 7c). Absent = false.
  procedural: z.boolean().optional(),
});
export type TimelineAsset = z.infer<typeof TimelineAsset>;

export const Timeline = z.object({
  schemaVersion: docVersion("timeline"),
  projectSlug: Slug,
  lang: Lang,
  title: z.string(),
  styleId: z.string(),
  seed: z.number().int(),
  fps: Fps,
  width: z.literal(1920),
  height: z.literal(1080),
  durationInFrames: PosFrames,
  layoutHash: Sha256,
  takeId: TakeId,
  takeKind: z.enum(["scratch", "final"]),
  onlyChapters: z.array(ChapterId).nullable(),
  directorVersion: z.string(),
  captionsMode: CaptionsMode,
  chapters: z.array(z.object({ id: ChapterId, title: z.string(), act: ActId, from: Frame, dur: PosFrames })),
  video: z.array(VisualClip), // contiguous, sorted, covers [0, durationInFrames)
  overlays: z.array(OverlayItem),
  captions: z.array(CaptionGroup),
  fx: z.array(FxCue),
  audio: AudioTimeline,
  grade: Grade,
  markers: z.array(Marker),
  assets: z.record(AssetId, TimelineAsset),
  render: StyleRenderTokens,
});
export type Timeline = z.infer<typeof Timeline>;

// ---------------------------------------------------------------- user overrides (survive re-direct; fingerprinted)
export const TimelineOverride = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replaceSource"), clipId: z.string(), source: VisualSource }), // validatePick runs on the asset
  z.object({ op: z.literal("setTransition"), clipId: z.string(), transition: Transition }),
  z.object({ op: z.literal("setCamera"), clipId: z.string(), camera: CameraMove }),
  z.object({ op: z.literal("setLayout"), clipId: z.string(), layout: ClipLayout }),
  z.object({ op: z.literal("removeItem"), itemId: z.string() }), // overlay | caption | fx | sfx | music | silence id; never vo:*
  z.object({ op: z.literal("addOverlay"), item: OverlayItem }), // anchored; validated like director items
  z.object({ op: z.literal("patchOverlayProps"), itemId: z.string(), props: z.record(z.string(), z.unknown()) }), // merged → OVERLAY_PROPS[component]
  z.object({ op: z.literal("setSfxGain"), itemId: z.string(), gainDb: z.number().min(-30).max(6) }),
]);
export type TimelineOverride = z.infer<typeof TimelineOverride>;
/** Fingerprint: the override applies only while its target still matches (else → rejected, surfaced in the UI). */
export const OverrideTarget = z.object({
  itemId: z.string(),
  component: z.string().nullable(), // overlay component at creation
  beatId: BeatId.nullable(),
  planKey: Sha16.nullable(), // beat planKey at creation
  assetId: AssetId.nullable(), // clip source at creation (replaceSource/setCamera/setLayout)
  wordNorm: z.string().nullable(), // first anchored word's norm at creation
});
export const OverridesDoc = z.object({
  schemaVersion: docVersion("overrides"),
  lang: Lang,
  overrides: z.array(z.object({ id: z.string(), createdAt: IsoDateTime, target: OverrideTarget, override: TimelineOverride })),
});
export type OverridesDoc = z.infer<typeof OverridesDoc>;

/** timeline/<lang>.usage.json — written by `direct`; joined with the ledger by credits/export. */
export const UsageDoc = z.object({
  schemaVersion: docVersion("usage"),
  lang: Lang,
  usage: z.array(z.object({ assetId: AssetId, itemIds: z.array(z.string()) })),
});
export type UsageDoc = z.infer<typeof UsageDoc>;

// ---- inferred types (one per schema constant)
export type Edge = z.infer<typeof Edge>;
export type CameraKey = z.infer<typeof CameraKey>;
export type Direction = z.infer<typeof Direction>;
export type CoverPresentation = z.infer<typeof CoverPresentation>;
export type OverlapPresentation = z.infer<typeof OverlapPresentation>;
export type CaptionTone = z.infer<typeof CaptionTone>;
export type CaptionWord = z.infer<typeof CaptionWord>;
export type VoClip = z.infer<typeof VoClip>;
export type ClipAudio = z.infer<typeof ClipAudio>;
export type SilenceMark = z.infer<typeof SilenceMark>;
export type MarkerColor = z.infer<typeof MarkerColor>;
export type OverrideTarget = z.infer<typeof OverrideTarget>;
