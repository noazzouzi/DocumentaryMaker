// validateStyleData — deterministic style lint (schema + semantic rules). Returns LintIssue[]; never throws.
import {
  COMPONENT_META, DERIVABLE_TRIGGERS, MacroAct, OverlayComponentId, StyleData, TransitionKey,
  type LintIssue, type PxRect, type StyleFont,
} from "@docmaker/core";
import { foldKeyword } from "./text";

export const FRAME_W = 1920;
export const FRAME_H = 1080;
/** Act shares of every story shape must sum to 1 within this tolerance. */
export const ACT_SHARE_TOLERANCE = 1e-6;

/** Stable rule codes (consumers may filter on them). */
export const STYLE_RULES = {
  schema: "STYLE_SCHEMA",
  actShares: "STYLE_ACT_SHARES",
  macroActs: "STYLE_MACRO_ACTS",
  macroOrder: "STYLE_MACRO_ORDER",
  duplicateAct: "STYLE_DUPLICATE_ACT",
  duplicateShape: "STYLE_DUPLICATE_SHAPE",
  defaultShape: "STYLE_DEFAULT_SHAPE",
  unknownAct: "STYLE_UNKNOWN_ACT",
  font: "STYLE_FONT_UNKNOWN",
  zoneOutside: "STYLE_ZONE_OUTSIDE",
  zoneOutsideSafe: "STYLE_ZONE_OUTSIDE_SAFE",
  captionKeepOut: "STYLE_CAPTION_KEEPOUT",
  zoneKeepOut: "STYLE_ZONE_KEEPOUT",
  trigger: "STYLE_TRIGGER_UNDERIVABLE",
  duplicateComponent: "STYLE_DUPLICATE_COMPONENT",
  weight: "STYLE_NEGATIVE_WEIGHT",
  zeroWeight: "STYLE_ENABLED_ZERO_WEIGHT",
  transitionKey: "STYLE_TRANSITION_KEY",
  transitionWeights: "STYLE_TRANSITION_WEIGHTS",
  range: "STYLE_RANGE_ORDER",
  bezier: "STYLE_BEZIER",
  kbEase: "STYLE_KB_EASE_SLOPE",
  motionTiming: "STYLE_MOTION_TIMING",
  overshoot: "STYLE_OVERSHOOT",
  grouping: "STYLE_CAPTION_GROUPING",
  duck: "STYLE_DUCK_RANGE",
  peakDb: "STYLE_SFX_PEAK",
  typeRamp: "STYLE_TYPE_RAMP",
  layoutWeights: "STYLE_LAYOUT_WEIGHTS",
  visualPriority: "STYLE_VISUAL_PRIORITY",
  uses: "STYLE_USES_NOT_FOLDED",
} as const;

const TRANSITION_KEYS: ReadonlySet<string> = new Set(TransitionKey.options);
const COMPONENT_IDS: ReadonlySet<string> = new Set(OverlayComponentId.options);

const err = (rule: string, where: string, msg: string): LintIssue => ({ level: "error", rule, where, msg });
const warn = (rule: string, where: string, msg: string): LintIssue => ({ level: "warn", rule, where, msg });

function rectStr(r: PxRect): string {
  return `{x:${r.x}, y:${r.y}, w:${r.w}, h:${r.h}}`;
}
function insideFrame(r: PxRect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= FRAME_W && r.y + r.h <= FRAME_H;
}
function inside(r: PxRect, outer: PxRect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
}
/** Positive-area intersection (touching edges do not count). */
export function rectsIntersect(a: PxRect, b: PxRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Every 2-number tuple in StyleData is a Range2 [min, max]; walk the tree and report inverted ranges. */
function checkRanges(v: unknown, path: string, out: LintIssue[]): void {
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
      if (v[0] > v[1]) out.push(err(STYLE_RULES.range, path, `range [${v[0]}, ${v[1]}] has min > max`));
      return;
    }
    v.forEach((x, i) => checkRanges(x, `${path}[${i}]`, out));
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) checkRanges(x, path ? `${path}.${k}` : k, out);
  }
}

function checkBezier(name: string, b: readonly [number, number, number, number], out: LintIssue[]): void {
  const [x1, , x2] = b;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    out.push(err(STYLE_RULES.bezier, `motion.${name}`, `cubic-bezier x control points must lie in [0, 1] (got ${x1}, ${x2})`));
  }
}

/**
 * Lints raw style data. Schema errors are reported (one issue per zod issue) and stop the semantic pass.
 * `fontFamilies` is normally BUILTIN_FONT_FAMILIES; families of `styleFonts` (fonts/font.json, M2) are allowed too.
 */
export function lintStyleData(data: unknown, o: { fontFamilies: readonly string[]; styleFonts?: readonly StyleFont[] }): LintIssue[] {
  const parsed = StyleData.safeParse(data);
  if (!parsed.success) {
    return parsed.error.issues.map((i) =>
      err(STYLE_RULES.schema, i.path.length ? i.path.map(String).join(".") : "global", i.message));
  }
  const d = parsed.data;
  const out: LintIssue[] = [];

  // ---- story shapes and acts
  const sp = d.scriptProfile;
  const shapeIds = new Set<string>();
  const allActs = new Set<string>();
  for (const shape of sp.storyShapes) {
    const where = `scriptProfile.storyShapes.${shape.id}`;
    if (shapeIds.has(shape.id)) out.push(err(STYLE_RULES.duplicateShape, where, `duplicate story shape id "${shape.id}"`));
    shapeIds.add(shape.id);
    const sum = shape.acts.reduce((s, a) => s + a.share, 0);
    if (Math.abs(sum - 1) > ACT_SHARE_TOLERANCE) {
      out.push(err(STYLE_RULES.actShares, where, `act shares sum to ${sum} (must be 1 ± ${ACT_SHARE_TOLERANCE})`));
    }
    const actIds = new Set<string>();
    for (const a of shape.acts) {
      if (actIds.has(a.id)) out.push(err(STYLE_RULES.duplicateAct, where, `duplicate act id "${a.id}"`));
      actIds.add(a.id);
      allActs.add(a.id);
    }
    const missing = MacroAct.options.filter((m) => !shape.acts.some((a) => a.macro === m));
    if (missing.length) out.push(err(STYLE_RULES.macroActs, where, `missing macro act(s): ${missing.join(", ")}`));
    const order = shape.acts.map((a) => MacroAct.options.indexOf(a.macro));
    if (order.some((x, i) => i > 0 && x < order[i - 1]!)) {
      out.push(warn(STYLE_RULES.macroOrder, where, "macro acts are not in setup → confrontation → resolution order"));
    }
  }
  if (!shapeIds.has(sp.defaultShape)) {
    out.push(err(STYLE_RULES.defaultShape, "scriptProfile.defaultShape", `default shape "${sp.defaultShape}" is not a declared story shape`));
  }
  const actKeyed: [string, Record<string, unknown>][] = [
    ["cameraPolicy.shots.aslMul.byAct", d.cameraPolicy.shots.aslMul.byAct],
    ["grade.byAct", d.grade.byAct],
    ["budgets.actIntensity", d.budgets.actIntensity],
  ];
  for (const [where, rec] of actKeyed) {
    for (const k of Object.keys(rec)) {
      if (!allActs.has(k)) out.push(warn(STYLE_RULES.unknownAct, where, `act "${k}" is not an act of any story shape (ignored)`));
    }
  }

  // ---- fonts
  const families = new Set<string>([...o.fontFamilies, ...(o.styleFonts ?? []).map((f) => f.family)]);
  const fontRefs: [string, string][] = [
    ...Object.entries(d.tokens.fonts).map(([k, f]) => [`tokens.fonts.${k}`, f] as [string, string]),
    ["captionDNA.font", d.captionDNA.font],
    ["captionDNA.clipStyle.font", d.captionDNA.clipStyle.font],
  ];
  for (const [where, fam] of fontRefs) {
    if (!families.has(fam)) {
      out.push(err(STYLE_RULES.font, where, `font family "${fam}" is neither built in nor shipped in the style's fonts/`));
    }
  }

  // ---- layout zones
  const { safe, zones, keepOut } = d.tokens.layout;
  const rects: [string, PxRect][] = [
    ["tokens.layout.safe", safe],
    ...Object.entries(zones).map(([k, r]) => [`tokens.layout.zones.${k}`, r] as [string, PxRect]),
    ...keepOut.map((r, i) => [`tokens.layout.keepOut[${i}]`, r] as [string, PxRect]),
  ];
  for (const [where, r] of rects) {
    if (!insideFrame(r)) out.push(err(STYLE_RULES.zoneOutside, where, `${rectStr(r)} is outside the ${FRAME_W}×${FRAME_H} frame`));
  }
  for (const [k, r] of Object.entries(zones)) {
    if (k === "full") continue;
    if (!inside(r, safe)) out.push(warn(STYLE_RULES.zoneOutsideSafe, `tokens.layout.zones.${k}`, `${rectStr(r)} extends beyond the safe area`));
  }
  keepOut.forEach((ko, i) => {
    if (rectsIntersect(zones.captionBand, ko)) {
      out.push(err(STYLE_RULES.captionKeepOut, "tokens.layout.zones.captionBand",
        `caption band ${rectStr(zones.captionBand)} overlaps keep-out[${i}] (${ko.reason})`));
    }
    for (const k of ["center", "lowerThird", "topLeft", "topRight"] as const) {
      if (rectsIntersect(zones[k], ko)) {
        out.push(warn(STYLE_RULES.zoneKeepOut, `tokens.layout.zones.${k}`, `text zone overlaps keep-out[${i}] (${ko.reason})`));
      }
    }
  });

  // ---- components
  const seen = new Set<string>();
  for (const c of d.components) {
    const where = `components.${c.id}`;
    if (seen.has(c.id)) out.push(err(STYLE_RULES.duplicateComponent, where, `component "${c.id}" is listed twice`));
    seen.add(c.id);
    if (c.weight < 0) out.push(err(STYLE_RULES.weight, where, `weight ${c.weight} < 0`));
    if (c.enabled && c.weight === 0) out.push(warn(STYLE_RULES.zeroWeight, where, "enabled with weight 0 (never chosen by cue triggers)"));
    const derivable = DERIVABLE_TRIGGERS[c.id];
    for (const t of c.triggers) {
      if (!derivable.includes(t)) {
        out.push(err(STYLE_RULES.trigger, where,
          `trigger ${t} has no director derivation rule for ${c.id} (derivable: ${derivable.length ? derivable.join(", ") : "none"})`));
      }
    }
  }
  for (const id of d.motion.overshootAllowedIn) {
    if (!COMPONENT_IDS.has(id) || !COMPONENT_META[id].overshootAllowed) {
      out.push(warn(STYLE_RULES.overshoot, "motion.overshootAllowedIn", `${id} is not a whitelisted impact component; overshoot will be ignored`));
    }
  }
  // an enabled impact component whose renderer always overshoots is never placed when the style forbids its overshoot
  for (const [i, c] of d.components.entries()) {
    if (c.enabled && COMPONENT_IDS.has(c.id) && COMPONENT_META[c.id].overshootAllowed && !d.motion.overshootAllowedIn.includes(c.id)) {
      out.push(warn(STYLE_RULES.overshoot, `components[${i}]`, `${c.id} is enabled but missing from motion.overshootAllowedIn; the director never places it`));
    }
  }

  // ---- transitions
  const tp = d.transitionPolicy;
  const keyRefs: [string, string][] = [
    ["transitionPolicy.primary", tp.primary],
    ["transitionPolicy.actBoundary", tp.actBoundary],
    ["transitionPolicy.montage.primary", tp.montage.primary],
    ...tp.accents.map((a, i) => [`transitionPolicy.accents[${i}]`, a] as [string, string]),
    ...Object.entries(tp.cueMap).map(([k, v]) => [`transitionPolicy.cueMap.${k}`, String(v)] as [string, string]),
    ...Object.entries(tp.intentMap).map(([k, v]) => [`transitionPolicy.intentMap.${k}`, String(v)] as [string, string]),
    ...Object.keys(tp.weights).map((k) => [`transitionPolicy.weights`, k] as [string, string]),
  ];
  for (const [where, k] of keyRefs) {
    if (!TRANSITION_KEYS.has(k)) out.push(err(STYLE_RULES.transitionKey, where, `unknown transition key "${k}"`));
  }
  for (const [k, w] of Object.entries(tp.weights)) {
    if (w === undefined) continue;
    if (w < 0) out.push(err(STYLE_RULES.weight, `transitionPolicy.weights.${k}`, `weight ${w} < 0`));
    if (w > 0 && k !== tp.primary && !tp.accents.includes(k as TransitionKey)) {
      out.push(warn(STYLE_RULES.transitionWeights, `transitionPolicy.weights.${k}`, `${k} is weighted but is neither the primary nor an accent`));
    }
  }
  if (tp.primary === "cut") out.push(warn(STYLE_RULES.transitionKey, "transitionPolicy.primary", "primary non-cut transition is \"cut\""));

  // ---- generic ranges, eases, motion timing
  checkRanges(d, "", out);
  for (const name of ["entryEase", "exitEase", "kbEase", "cameraEase"] as const) checkBezier(name, d.motion[name], out);
  {
    // Ken Burns ease must keep moving at both ends (slopes ≥ 0.5 × mean slope) so matched-speed cuts do not stall
    const [x1, y1, x2, y2] = d.motion.kbEase;
    const s0 = x1 > 0 ? y1 / x1 : Infinity;
    const s1 = x2 < 1 ? (1 - y2) / (1 - x2) : Infinity;
    if (s0 < 0.5 || s1 < 0.5) out.push(warn(STYLE_RULES.kbEase, "motion.kbEase", `end slopes ${s0.toFixed(2)} / ${s1.toFixed(2)} < 0.5 (Ken Burns would stall at cuts)`));
  }
  if (d.motion.entryMaxFrames > 24) out.push(warn(STYLE_RULES.motionTiming, "motion.entryMaxFrames", "entries longer than 800 ms read as sluggish"));
  if (d.motion.staggerMaxFrames > 15) out.push(warn(STYLE_RULES.motionTiming, "motion.staggerMaxFrames", "total stagger longer than 500 ms"));

  // ---- captions, music, sfx, type
  const g = d.captionDNA.grouping;
  if (g.minWords > g.maxWords) out.push(err(STYLE_RULES.grouping, "captionDNA.grouping", `minWords ${g.minWords} > maxWords ${g.maxWords}`));
  if (g.minSec > g.maxSec) out.push(err(STYLE_RULES.grouping, "captionDNA.grouping", `minSec ${g.minSec} > maxSec ${g.maxSec}`));
  if (g.maxWords < 1 || g.maxChars < 1) out.push(err(STYLE_RULES.grouping, "captionDNA.grouping", "maxWords and maxChars must be ≥ 1"));
  const sg = d.captionDNA.srtGrouping;
  if (sg.minSec > sg.maxSec) out.push(err(STYLE_RULES.grouping, "captionDNA.srtGrouping", `minSec ${sg.minSec} > maxSec ${sg.maxSec}`));
  const mp = d.musicPolicy;
  if (mp.duckDb < mp.duckRangeDb[0] || mp.duckDb > mp.duckRangeDb[1]) {
    out.push(warn(STYLE_RULES.duck, "musicPolicy.duckDb", `duckDb ${mp.duckDb} is outside duckRangeDb [${mp.duckRangeDb.join(", ")}]`));
  }
  for (const [cat, r] of Object.entries(d.sfxPolicy.peakDb)) {
    if (r && r[1] > 0) out.push(warn(STYLE_RULES.peakDb, `sfxPolicy.peakDb.${cat}`, `peak target ${r[1]} dBFS is above full scale`));
  }
  for (const [k, v] of Object.entries(d.tokens.typeRamp)) {
    if (!(v > 0)) out.push(err(STYLE_RULES.typeRamp, `tokens.typeRamp.${k}`, `size ${v} must be > 0`));
  }
  const lw = d.stills.layoutWeights;
  if (lw.cover < 0 || lw.card < 0) out.push(err(STYLE_RULES.weight, "stills.layoutWeights", "layout weights must be ≥ 0"));
  else if (lw.cover + lw.card <= 0) out.push(err(STYLE_RULES.layoutWeights, "stills.layoutWeights", "cover + card weights must be > 0"));
  for (const [k, w] of Object.entries(d.budgets.salience.weights)) {
    if (w < 0) out.push(err(STYLE_RULES.weight, `budgets.salience.weights.${k}`, `weight ${w} < 0`));
  }
  if (new Set(d.visualPriority).size !== d.visualPriority.length) {
    out.push(warn(STYLE_RULES.visualPriority, "visualPriority", "visual kinds are listed more than once"));
  }

  // ---- manifest
  d.manifest.uses.forEach((u, i) => {
    if (foldKeyword(u) !== u) out.push(warn(STYLE_RULES.uses, `manifest.uses[${i}]`, `"${u}" is not accent-folded lowercase (expected "${foldKeyword(u)}")`));
  });
  return out;
}
