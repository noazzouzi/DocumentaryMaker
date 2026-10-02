// Built-in render tokens (the drama-commentary values of Appendix A) for compositions rendered without a Timeline
// (GeneratedStill with bare StyleTokens, FontSpecimen, StyleSpecimen without props). Data only.
import type { Grade, StyleRenderTokens, StyleTokens } from "@docmaker/core";

export const DEFAULT_STYLE_TOKENS: StyleTokens = {
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
    keepOut: [{ x: 0, y: 950, w: 1920, h: 130, reason: "YouTube player controls" }],
  },
  backdrop: "gradientGrid",
};

export const DEFAULT_RENDER_TOKENS: StyleRenderTokens = {
  styleId: "drama-commentary",
  tokens: DEFAULT_STYLE_TOKENS,
  motion: {
    entryEase: [0.16, 1, 0.3, 1], exitEase: [0.7, 0, 0.84, 0], kbEase: [0.2, 0.12, 0.8, 0.88], cameraEase: [0.65, 0, 0.35, 1],
    entryMaxFrames: 24, staggerMaxFrames: 15, overshootAllowedIn: ["Stamp"], stepFps: null,
  },
  captionDNA: {
    defaultMode: "burn", variant: "keywords", font: "Archivo Black", sizePx: 78, weight: 900, uppercase: true, letterSpacingEm: -0.02,
    strokePx: 9, strokeColor: "#000000", color: "#FFFFFF", keywordColor: "#FFD400", moneyColor: "#3DDC84", dangerColor: "#FF3B30",
    popFrom: 1.18, popFrames: 3, oneLine: true,
    grouping: { maxWords: 4, maxSec: 2.0, minWords: 2, minSec: 0.5, pauseBreakMs: 500, commaPauseMs: 250, leadMs: 80, tailMs: 600, gapMs: 50, maxChars: 22 },
    srtGrouping: { maxChars: 42, maxLines: 2, maxSec: 6, minSec: 1 },
    keywords: { minGapSec: [6, 10], maxWords: 4, sizePx: 96, holdMinSec: 1.0 },
    heroScale: 1.35, heroWordMinGapSec: 0.6, suppressUnder: [], suppressMinWords: 8,
    clipStyle: { font: "Inter", sizePx: 44, color: "#FFFFFF", background: "#000000B3", minHoldSec: 1.8 },
  },
  stills: { heightFrac: [0.7, 0.85], borderPx: [10, 14], tiltDeg: [1, 3], shadow: { offsetY: 35, blurPx: 60, opacity: 0.9 }, backdrops: ["gradientGrid", "paper", "blurSelf"] },
  theme: null,
  fonts: [],
};

export const DEFAULT_GRADE: Grade = {
  look: "none",
  css: { contrast: 1, saturate: 1, brightness: 1, sepia: 0, hueRotateDeg: 0 },
  splitTone: { shadows: "#1F4E5F", highlights: "#F2A65A", amount: 0 },
  vignette: { amount: 0, radius: 0.7, feather: 0.45 },
  grainFfmpeg: 0, letterbox: null, lut: null, byAct: {},
  treatments: {
    bw: { contrast: 1.12, saturate: 0, brightness: 1.0, sepia: 0, hueRotateDeg: 0 },
    archival: { contrast: 1.05, saturate: 0.85, brightness: 1.0, sepia: 0.25, hueRotateDeg: 0 },
    duotone: { shadows: "#1F2A44", highlights: "#FFD400" },
  },
};

/** Accepts StyleRenderTokens or bare StyleTokens (GeneratedStill `tokens` prop) and returns render tokens. */
export function coerceRenderTokens(x: unknown): StyleRenderTokens {
  const o = x as Partial<StyleRenderTokens> & Partial<StyleTokens> | null | undefined;
  if (o && typeof o === "object" && o.tokens && o.motion && o.captionDNA) return o as StyleRenderTokens;
  if (o && typeof o === "object" && o.palette && o.fonts && o.layout) return { ...DEFAULT_RENDER_TOKENS, tokens: o as StyleTokens };
  return DEFAULT_RENDER_TOKENS;
}
