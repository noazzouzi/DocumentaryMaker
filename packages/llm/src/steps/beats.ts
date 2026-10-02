// Steps 5 and 5s: planBeats (LLM → validate → repair → deterministic fallback) and sliceBeats (secondary languages / re-slice).
import { z } from "zod";
import {
  MotionData, beatWordRanges, tokenizeDisplay, type BeatLang, type BeatPlan, type ChapterScript, type FactSheet, type Lang,
  type LintIssue, type MotionTemplate, type StyleData, type StylePlugin,
} from "@docmaker/core";
import { resplitSegments, beatsFromWire } from "../beats/map";
import { checkMotion, copyInvariantFields } from "../beats/motion";
import { splitBeatsFallback } from "../beats/split";
import { emptyBeatLang } from "../beats/synthetic";
import { RECONSTRUCTION_RULES, isSynthetic, validateBeats } from "../beats/validate";
import { EDITORIAL_RULES } from "../prompts/rules";
import { BEATSLICE_USER, BEATS_EXTRA, BEATS_REPAIR, BEATS_USER } from "../prompts/steps";
import { buildSystem, json } from "../prompts/system";
import type { StepCtx } from "../types";
import { normBeatId } from "../wire/ids";
import { resolveAnchors, resolveEmphasis, factSheetToWire } from "../wire/map";
import { BeatSliceWire, ChapterBeatsWire } from "../wire/schemas";
import { chapterToWire } from "./write";
import { call, tryRepair } from "./common";

/** Compact description of every motion_data_json format, generated from the core MotionData schemas. */
export function motionFormats(): string {
  const describe = (schema: z.ZodType): string => {
    const def = (schema as unknown as { def: { type: string; innerType?: z.ZodType; element?: z.ZodType; shape?: Record<string, z.ZodType>; items?: z.ZodType[] } }).def;
    switch (def.type) {
      case "default":
      case "optional":
      case "nullable":
        return describe(def.innerType!);
      case "array":
        return `[${describe(def.element!)}]`;
      case "tuple":
        return `[${(def.items ?? []).map(describe).join(",")}]`;
      case "object":
        return `{${Object.entries(def.shape ?? {}).map(([k, v]) => {
          const opt = ["default", "optional"].includes((v as unknown as { def: { type: string } }).def.type);
          return `${k}${opt ? "?" : ""}:${describe(v)}`;
        }).join(", ")}}`;
      case "enum":
        return (schema as unknown as { options: string[] }).options.map((o) => JSON.stringify(o)).join("|");
      default:
        return def.type;
    }
  };
  return Object.entries(MotionData).map(([k, v]) => `${k} ${describe(v as z.ZodType)}`).join("\n");
}

const chapterNarrationWire = (ch: ChapterScript) => {
  const w = chapterToWire(ch) as { segments: { type: string }[] };
  return { ...w, segments: w.segments.filter((s) => s.type !== "sponsor_slot") };
};

function failingSegments(issues: LintIssue[]): Set<string> {
  return new Set(issues.filter((x) => RECONSTRUCTION_RULES.includes(x.rule) || x.rule === "V_SEGMENT").map((x) => x.where));
}

export async function planBeats(ctx: StepCtx, i: { chapter: ChapterScript; factSheet: FactSheet; style: StylePlugin; isHook: boolean; lang: Lang; startOrder: number }): Promise<{ plans: BeatPlan[]; texts: BeatLang[]; issues: LintIssue[]; method: "llm" | "fallback" }> {
  const { chapter, factSheet, style, lang } = i;
  const profile = style.data.scriptProfile;
  const system = buildSystem({
    style, lang, asOf: factSheet.asOf, riskFlags: [], factSheet,
    extra: `<visual_grammar>${style.promptPack.visualGrammar}</visual_grammar>`,
  });
  const user = BEATS_USER({ chapterScriptJson: json(chapterNarrationWire(chapter)), visualGrammar: "see <visual_grammar> in the system prompt", isHook: i.isHook })
    + BEATS_EXTRA(`\n${motionFormats()}`);
  const req = { step: "beats" as const, schema: ChapterBeatsWire, effort: "medium" as const, maxTokens: 16000, lang, system };
  const run = (w: ChapterBeatsWire) => {
    const m = beatsFromWire(w, { chapter, factSheet, lang, startOrder: i.startOrder });
    const v = validateBeats({ plans: m.plans, texts: m.texts, chapter, factSheet, style: style.data, lang, primary: true });
    return { plans: v.plans, texts: v.texts, issues: [...m.issues, ...v.issues] };
  };
  let res = run(await call(ctx, { ...req, key: chapter.chapterId, user }));
  let failing = failingSegments(res.issues);
  if (failing.size > 0) {
    ctx.logger.warn("beats failed exact reconstruction; one repair round", { chapter: chapter.chapterId, segments: [...failing] });
    const repaired = await tryRepair(() => call(ctx, { ...req, key: `${chapter.chapterId}.repair`, user: user + BEATS_REPAIR(json(res.issues.filter((x) => x.level === "error"))) }));
    if (repaired) {
      const r2 = run(repaired);
      const f2 = failingSegments(r2.issues);
      if (f2.size <= failing.size) {
        res = r2;
        failing = f2;
      }
    }
  }
  let method: "llm" | "fallback" = "llm";
  if (failing.size > 0) {
    method = "fallback";
    // segment ids of failures; chapter-level V_SEGMENT failures re-split nothing (those beats were dropped)
    const segIds = new Set([...failing].filter((w) => chapter.segments.some((s) => s.id === w)));
    const uncovered = chapter.segments.filter((s) => s.type === "narration" && !res.plans.some((p) => p.segmentId === s.id)).map((s) => s.id);
    for (const s of uncovered) segIds.add(s);
    const rs = resplitSegments(res.plans, res.texts, {
      chapter, segmentIds: segIds, lang, cps: profile.charsPerSec[lang], avgBody: profile.beatSec.avgBody, startOrder: i.startOrder,
    });
    const v = validateBeats({ plans: rs.plans, texts: rs.texts, chapter, factSheet, style: style.data, lang, primary: true });
    const notes: LintIssue[] = [...segIds].map((s) => ({ level: "warn", rule: "V_FALLBACK_SPLIT", where: s, msg: "beats re-split deterministically (model slices did not reconstruct the narration)" }));
    res = { plans: v.plans, texts: v.texts, issues: [...notes, ...res.issues.filter((x) => !RECONSTRUCTION_RULES.includes(x.rule) && x.rule !== "V_SEGMENT"), ...v.issues] };
  }
  return { plans: res.plans, texts: res.texts, issues: dedupeIssues(res.issues), method };
}

function dedupeIssues(xs: LintIssue[]): LintIssue[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${x.rule}|${x.where}|${x.msg}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- 5s slicing
/** Re-anchors a cue/emphasis word index from an old text to a new text by word norm; -1 when the word is gone. */
function reanchor(oldText: string, newText: string, idx: number): number {
  if (idx < 0) return -1;
  const norm = tokenizeDisplay(oldText)[idx]?.norm;
  return norm ? tokenizeDisplay(newText).findIndex((w) => w.norm === norm) : -1;
}

/**
 * Secondary language (LLM, validator, fallback) — or the primary language after a text edit (deterministic re-slice,
 * no LLM). Numeric motion fields, ids and enums of secondary languages are always copied from the primary.
 */
export async function sliceBeats(ctx: StepCtx | null, i: { plans: BeatPlan[]; primaryTexts: BeatLang[]; chapter: ChapterScript; lang: Lang; factSheet: FactSheet; mode: "llm" | "deterministic"; style?: StyleData }): Promise<{ texts: BeatLang[]; issues: LintIssue[]; method: "llm" | "fallback" }> {
  const { chapter, lang, factSheet } = i;
  const plans = i.plans.filter((p) => p.chapterId === chapter.chapterId).sort((a, b) => a.order - b.order);
  const planned = plans.filter((p) => !isSynthetic(p));
  const prim = new Map(i.primaryTexts.map((t) => [t.beatId, t]));
  const issues: LintIssue[] = [];
  const out = new Map<string, BeatLang>();
  const narration = chapter.segments.filter((s) => s.type === "narration");
  const sameLang = i.primaryTexts.length > 0 && i.primaryTexts.every((t) => t.lang === lang);

  const deterministic = (segId: string) => {
    const seg = narration.find((s) => s.id === segId)!;
    const beats = planned.filter((p) => p.segmentId === segId);
    if (beats.length === 0) return;
    const shares = beats.map((b) => Math.max(1, prim.get(b.id)?.text.length ?? 1));
    const slices = splitBeatsFallback(seg.displayText, shares);
    if (slices.length < beats.length) {
      issues.push({ level: "error", rule: "SLICE_REPLAN", where: segId, msg: `${slices.length} words/slices for ${beats.length} beats: re-plan the beats of this chapter` });
    }
    beats.forEach((b, k) => {
      const p = prim.get(b.id);
      const text = slices[k] ?? "";
      out.set(b.id, {
        beatId: b.id, lang, text, onScreenText: p?.onScreenText ?? "",
        cueAnchorIdx: b.cueTags.map((_, ci) => (sameLang && p ? reanchor(p.text, text, p.cueAnchorIdx[ci] ?? -1) : -1)),
        emphasisIdx: sameLang && p ? [...new Set(p.emphasisIdx.map((e) => reanchor(p.text, text, e)).filter((e) => e >= 0))] : [],
        motionData: p?.motionData ?? {},
      });
    });
  };

  let method: "llm" | "fallback" = "llm";
  const segsToFallback = new Set<string>();
  if (i.mode === "deterministic" || !ctx) {
    method = "fallback";
    for (const s of narration) segsToFallback.add(s.id);
  } else {
    const wire = await call(ctx, {
      step: "beatslice", key: `${lang}.${chapter.chapterId}`, schema: BeatSliceWire, effort: "low", maxTokens: 8000, lang,
      system: [
        { text: `You are the bilingual story editor of a documentary YouTube channel; you cut ${lang === "fr" ? "French" : "English"} narration into the shot plan.\n${EDITORIAL_RULES(lang, factSheet.asOf)}`, cache: false },
        { text: `<fact_sheet>${json(factSheetToWire(factSheet))}</fact_sheet>`, cache: true },
      ],
      user: BEATSLICE_USER({
        beatsJson: json(planned.map((p) => ({ id: p.id, segment_id: p.segmentId, primary_text: prim.get(p.id)?.text ?? "", on_screen_text: prim.get(p.id)?.onScreenText ?? "", motion_template: p.motionTemplate, motion_data_json: JSON.stringify(prim.get(p.id)?.motionData ?? {}), cue_tags: p.cueTags }))),
        segmentsJson: json(Object.fromEntries(narration.map((s) => [s.id, s.displayText]))),
        lang,
      }),
    });
    const byId = new Map<string, BeatSliceWire["beats"][number]>();
    for (const b of wire.beats) {
      const id = normBeatId(b.id);
      if (id && !byId.has(id)) byId.set(id, b);
    }
    for (const seg of narration) {
      const beats = planned.filter((p) => p.segmentId === seg.id);
      if (beats.length === 0) continue;
      const ws = beats.map((b) => byId.get(b.id));
      if (ws.some((w) => !w)) {
        segsToFallback.add(seg.id);
        continue;
      }
      try {
        beatWordRanges(seg.displayText, ws.map((w) => w!.text.trim()));
      } catch {
        segsToFallback.add(seg.id);
        continue;
      }
      beats.forEach((b, k) => {
        const w = ws[k]!;
        const p = prim.get(b.id);
        const text = w.text.trim();
        const anchors = resolveAnchors(text, w.cue_anchor_words, b.id);
        issues.push(...anchors.issues);
        let motionData: Record<string, unknown> = {};
        if (b.motionTemplate !== "none") {
          let parsed: Record<string, unknown> = {};
          try {
            const v: unknown = w.motion_data_json.trim() ? JSON.parse(w.motion_data_json) : {};
            if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
          } catch {
            /* invalid JSON → primary copy below */
          }
          motionData = copyInvariantFields(p?.motionData ?? {}, parsed) as Record<string, unknown>;
          if (!checkMotion(b.motionTemplate as MotionTemplate, motionData, factSheet, { primary: false }).ok) {
            issues.push({ level: "warn", rule: "V_MOTION_SECONDARY", where: b.id, msg: `${lang} motion data invalid; copied from the primary language` });
            motionData = p?.motionData ?? {};
          }
        }
        const onScreen = w.on_screen_text.trim();
        out.set(b.id, {
          beatId: b.id, lang, text, onScreenText: onScreen === "" && p?.onScreenText ? p.onScreenText : onScreen,
          cueAnchorIdx: b.cueTags.map((_, ci) => anchors.idx[ci] ?? -1), emphasisIdx: resolveEmphasis(text, w.emphasis_words), motionData,
        });
      });
    }
    if (segsToFallback.size > 0) {
      method = "fallback";
      issues.push(...[...segsToFallback].map((s): LintIssue => ({ level: "warn", rule: "V_FALLBACK_SPLIT", where: s, msg: `${lang} slices did not reconstruct the segment; split deterministically` })));
    }
  }
  for (const s of segsToFallback) deterministic(s);
  const texts: BeatLang[] = plans.map((p) => (isSynthetic(p) ? emptyBeatLang(p.id, lang, p.cueTags.length) : out.get(p.id) ?? { ...emptyBeatLang(p.id, lang, p.cueTags.length) }));
  const v = validateBeats({ plans, texts, chapter, factSheet, style: i.style ?? NO_DURATION_STYLE, lang, primary: false });
  return { texts: v.texts, issues: dedupeIssues([...issues, ...v.issues]), method };
}

/** Without a style, validateBeats only needs beat bounds: unbounded durations (no V_DURATION warnings). */
const NO_DURATION_STYLE = {
  scriptProfile: { charsPerSec: { en: 16.5, fr: 16.0 }, beatSec: { hook: [0, Number.MAX_VALUE], body: [0, Number.MAX_VALUE], avgBody: 3.2 } },
} as unknown as StyleData;
