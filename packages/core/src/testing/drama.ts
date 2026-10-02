// packages/core/src/testing/drama.ts — verbatim copy of SPEC Appendix A ($SP/design/core-v2/drama.ts) for TEST_STYLE.
// Test data only: the real style lives in packages/styles/builtin/drama-commentary/style.json (W1).
import type { StyleData } from "../schema/style";
type Macro = "setup" | "confrontation" | "resolution";
const acts = (xs: [string, number, Macro, string][]) => xs.map(([id, share, macro, purpose]) => ({ id, share, macro, purpose }));
export const dramaCommentaryData: StyleData = {
  manifest: {
    id: "drama-commentary", version: "2.0.0",
    names: { en: "Drama / commentary", fr: "Drama / commentaire" },
    description: {
      en: "Punchy downfall & scandal storytelling: rock-bottom cold open, escalating chapters, punch-ins, evidence cards, selective kinetic captions, budgeted heavy sound design.",
      fr: "Récit de chute et de scandale, rythmé : cold open au plus bas, chapitres en escalade, punch-ins, cartes de preuves, sous-titres cinétiques sélectifs, sound design dosé.",
    },
    category: "commentary",
    uses: [
      "downfall", "scandal", "celebrity", "internet drama", "company collapse", "controversy", "lawsuit", "trial", "fraud",
      "rise and fall", "feud", "drama", "cancelled", "bankrupt", "breakup",
      "rupture", "chute", "scandale", "proces", "affaire", "clash", "faillite", "escroquerie", "polemique", "descente aux enfers", "divorce",
    ],
    moods: ["tense", "ominous", "ironic", "epic"],
    bestFor: ["person_downfall", "company_collapse", "scandal_expose", "internet_drama", "rise_story"],
    referencesDescription: "Long-form narrated YouTube commentary documentaries about business downfalls and celebrity drama: archival-heavy, punchy edit, framed photo cards on moving backdrops, selective kinetic text.",
    previewColor: "#FFD400",
  },
  scriptProfile: {
    id: "drama-commentary/downfall",
    storyShapes: [
      { id: "rise-fall", label: "Rise → fall", acts: acts([
        ["cold_open", 0.04, "setup", "rock-bottom present, peak contrast, 3–6 escalating teasers, one-sentence promise"],
        ["act1_rise", 0.15, "setup", "origins and rise; why we cared"], ["inciting_turn", 0.06, "setup", "the first crack"],
        ["act2a_cracks", 0.24, "confrontation", "escalation with BUT/THEREFORE causality"], ["midpoint_false_hope", 0.10, "confrontation", "false redemption at ~60–70 %"],
        ["act2b_collapse", 0.25, "confrontation", "collapse and the biggest reveal"], ["act3_reckoning", 0.145, "resolution", "full circle, current status, thesis"],
        ["outro_rabbit_hole", 0.015, "resolution", "bridge to the next video"]]) },
      { id: "fall-comeback", label: "Fall → comeback", acts: acts([
        ["cold_open", 0.05, "setup", "lowest point"], ["act1_peak", 0.15, "setup", "the peak"], ["the_fall", 0.25, "confrontation", "how it fell apart"],
        ["rock_bottom", 0.15, "confrontation", "consequences"], ["comeback", 0.25, "confrontation", "the attempt to return"], ["act3_reckoning", 0.13, "resolution", "verdict and status"],
        ["outro_rabbit_hole", 0.02, "resolution", "bridge"]]) },
      { id: "spiral-twist", label: "Spiral → twist", acts: acts([
        ["cold_open", 0.05, "setup", "the strangest detail"], ["act1_setup", 0.15, "setup", "normal world"], ["spiral", 0.30, "confrontation", "escalating spiral"],
        ["twist", 0.15, "confrontation", "the reversal"], ["aftermath", 0.20, "resolution", "fallout"], ["act3_reckoning", 0.13, "resolution", "what it means"],
        ["outro_rabbit_hole", 0.02, "resolution", "bridge"]]) },
    ],
    defaultShape: "rise-fall",
    charsPerSec: { en: 16.5, fr: 16.0 }, avgCharsPerWord: { en: 5.6, fr: 5.7 },
    narrationShare: 0.82, hookMaxSec: 60, chapterSec: [120, 270], maxGapNoDeviceSec: 120, sentenceWords: [11, 18],
    beatSec: { hook: [1.0, 3.0], body: [1.5, 6.5], avgBody: 3.2 },
    devices: ["open_loop", "re_hook", "pattern_interrupt", "callback", "cliffhanger", "punchline", "rhetorical_question", "reveal", "payoff"],
    bannedPhrases: {
      en: ["in this video", "today we're going to", "before we start", "without further ado", "smash that", "don't forget to like", "here's the thing", "let's dive in"],
      fr: ["dans cette vidéo", "aujourd'hui on va", "avant de commencer", "sans plus attendre", "n'oubliez pas de liker", "abonnez-vous", "on va plonger"],
    },
    adBreaks: { firstAfterSec: [180, 300], everySec: [480, 600] },
    revisionRounds: 2,
    maxClipShare: { warn: 0.10, error: 0.15 },
  },
  tokens: {
    palette: { ink: "#0E0F0E", paper: "#F1EEE6", text: "#FFFFFF", accent: "#FFD400", danger: "#E8412F", money: "#3DDC84", secondary: "#2F3CFF", muted: "#8A8A8A" },
    fonts: { headline: "Anton", slam: "Archivo Black", body: "Inter", mono: "JetBrains Mono", serif: "Instrument Serif", caption: "Archivo Black", document: "Courier Prime" },
    typeRamp: { caption: 78, keywordCaption: 96, lowerThirdName: 54, lowerThirdRole: 30, chapterTitle: 120, chapterKicker: 28, slam: 220, counter: 160, cardBody: 40, label: 24 },
    layout: {
      safe: { x: 96, y: 54, w: 1728, h: 972 },
      zones: {
        center: { x: 240, y: 140, w: 1440, h: 600 }, lowerThird: { x: 96, y: 560, w: 900, h: 160 },
        topLeft: { x: 96, y: 64, w: 700, h: 80 }, topRight: { x: 1124, y: 64, w: 700, h: 80 },
        full: { x: 0, y: 0, w: 1920, h: 1080 }, captionBand: { x: 210, y: 760, w: 1500, h: 140 },
      },
      keepOut: [{ x: 0, y: 950, w: 1920, h: 130, reason: "YouTube player controls (bottom 12 %): no text" }],
    },
    backdrop: "gradientGrid",
  },
  motion: {
    entryEase: [0.16, 1, 0.3, 1], exitEase: [0.7, 0, 0.84, 0], kbEase: [0.2, 0.12, 0.8, 0.88], cameraEase: [0.65, 0, 0.35, 1],
    entryMaxFrames: 24, staggerMaxFrames: 15, overshootAllowedIn: ["Stamp"], stepFps: null,
  },
  transitionPolicy: {
    cutShare: 0.85, quota: { minEnergy: 3, tolerance: 0.05, window: 20 },
    primary: "flash", primaryShare: [0.6, 0.7], accents: ["whip", "zoomThrough", "glitch", "pushCut", "paperRip"],
    maxKindsPerFilm: 5, accentKindsPerAct: 2, noRepeatRun: 3, minGapFrames: 30, chapterBoundary: "cut+impact", actBoundary: "dipToBlack",
    energyFrames: { calm: [15, 24], medium: [9, 15], high: [5, 9] },
    cueMap: { TIME_JUMP: "whip", FLASHBACK: "lightLeak", REVEAL: "flash", ARTICLE: "zoomThrough", DOCUMENT: "zoomThrough", IRONY: "pushCut", MONTAGE: "pushCut" },
    intentMap: { cut: "cut", whip: "whip", flash: "flash", glitch: "glitch", zoom_through: "zoomThrough", crossfade: "dissolve", dip_to_black: "dipToBlack" },
    flash: { routine: [0.2, 0.45], cap: 0.5, explicitMax: 0.9, explicitPerMin: 1, frames: [2, 4] },
    weights: { flash: 0.62, whip: 0.1, zoomThrough: 0.1, glitch: 0.06, pushCut: 0.08, paperRip: 0.04 },
    montage: { primary: "pushCut", flashPeak: 0.2 },
  },
  cameraPolicy: {
    shots: {
      aslSec: [2, 4], targetAslSec: 3.0, aslMaxSec: 6, hookAslFactor: 0.6, maxStaticHoldSec: 3, minShotFrames: 24, cutLeadFrames: 2, visualChangeSec: [3, 5],
      aslMul: {
        byEnergy: [1.4, 1.2, 1.0, 0.85, 0.7],
        byCue: { TENSION_BUILD: 1.6, SHOCK: 0.6, REVEAL: 0.8, HOOK: 0.8, LIST: 0.8 },
        byAct: { act2b_collapse: 0.85, the_fall: 0.85, spiral: 0.85, act3_reckoning: 1.2, outro_rabbit_hole: 1.2 },
      },
    },
    kenBurns: { minShotSec: 2, scaleStart: [1.0, 1.04], scaleRatePerSec: [0.025, 0.04], driftPxPerSec: [10, 20], videoCreep: [1.0, 1.04] },
    reframe: { scale: [1.25, 1.45], wideScale: [1.0, 1.04] },
    maxUpscale: 1.6,
    punch: { perMin: [6, 10], scale: [1.12, 1.25], inFrames: [0, 3], minGapFrames: 90, holdToShotEnd: true, minTailFrames: 20, exclusionFrames: 6, fillToMin: true, whooshMinGapSec: 10 },
    cutAccent: { share: 0.15, pulseAmt: 0.05, pulseFrames: 8, flashPeak: 0.45, flashFrames: 6 },
    plate: { punch: 0.05, decay: 9, shakeX: 8, shakeY: 5, hz: 12, windowSec: 0.6, anchorOffsetMs: 45 },
    impactShake: { frames: [8, 15], ampPx: [10, 25], rotDeg: [0.5, 1], overscan: 1.03 },
    creep: { scale: [1.0, 1.06], frames: [120, 240] },
    pullBack: { from: 1.25, frames: 15, blurPx: 10 },
    handheld: null,
    quietBeforeClimaxSec: [0.3, 0.75],
    montage: { aslSec: [0.6, 1.2], snapFrames: 3, beatPunch: { amt: 0.055, frames: 8, curve: 2.5 } },
    clip: { creep: [1.0, 1.05], switchLayoutAfterSec: 8, keyLinePunch: 0.15 },
  },
  stills: {
    layoutWeights: { cover: 0.6, card: 0.4 }, cardIfAspectBelow: 1.25, cardIfWidthBelow: 1400, maxCardRun: 2,
    card: {
      heightFrac: [0.7, 0.85], borderPx: [10, 14], tiltDeg: [1, 3],
      shadow: { offsetY: 35, blurPx: 60, opacity: 0.9 },
      backdrops: ["gradientGrid", "paper", "blurSelf"],
    },
    assetReuseMinGapSec: 60,
  },
  captionDNA: {
    defaultMode: "burn", variant: "keywords", font: "Archivo Black", sizePx: 78, weight: 900, uppercase: true, letterSpacingEm: -0.02,
    strokePx: 9, strokeColor: "#000000", color: "#FFFFFF", keywordColor: "#FFD400", moneyColor: "#3DDC84", dangerColor: "#FF3B30",
    popFrom: 1.18, popFrames: 3, oneLine: true,
    grouping: { maxWords: 4, maxSec: 2.0, minWords: 2, minSec: 0.5, pauseBreakMs: 500, commaPauseMs: 250, leadMs: 80, tailMs: 600, gapMs: 50, maxChars: 22 },
    srtGrouping: { maxChars: 42, maxLines: 2, maxSec: 6, minSec: 1 },
    keywords: { minGapSec: [6, 10], maxWords: 4, sizePx: 96, holdMinSec: 1.0 },
    heroScale: 1.35, heroWordMinGapSec: 0.6,
    suppressUnder: ["KeywordSlam", "QuoteCard", "ChapterCard", "TitleSting", "ArticleHighlight", "DocumentCard", "HeadlineStack", "SocialPost", "KineticText", "TimelineGraphic", "BarChart", "MapPin", "CommentPile", "EvidenceBoard", "FreezeLabel"],
    suppressMinWords: 8,
    clipStyle: { font: "Inter", sizePx: 44, color: "#FFFFFF", background: "#000000B3", minHoldSec: 1.8 },
  },
  sfxPolicy: {
    perMin: [8, 15], impactsPerMin: [1, 3], silentCutShare: 0.5, minGapFrames: 6, noRepeat: true, allowComedic: false,
    peakDb: {
      "whoosh.light": [-24, -18], "whoosh.heavy": [-22, -18], "whoosh.whip": [-22, -18], "whoosh.up": [-22, -18], "swell.reverse": [-22, -16],
      riser: [-20, -14], impact: [-12, -6], "impact.soft": [-16, -10], "boom.sub": [-12, -6], "boom.low": [-14, -8], thud: [-16, -10],
      pop: [-22, -16], click: [-24, -18], tick: [-28, -22], ding: [-22, -16], shutter: [-20, -14], glitch: [-20, -14], paper: [-24, -18],
      marker: [-26, -20], keys: [-28, -22], notification: [-20, -14], drone: [-30, -24], heartbeat: [-22, -16], bleep: [-18, -18],
      "ambience.room": [-38, -32], "ambience.crowd": [-34, -28],
    },
    silencesPerFiveMin: 2, silenceFrames: [12, 24], firstAfterSilenceMinPriority: 4, heavyWhooshMinMovePx: 400, fillToMin: true,
  },
  musicPolicy: {
    sectionSec: [120, 240], dropBeforeRevealSec: [0.5, 0.75], dropOutSec: [1, 3], ironyDropSec: [1, 1.5],
    duckDb: -12, duckRangeDb: [-15, -8], sfxDuckDb: -4, clipDuckDb: -10,
    jCutFrames: 12, crossfadeFrames: 15, fadeInFrames: 30, fadeOutFrames: 30,
    moodBpm: { ominous: 70, tense: 95, sad: 72, uplifting: 110, mysterious: 80, epic: 90, chill: 85, comedic: 115 },
    noVoGainDb: 0,
  },
  grade: {
    look: "tealOrange",
    css: { contrast: 1.08, saturate: 1.06, brightness: 1.0, sepia: 0, hueRotateDeg: 0 },
    splitTone: { shadows: "#1F4E5F", highlights: "#F2A65A", amount: 0.18 },
    vignette: { amount: 0.3, radius: 0.7, feather: 0.45 },
    grainFfmpeg: 4, letterbox: null,
    lut: { contrast: 0.18, saturation: 0.08, vibrance: 0.12, shadows: [-0.04, 0.05, 0.09], highlights: [0.1, 0.04, -0.03], blacks: 0, whites: 0, temp: 0, intensity: 0.62 },
    byAct: {
      act2b_collapse: { css: { saturate: 0.92, brightness: 0.96 }, vignetteAmount: 0.38 },
      act3_reckoning: { css: { saturate: 0.95 }, vignetteAmount: null },
    },
    treatments: {
      bw: { contrast: 1.12, saturate: 0, brightness: 1.0, sepia: 0, hueRotateDeg: 0 },
      archival: { contrast: 1.05, saturate: 0.85, brightness: 1.0, sepia: 0.25, hueRotateDeg: 0 },
      duotone: { shadows: "#1F2A44", highlights: "#FFD400" },
    },
  },
  budgets: {
    keywordSlamPerMin: 1, lowerThirdMinGapSec: 20, overlayMaxConcurrent: 2, explicitFlashPerMin: 1, jlCutsPerFiveMin: 1, chapterCardFrames: [72, 150],
    salience: { windowSec: 3, maxAccents: 3, minGapFrames: 6, weights: { transitionNonCut: 1, punch: 1, slam: 2, impactSfx: 1, overlayEntry: 1, flash: 1 } },
    componentCooldownSec: { SocialPost: 20, Stamp: 45, KeywordSlam: 60, LowerThird: 20, FreezeLabel: 60, PhotoBurst: 90, EvidenceBoard: 120, CommentPile: 120 },
    cleanStretch: { everySec: 60, minSec: 6 },
    actIntensity: { cold_open: 1.15, act2b_collapse: 1.2, midpoint_false_hope: 0.9, act3_reckoning: 0.7, outro_rabbit_hole: 0.6 },
    titleSting: true,
  },
  techniqueFloor: { perChapter: { punch: 1 }, perFiveMin: { silence: 2, jlCut: 1 }, exemptActsShorterThanSec: 90 },
  components: [
    { id: "LowerThird", enabled: true, weight: 1, triggers: ["PERSON_INTRO"] },
    { id: "ChapterCard", enabled: true, weight: 1, triggers: [] }, // structural
    { id: "TitleSting", enabled: true, weight: 1, triggers: [] }, // structural
    { id: "QuoteCard", enabled: true, weight: 1, triggers: ["QUOTE"] },
    { id: "SocialPost", enabled: true, weight: 1, triggers: ["TWEET"] },
    { id: "ArticleHighlight", enabled: true, weight: 1, triggers: [] }, // template only
    { id: "DocumentCard", enabled: true, weight: 1, triggers: [] }, // template only
    { id: "HeadlineStack", enabled: true, weight: 0.8, triggers: [] }, // template only
    { id: "Stamp", enabled: true, weight: 0.6, triggers: ["REVEAL"] },
    { id: "KeywordSlam", enabled: true, weight: 0.5, triggers: ["SHOCK"] },
    { id: "NumberCounter", enabled: true, weight: 1, triggers: ["NUMBER"] },
    { id: "DateStamp", enabled: true, weight: 1, triggers: ["TIME_JUMP"] },
    { id: "MapPin", enabled: true, weight: 1, triggers: [] }, // template only (needs lon/lat)
    { id: "TimelineGraphic", enabled: true, weight: 0.8, triggers: [] }, // template only
    { id: "BarChart", enabled: true, weight: 0.8, triggers: [] }, // template only
    { id: "SplitScreen", enabled: true, weight: 0.8, triggers: ["COMPARISON"] },
    { id: "CensorBar", enabled: true, weight: 1, triggers: ["SENSITIVE"] },
    { id: "Spotlight", enabled: true, weight: 0.6, triggers: ["DOCUMENT", "EMPHASIS"] },
    { id: "KineticText", enabled: true, weight: 0.7, triggers: ["LIST", "EMPHASIS"] },
    { id: "SourceLabel", enabled: true, weight: 1, triggers: ["CLIP_REF"] },
    { id: "Letterbox", enabled: false, weight: 0, triggers: [] },
    { id: "FreezeLabel", enabled: true, weight: 0.5, triggers: ["PERSON_INTRO"] },
    { id: "PhotoBurst", enabled: true, weight: 0.6, triggers: ["LIST", "MONTAGE"] },
    { id: "EvidenceBoard", enabled: true, weight: 0.4, triggers: ["LIST"] },
    { id: "CommentPile", enabled: true, weight: 1, triggers: [] }, // template only
  ],
  clipLayout: "pip",
  pauses: { headMs: 300, segmentGapMs: 250, deviceGapMs: 450, chapterGapMs: 2500, preRevealMs: 750, clipLeadMs: 300, clipTailMs: 400, tailMs: 2000 },
  visualPriority: ["archival_photo", "news_footage", "youtube_clip", "motion_graphic", "document_screenshot", "social_post", "map", "text_card", "stock_broll", "ai_illustration"],
};
