// validateBeats (§6.3 step 5): exact reconstruction, durations, AI+person rewrite, motion data + fact refs (downgrades),
// cue anchors, cue budgets and bleep placement. Pure: returns corrected copies of plans and texts.
import {
  beatWordRanges, tokenizeDisplay, type BeatLang, type BeatPlan, type ChapterScript, type FactSheet, type Lang, type LintIssue,
  type StyleData,
} from "@docmaker/core";
import { checkMotion, kineticFrom } from "./motion";
import { computePlanKey } from "./synthetic";
import { mentionsPerson } from "../text";

const issue = (level: LintIssue["level"], rule: string, where: string, msg: string): LintIssue => ({ level, rule, where, msg });
export const isSynthetic = (p: Pick<BeatPlan, "origin" | "id">) => p.origin === "clip" || p.origin === "breath" || /-(CLIP|BR)$/.test(p.id);

/** Rules whose presence means the chapter's slices must be re-planned or re-split. */
export const RECONSTRUCTION_RULES: readonly string[] = ["V_RECONSTRUCT", "V_NO_BEATS", "V_TEXT_MISSING"];

/** true when the character at `offset` of `text` lies inside a quoted passage (« », “ ”, ‘ ’ or straight quotes). */
export function insideQuote(text: string, offset: number): boolean {
  let depth = 0;
  let straight = false;
  for (let i = 0; i < offset && i < text.length; i++) {
    const c = text[i]!;
    if (c === "«" || c === "“") depth++;
    else if ((c === "»" || c === "”") && depth > 0) depth--;
    else if (c === '"') straight = !straight;
  }
  return depth > 0 || straight;
}

export interface ValidateBeatsInput {
  plans: BeatPlan[]; texts: BeatLang[]; chapter: ChapterScript; factSheet: FactSheet; style: StyleData; lang: Lang; primary: boolean;
}

export function validateBeats(i: ValidateBeatsInput): { issues: LintIssue[]; plans: BeatPlan[]; texts: BeatLang[] } {
  const { chapter, factSheet, style, lang } = i;
  const issues: LintIssue[] = [];
  const profile = style.scriptProfile;
  const cps = profile.charsPerSec[lang];
  const isHook = chapter.chapterId === "CH1";
  const [lo, hi] = isHook ? profile.beatSec.hook : profile.beatSec.body;
  const plans = i.plans.map((p) => ({ ...p, cueTags: p.cueTags.map((c) => ({ ...c })) }));
  const texts = i.texts.map((t) => ({ ...t, cueAnchorIdx: [...t.cueAnchorIdx], emphasisIdx: [...t.emphasisIdx], motionData: { ...t.motionData } }));
  const textIdx = new Map<string, number>();
  texts.forEach((t, k) => {
    if (t.lang === lang) textIdx.set(t.beatId, k);
  });
  const segById = new Map(chapter.segments.map((s) => [s.id, s]));
  const chapterPlanIdx = plans.map((p, k) => ({ p, k })).filter(({ p }) => p.chapterId === chapter.chapterId);
  const planned = chapterPlanIdx.filter(({ p }) => !isSynthetic(p));

  // ---- segment coverage and exact reconstruction
  const segStart = new Map<string, Map<string, number>>(); // segmentId → beatId → wordStart in the segment
  for (const seg of chapter.segments) {
    if (seg.type !== "narration") continue;
    const segBeats = planned.filter(({ p }) => p.segmentId === seg.id);
    if (segBeats.length === 0) {
      if (seg.displayText.trim() !== "") issues.push(issue("error", "V_NO_BEATS", seg.id, "narration segment has no beats"));
      continue;
    }
    const slices = segBeats.map(({ p }) => texts[textIdx.get(p.id) ?? -1]?.text ?? "");
    try {
      const ranges = beatWordRanges(seg.displayText, slices);
      segStart.set(seg.id, new Map(segBeats.map(({ p }, k) => [p.id, ranges[k]!.wordStart])));
    } catch (e) {
      issues.push(issue("error", "V_RECONSTRUCT", seg.id, `beats do not reconstruct the narration exactly (${(e as Error).message})`));
    }
  }

  let run = 0;
  let prevVisual = "";
  let reveal = 0;
  let shock = 0;
  let emphasis = 0;
  for (const { p, k } of planned) {
    const seg = segById.get(p.segmentId);
    if (!seg || seg.type !== "narration") {
      issues.push(issue("error", "V_SEGMENT", p.id, `beat references ${p.segmentId}, which is not a narration segment of ${chapter.chapterId}`));
      continue;
    }
    const ti = textIdx.get(p.id);
    if (ti === undefined) {
      issues.push(issue("error", "V_TEXT_MISSING", p.id, `no ${lang} text for this beat`));
      continue;
    }
    const t = texts[ti]!;
    const words = tokenizeDisplay(t.text);
    // duration (text-based estimate in this language)
    const est = t.text.length / cps;
    if (words.length > 0 && (est < lo - 1e-9 || est > hi + 1e-9)) {
      issues.push(issue("warn", "V_DURATION", p.id, `≈ ${est.toFixed(1)} s outside ${lo}–${hi} s${isHook ? " (hook pace)" : ""}`));
    }
    // same visual run (primary only: plans are shared)
    if (i.primary) {
      const v = `${p.visualKind}|${p.visualQuery}`;
      run = v === prevVisual ? run + 1 : 0;
      prevVisual = v;
      if (run === 3) issues.push(issue("warn", "V_SAME_VISUAL", p.id, "4+ consecutive beats on the same visual — add a pattern interrupt"));
    }
    let plan = p;
    // a person beat is not only what the model tagged: a fact-sheet person named in the beat text, on screen or in the
    // visual query is added to personIds (feeds the AI-image rewrite below and the assets fal refusal)
    if (i.primary) {
      const named = factSheet.people
        .filter((x) => !plan.personIds.includes(x.id) && [t.text, t.onScreenText, plan.visualQuery].some((s) => s.trim() !== "" && mentionsPerson(s, x)))
        .map((x) => x.id);
      if (named.length > 0) {
        issues.push(issue("warn", "V_PERSON_INFERRED", p.id, `names ${named.join(", ")} but person_ids omitted them; added`));
        plan = { ...plan, personIds: [...plan.personIds, ...named] };
      }
    }
    // no photorealistic AI depiction of real people → motion graphic / text card
    if (i.primary && plan.visualKind === "ai_illustration" && plan.personIds.length > 0) {
      issues.push(issue("error", "V_AI_PERSON", p.id, "AI illustration of a real person is not allowed; rewritten to a graphic"));
      const template = plan.motionTemplate === "none" ? "kinetic_text" : plan.motionTemplate;
      plan = { ...plan, visualKind: template === "kinetic_text" ? "text_card" : "motion_graphic", motionTemplate: template };
      if (template === "kinetic_text" && plan.motionTemplate !== p.motionTemplate) t.motionData = kineticFrom(t.onScreenText, t.text);
    }
    // motion data + fact refs
    if (plan.motionTemplate !== "none") {
      const m = checkMotion(plan.motionTemplate, t.motionData, factSheet, { primary: i.primary });
      if (m.ok) {
        t.motionData = m.data;
      } else if (i.primary) {
        issues.push(issue("warn", "V_MOTION_DOWNGRADE", p.id, `${plan.motionTemplate} downgraded to kinetic_text: ${m.problems.join("; ")}`));
        plan = { ...plan, motionTemplate: "kinetic_text", quoteId: null };
        t.motionData = kineticFrom(t.onScreenText, t.text);
      } else {
        issues.push(issue("warn", "V_MOTION_SECONDARY", p.id, `${lang} motion data invalid: ${m.problems.join("; ")}`));
      }
    } else if (Object.keys(t.motionData).length > 0) {
      t.motionData = {};
    }
    // cue anchors parallel to cue tags
    if (t.cueAnchorIdx.length !== plan.cueTags.length) {
      issues.push(issue("warn", "CUE_ANCHOR", p.id, `cue anchors (${t.cueAnchorIdx.length}) ≠ cue tags (${plan.cueTags.length}); padded with beat start`));
      t.cueAnchorIdx = plan.cueTags.map((_, c) => t.cueAnchorIdx[c] ?? -1);
    }
    t.cueAnchorIdx = t.cueAnchorIdx.map((a) => {
      if (a >= words.length) {
        issues.push(issue("warn", "CUE_ANCHOR", p.id, `cue anchor ${a} outside the beat text`));
        return -1;
      }
      return a;
    });
    t.emphasisIdx = [...new Set(t.emphasisIdx.filter((e) => e >= 0 && e < words.length))].slice(0, 3);
    // bleeps only inside quoted passages
    const segWords = tokenizeDisplay(seg.displayText);
    const start = segStart.get(seg.id)?.get(p.id);
    plan.cueTags.forEach((c, ci) => {
      if (c.type !== "SENSITIVE" || c.value !== "bleep") return;
      const a = t.cueAnchorIdx[ci] ?? -1;
      const w = start !== undefined && a >= 0 ? segWords[start + a] : undefined;
      if (!w || !insideQuote(seg.displayText, w.start)) {
        issues.push(issue("warn", "V_BLEEP_OUTSIDE_QUOTE", p.id, "a bleep must land on a word inside a quoted passage; bleep removed"));
        plan = { ...plan, cueTags: plan.cueTags.map((x, xi) => (xi === ci ? { ...x, value: "" } : x)) };
      }
    });
    if (plan.cueTags.some((c) => c.type === "REVEAL")) reveal++;
    if (plan.cueTags.some((c) => c.type === "SHOCK")) shock++;
    if (plan.cueTags.some((c) => c.type === "EMPHASIS")) emphasis++;
    if (plan !== p) plans[k] = { ...plan, planKey: computePlanKey(plan) };
  }
  if (reveal > 1) issues.push(issue("warn", "V_CUE_BUDGET", chapter.chapterId, `${reveal} REVEAL cues (max 1 per chapter)`));
  if (shock > 1) issues.push(issue("warn", "V_CUE_BUDGET", chapter.chapterId, `${shock} SHOCK cues (max 1 per chapter)`));
  if (planned.length > 0 && emphasis > Math.ceil(planned.length / 3)) {
    issues.push(issue("warn", "V_CUE_BUDGET", chapter.chapterId, `EMPHASIS on ${emphasis} of ${planned.length} beats (max 1 in 3)`));
  }
  return { issues, plans, texts };
}
