import { z } from "zod";
import { ActId, Color, Lang, PxRect, Range2, Unit } from "./common";
import { CueType, MusicMood, TransitionIntent, VisualKind } from "./beats";
import { Device } from "./script";
import { TopicType } from "./research";
import { ClipLayout, OverlayComponentId } from "./components";
import { SfxCategory } from "./media";
import { Pauses } from "./layout";
import { CaptionVariant, ThemeOverride } from "./project";

export const TransitionKey = z.enum([
  "cut", "pulse", "flash", "whip", "zoomThrough", "zoomThroughInverse", "cutTheCurve", "pushCut",
  "dipToBlack", "dipToWhite", "lightLeak", "filmBurn", "glitch", "paperRip", "dotWipe", "iris", "whipStreaks",
  "dissolve", "blurDissolve", "push", "wipe",
]);
export type TransitionKey = z.infer<typeof TransitionKey>;
/**
 * Covers a renderer may not implement yet map here (the director applies the chain; remotion's resolveCover too).
 * All of §10.5 is implemented (W7, 2026-10-03), so the map is empty; it was
 * `{ filmBurn|paperRip|whipStreaks → flash, dotWipe|iris → dipToBlack }` in P0/P1.
 */
export const DEFERRED_TRANSITIONS: Partial<Record<TransitionKey, TransitionKey>> = {};

export const MacroAct = z.enum(["setup", "confrontation", "resolution"]);
export type MacroAct = z.infer<typeof MacroAct>;
export const StoryShape = z.object({
  id: z.string(), // "rise-fall" | "fall-comeback" | "spiral-twist" | "investigation" | "essay-arc"
  label: z.string(),
  acts: z.array(z.object({ id: ActId, share: Unit, purpose: z.string(), macro: MacroAct })).min(2),
});
export type StoryShape = z.infer<typeof StoryShape>;
export const ScriptProfile = z.object({
  id: z.string(),
  storyShapes: z.array(StoryShape).min(1),
  defaultShape: z.string(),
  charsPerSec: z.object({ en: z.number().positive(), fr: z.number().positive() }),
  avgCharsPerWord: z.object({ en: z.number().positive(), fr: z.number().positive() }),
  narrationShare: Unit,
  hookMaxSec: z.number().positive(),
  chapterSec: Range2,
  maxGapNoDeviceSec: z.number().positive(),
  sentenceWords: Range2,
  beatSec: z.object({ hook: Range2, body: Range2, avgBody: z.number().positive() }),
  devices: z.array(Device),
  bannedPhrases: z.object({ en: z.array(z.string()), fr: z.array(z.string()) }),
  adBreaks: z.object({ firstAfterSec: Range2, everySec: Range2 }),
  revisionRounds: z.number().int().min(0).max(3),
  maxClipShare: z.object({ warn: Unit, error: Unit }), // share of runtime that is third-party clips (0.10 / 0.15)
});
export type ScriptProfile = z.infer<typeof ScriptProfile>;

export const ZoneRects = z.object({
  center: PxRect, lowerThird: PxRect, topLeft: PxRect, topRight: PxRect, full: PxRect, captionBand: PxRect,
});
export const StyleTokens = z.object({
  palette: z.object({
    ink: Color, paper: Color, text: Color, accent: Color, danger: Color, money: Color, secondary: Color, muted: Color,
  }),
  fonts: z.object({ // family names; MUST exist in BUILTIN_FONTS (core) or in the style's own fonts/ (M2)
    headline: z.string(), slam: z.string(), body: z.string(), mono: z.string(),
    serif: z.string(), caption: z.string(), document: z.string(),
  }),
  typeRamp: z.object({
    caption: z.number(), keywordCaption: z.number(), lowerThirdName: z.number(), lowerThirdRole: z.number(),
    chapterTitle: z.number(), chapterKicker: z.number(), slam: z.number(), counter: z.number(), cardBody: z.number(), label: z.number(),
  }),
  layout: z.object({ safe: PxRect, zones: ZoneRects, keepOut: z.array(PxRect.extend({ reason: z.string() })) }),
  backdrop: z.enum(["gradientGrid", "paper", "darkNoise", "blurSelf"]), // default card/chapter backdrop recipe
});
export type StyleTokens = z.infer<typeof StyleTokens>;

const Bezier = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const MotionTokens = z.object({
  entryEase: Bezier, // expo.out ≈ [0.16, 1, 0.3, 1]
  exitEase: Bezier,
  kbEase: Bezier, // shallow ease with NON-ZERO end slopes (≥ 0.5 × mean): [0.2, 0.12, 0.8, 0.88]
  cameraEase: Bezier,
  entryMaxFrames: z.number().int(), // ≤ 800 ms
  staggerMaxFrames: z.number().int(), // ≤ 500 ms total
  overshootAllowedIn: z.array(OverlayComponentId),
  stepFps: z.number().nullable(), // 12 → stepped element motion (vox, R3); null = smooth
});
export type MotionTokens = z.infer<typeof MotionTokens>;

export const TransitionPolicy = z.object({
  cutShare: Unit, // TARGET share of shot boundaries that stay plain cuts (drama 0.85); the quota fill aims at 1-cutShare ± tolerance
  quota: z.object({ minEnergy: z.number().int().min(1).max(5), tolerance: Unit, window: z.number().int().positive() }),
  primary: TransitionKey,
  primaryShare: Range2, // share of non-cut transitions that are `primary` (0.6–0.7) — lint warning outside
  accents: z.array(TransitionKey),
  maxKindsPerFilm: z.number().int().positive(),
  accentKindsPerAct: z.number().int().nonnegative(),
  noRepeatRun: z.number().int().min(2), // 3 → never 3 alike in a row
  minGapFrames: z.number().int().nonnegative(), // no two non-cut transitions closer than this (30 = 1 s)
  chapterBoundary: z.enum(["cut+impact", "dipToBlack", "flash"]),
  actBoundary: TransitionKey, // MACRO-act boundaries only (≤ 2–3 per film); micro-act boundaries use chapterBoundary
  energyFrames: z.object({ calm: Range2, medium: Range2, high: Range2 }), // at 30 fps
  cueMap: z.partialRecord(CueType, TransitionKey),
  intentMap: z.partialRecord(TransitionIntent, TransitionKey),
  flash: z.object({ routine: Range2, cap: z.number(), explicitMax: z.number(), explicitPerMin: z.number(), frames: Range2 }),
  weights: z.partialRecord(TransitionKey, z.number()),
  montage: z.object({ primary: TransitionKey, flashPeak: Unit }), // montage cuts: pushCut + flash .2
});
export type TransitionPolicy = z.infer<typeof TransitionPolicy>;

const EnergyMul = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]); // energy 1..5
export const CameraPolicy = z.object({
  shots: z.object({
    aslSec: Range2, targetAslSec: z.number(), aslMaxSec: z.number(), hookAslFactor: z.number(), maxStaticHoldSec: z.number(),
    minShotFrames: z.number().int(), cutLeadFrames: z.number().int(), visualChangeSec: Range2,
    aslMul: z.object({ byEnergy: EnergyMul, byCue: z.partialRecord(CueType, z.number()), byAct: z.record(z.string(), z.number()) }),
  }),
  kenBurns: z.object({
    minShotSec: z.number(), scaleStart: Range2,
    scaleRatePerSec: Range2, // e.g. 0.025–0.04 (= 2.5–4 %/s) — matched speed across cuts
    driftPxPerSec: Range2, // e.g. 10–20 px/s (full value for up/down too)
    videoCreep: Range2,
  }),
  reframe: z.object({ scale: Range2, wideScale: Range2 }), // tight = 1.25–1.45 toward focal; wide = 1.00–1.04
  maxUpscale: z.number(), // effective source-pixel upscale cap (1.6) for cover/punch/reframe
  punch: z.object({
    perMin: Range2, scale: Range2, inFrames: Range2, minGapFrames: z.number().int(), holdToShotEnd: z.boolean(),
    minTailFrames: z.number().int(), exclusionFrames: z.number().int(), fillToMin: z.boolean(), whooshMinGapSec: z.number(),
  }),
  cutAccent: z.object({ share: Unit, pulseAmt: z.number(), pulseFrames: z.number().int(), flashPeak: z.number(), flashFrames: z.number().int() }),
  plate: z.object({ punch: z.number(), decay: z.number(), shakeX: z.number(), shakeY: z.number(), hz: z.number(), windowSec: z.number(), anchorOffsetMs: z.number() }),
  impactShake: z.object({ frames: Range2, ampPx: Range2, rotDeg: Range2, overscan: z.number() }), // slam entries + chapter hits
  creep: z.object({ scale: Range2, frames: Range2 }),
  pullBack: z.object({ from: z.number(), frames: z.number().int(), blurPx: z.number() }),
  handheld: z.object({ ampPx: z.number(), fps: z.number() }).nullable(),
  quietBeforeClimaxSec: Range2,
  montage: z.object({ aslSec: Range2, snapFrames: z.number().int(), beatPunch: z.object({ amt: z.number(), frames: z.number().int(), curve: z.number() }) }),
  clip: z.object({ creep: Range2, switchLayoutAfterSec: z.number(), keyLinePunch: z.number() }),
});
export type CameraPolicy = z.infer<typeof CameraPolicy>;

export const StillPolicy = z.object({
  layoutWeights: z.object({ cover: z.number(), card: z.number() }), // drama 0.6 / 0.4
  cardIfAspectBelow: z.number(), // 1.25 (portraits, squares)
  cardIfWidthBelow: z.number().int(), // 1400 px
  maxCardRun: z.number().int().positive(), // never more than 2 card shots in a row
  card: z.object({
    heightFrac: Range2, borderPx: Range2, tiltDeg: Range2,
    shadow: z.object({ offsetY: z.number(), blurPx: z.number(), opacity: Unit }),
    backdrops: z.array(z.enum(["gradientGrid", "paper", "blurSelf", "darkNoise"])).min(1),
  }),
  assetReuseMinGapSec: z.number(), // a reuse inside this gap MUST change layout or framing
});
export type StillPolicy = z.infer<typeof StillPolicy>;

export const CaptionDNA = z.object({
  defaultMode: z.enum(["burn", "srt-only", "off"]),
  variant: CaptionVariant, // drama: "keywords"
  font: z.string(), sizePx: z.number().int(), weight: z.number().int(), uppercase: z.boolean(), letterSpacingEm: z.number(),
  strokePx: z.number(), strokeColor: Color, color: Color, keywordColor: Color, moneyColor: Color, dangerColor: Color,
  popFrom: z.number(), popFrames: z.number().int(),
  oneLine: z.boolean(),
  grouping: z.object({ // burned groups (pop/karaoke/rail)
    maxWords: z.number().int(), maxSec: z.number(), minWords: z.number().int(), minSec: z.number(),
    pauseBreakMs: z.number().int(), commaPauseMs: z.number().int(), leadMs: z.number().int(),
    tailMs: z.number().int(), gapMs: z.number().int(), maxChars: z.number().int(),
  }),
  srtGrouping: z.object({ maxChars: z.number().int(), maxLines: z.number().int(), maxSec: z.number(), minSec: z.number() }),
  keywords: z.object({ minGapSec: Range2, maxWords: z.number().int(), sizePx: z.number().int(), holdMinSec: z.number() }),
  heroScale: z.number(), heroWordMinGapSec: z.number(),
  suppressUnder: z.array(OverlayComponentId),
  suppressMinWords: z.number().int(), // also suppress under ANY overlay carrying ≥ this many words of text
  clipStyle: z.object({ font: z.string(), sizePx: z.number().int(), color: Color, background: Color, minHoldSec: z.number() }),
});
export type CaptionDNA = z.infer<typeof CaptionDNA>;

export const SfxPolicy = z.object({
  perMin: Range2, // [floor, cap] — the fill pass raises sparse minutes to the floor
  impactsPerMin: Range2,
  silentCutShare: Unit, // ≈ half of cuts carry no transition SFX
  minGapFrames: z.number().int(),
  noRepeat: z.boolean(),
  allowComedic: z.boolean(), // record scratch, vine boom … (licence-flagged pack)
  peakDb: z.partialRecord(SfxCategory, Range2), // target peak dBFS ranges
  silencesPerFiveMin: z.number(), // floor, counted over the whole film (acts < 90 s are exempt)
  silenceFrames: Range2,
  firstAfterSilenceMinPriority: z.number().int(),
  heavyWhooshMinMovePx: z.number(),
  fillToMin: z.boolean(),
});
export type SfxPolicy = z.infer<typeof SfxPolicy>;

export const MusicPolicy = z.object({
  sectionSec: Range2, // energy cycles 2–4 min
  dropBeforeRevealSec: Range2, // RevealSequence silence length (≤ the layout preRevealMs gap)
  dropOutSec: Range2, // musicCue drop_out
  ironyDropSec: Range2, // IRONY cue
  duckDb: z.number(), // default -12
  duckRangeDb: Range2, // allowed [-15,-8]
  sfxDuckDb: z.number(), // -4
  clipDuckDb: z.number(), // VO over clip audio
  jCutFrames: z.number().int(),
  crossfadeFrames: z.number().int(),
  fadeInFrames: z.number().int(),
  fadeOutFrames: z.number().int(),
  moodBpm: z.partialRecord(MusicMood, z.number()),
  noVoGainDb: z.number(), // music level when no VO (relative to the -18 LUFS stem): 0..+2 (montages rise via ducking release)
});
export type MusicPolicy = z.infer<typeof MusicPolicy>;

export const LutParams = z.object({
  contrast: z.number(), saturation: z.number(), vibrance: z.number(),
  shadows: z.tuple([z.number(), z.number(), z.number()]), highlights: z.tuple([z.number(), z.number(), z.number()]),
  blacks: z.number(), whites: z.number(), temp: z.number(), intensity: Unit,
});
const GradeCss = z.object({ contrast: z.number(), saturate: z.number(), brightness: z.number(), sepia: Unit, hueRotateDeg: z.number() });
export const Grade = z.object({
  look: z.enum(["none", "tealOrange", "bleachBypass", "filmFade", "desatCool", "warmPaper"]),
  css: GradeCss,
  splitTone: z.object({ shadows: Color, highlights: Color, amount: Unit }), // skipped for treatment "bw"
  vignette: z.object({ amount: Unit, radius: Unit, feather: Unit }),
  grainFfmpeg: z.number().min(0).max(16), // ffmpeg `noise=alls=N:allf=t` in master post; never in-browser
  letterbox: z.number().nullable(), // 2.39 → bars
  lut: LutParams.nullable(), // procedural .cube applied by ffmpeg lut3d in master post (§12.3); never in-browser
  byAct: z.record(z.string(), z.object({ css: GradeCss.partial(), vignetteAmount: Unit.nullable() })), // e.g. collapse act darker
  treatments: z.object({
    bw: GradeCss, // applied to the clip only (grayscale sources)
    archival: GradeCss, // pre-1970 colour sources: sepia + contrast
    duotone: z.object({ shadows: Color, highlights: Color }),
  }),
});
export type Grade = z.infer<typeof Grade>;

export const Budgets = z.object({
  keywordSlamPerMin: z.number(),
  lowerThirdMinGapSec: z.number(),
  overlayMaxConcurrent: z.number().int(),
  explicitFlashPerMin: z.number(),
  jlCutsPerFiveMin: z.number(),
  chapterCardFrames: Range2,
  salience: z.object({
    windowSec: z.number(), maxAccents: z.number(), minGapFrames: z.number().int(),
    weights: z.object({ transitionNonCut: z.number(), punch: z.number(), slam: z.number(), impactSfx: z.number(), overlayEntry: z.number(), flash: z.number() }),
  }),
  componentCooldownSec: z.partialRecord(OverlayComponentId, z.number()),
  cleanStretch: z.object({ everySec: z.number(), minSec: z.number() }), // ≥ 1 accent-free stretch (KB + captions only) per window
  actIntensity: z.record(z.string(), z.number()), // scales punch/SFX/non-cut probabilities & caps per act (default 1)
  titleSting: z.boolean(), // title sting at the end of the cold open
});
export type Budgets = z.infer<typeof Budgets>;
export const TechniqueFloor = z.object({
  perChapter: z.record(z.string(), z.number().int()), // e.g. { punch: 1 }
  perFiveMin: z.record(z.string(), z.number()), // e.g. { silence: 1, jlCut: 1 } (film-level, duration-scaled)
  exemptActsShorterThanSec: z.number(), // 90
});
/** triggers are READ by the director's cue→component pass (§9.3 step 7g). A trigger without a derivation rule is a style lint error. */
export const ComponentPolicy = z.object({ id: OverlayComponentId, enabled: z.boolean(), weight: z.number(), triggers: z.array(CueType) });

export const StyleManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), // descriptive; NEVER a channel name
  version: z.string(),
  names: z.object({ en: z.string(), fr: z.string() }),
  description: z.object({ en: z.string(), fr: z.string() }),
  category: z.enum(["commentary", "essay", "explainer", "true-crime"]),
  uses: z.array(z.string()), // ACCENT-FOLDED lowercase EN + FR keywords for suggestStyleOffline
  moods: z.array(z.string()),
  bestFor: z.array(TopicType),
  referencesDescription: z.string(), // prose only; no logos/trademarks in ids
  previewColor: Color,
});
export type StyleManifest = z.infer<typeof StyleManifest>;

/** The content of <styleDir>/style.json. */
export const StyleData = z.object({
  manifest: StyleManifest,
  scriptProfile: ScriptProfile,
  tokens: StyleTokens,
  motion: MotionTokens,
  transitionPolicy: TransitionPolicy,
  cameraPolicy: CameraPolicy,
  stills: StillPolicy,
  captionDNA: CaptionDNA,
  sfxPolicy: SfxPolicy,
  musicPolicy: MusicPolicy,
  grade: Grade,
  budgets: Budgets,
  techniqueFloor: TechniqueFloor,
  components: z.array(ComponentPolicy),
  clipLayout: ClipLayout,
  pauses: Pauses,
  visualPriority: z.array(VisualKind), // archival > clip > motion graphic > stock
});
export type StyleData = z.infer<typeof StyleData>;

/** <styleDir>/prompts.json */
export const StylePrompts = z.object({
  qualityDirective: z.string(), // fixed paragraph pasted into every generation prompt
  visualGrammar: z.string(), // beats prompt: visual priorities + motion_data_json formats per template
  narratorPersona: z.object({ en: z.string(), fr: z.string() }),
});
export type StylePrompts = z.infer<typeof StylePrompts>;
/** <styleDir>/fonts/font.json (M2): OFL fonts shipped with a user style. */
export const StyleFont = z.object({ family: z.string(), weight: z.number().int(), style: z.enum(["normal", "italic"]), file: z.string(), license: z.literal("OFL-1.1") });
export type StyleFont = z.infer<typeof StyleFont>;

export interface PromptPack extends StylePrompts {
  styleMd: string; // STYLE.md: 11 fixed sections (Essence/not, Materials, Colour logic, Type & subtitles, Motion quality,
  // Camera grammar table, Sound palette, Native moves, Pitfalls, Engine, Variation space)
  guideMd: string; // GUIDE.md: goals, numbered rules, reads-timing, Common failures, worked example, Banned list
}
export interface StylePlugin {
  readonly data: StyleData;
  readonly promptPack: PromptPack;
  readonly dir: string; // absolute style directory (builtin or <home>/styles/<id>)
  readonly source: "builtin" | "user";
  readonly fonts: readonly StyleFont[];
  readonly dataHash: string; // hashJson({data, promptPack, fonts}) — participates in stage input hashes
}

/** Subset of style data shipped inside each Timeline so @docmaker/remotion never imports @docmaker/styles. */
export const StyleRenderTokens = z.object({
  styleId: z.string(),
  tokens: StyleTokens, // already merged with Project.themeOverride
  motion: MotionTokens,
  captionDNA: CaptionDNA, // variant already resolved (project.captionsVariant ?? style)
  stills: StillPolicy.shape.card,
  theme: ThemeOverride.nullable(),
  fonts: z.array(z.object({ family: z.string(), weight: z.number().int(), style: z.enum(["normal", "italic"]), url: z.string() })), // M2 style fonts via asset server
});
export type StyleRenderTokens = z.infer<typeof StyleRenderTokens>;

// ---- inferred types (one per schema constant)
export type ZoneRects = z.infer<typeof ZoneRects>;
export type LutParams = z.infer<typeof LutParams>;
export type TechniqueFloor = z.infer<typeof TechniqueFloor>;
export type ComponentPolicy = z.infer<typeof ComponentPolicy>;
