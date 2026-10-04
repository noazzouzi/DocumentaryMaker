// Autopilot (project.editorial.autopilot): the runner approves every editorial gate itself (by "autopilot"); this module
// settles, between pipeline runs, what no approval can: fact-check items that can only be fixed (a quote not found on its
// source page, a quote that is not verbatim). Narration and clip segments are rewritten by the chapter revision step as
// an attributed paraphrase; an on-screen quote card is re-planned with its chapter's beats (JobOptions.replanChapters).
import { P, Script, type ChapterScript, type FactCheckItem, type Lang, type LintIssue, type Project } from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { Runtime } from "./runtime";
import { ProjectCosts } from "./costs";
import { docs } from "./docs";
import { writeUserDoc } from "./editing";
import { factcheckGateState, fixOnly } from "./gates";
import { riskFlagsOf, styleFor } from "./runner";
import { cpsOf } from "./stages/outline";
import { fillTtsText } from "./stages/script";
import { orderLangs } from "./util";

export interface AutopilotFixes {
  /** What was done (one line each); empty when there was nothing to fix. */
  actions: string[];
  /** Chapters whose beats the next run must re-plan (an on-screen quote card could only be fixed that way). */
  replanChapters: string[];
}

/** A fact-check item's segment (a synthetic -CLIP/-BR beat belongs to its segment); null for other locations. */
export function segmentOf(where: string): string | null {
  return /^(CH\d+-S\d+)(?:-(?:CLIP|BR))?$/.exec(where)?.[1] ?? null;
}

/** The revision issue for a fix-only item on a segment. */
export function fixIssue(it: FactCheckItem, segmentId: string): LintIssue {
  const why = it.verdict === "quote_mismatch" ? "is not the verbatim wording of its source" : "could not be found on its source page";
  return {
    level: "error", rule: "FACTCHECK_FIX_ONLY", where: segmentId,
    msg: `${it.problem}. The quote ${it.factIds.join(", ") || "in this segment"} ${why}: rewrite segment ${segmentId} as a narration segment (type narration, `
      + `empty quote_id) that reports it with attribution ("selon …", "d'après …"), without quotation marks${it.suggestedRewrite ? `. Suggestion: ${it.suggestedRewrite}` : ""}.`,
  };
}

/** Fixes the open fix-only items of every up-to-date fact-check (a stale fact-check simply re-runs next time). */
export async function autopilotFixes(rt: Runtime, store: ProjectStore, project: Project, signal: AbortSignal): Promise<AutopilotFixes> {
  const out: AutopilotFixes = { actions: [], replanChapters: [] };
  for (const lang of orderLangs(project, [])) {
    const st = await factcheckGateState(store, project, lang);
    if (st.missing || st.stale) continue;
    const fixes = st.gating.filter((i) => fixOnly(i) && i.resolution !== "rewritten");
    if (fixes.length === 0) continue;
    const bySegment = new Map<string, FactCheckItem[]>();
    for (const it of fixes) {
      const seg = segmentOf(it.where);
      if (seg) bySegment.set(seg, [...(bySegment.get(seg) ?? []), it]);
      else {
        const ch = /^(CH\d+)-/.exec(it.where)?.[1];
        if (ch && !out.replanChapters.includes(ch)) {
          out.replanChapters.push(ch);
          out.actions.push(`${lang} ${ch}: beats re-planned (${it.where}: ${it.verdict})`);
        }
      }
    }
    if (bySegment.size) out.actions.push(...(await reviseSegments(rt, store, project, lang, bySegment, signal)));
  }
  return out;
}

/** One chapter revision per chapter holding flagged segments; the chapters are written as user edits. */
async function reviseSegments(rt: Runtime, store: ProjectStore, project: Project, lang: Lang, bySegment: ReadonlyMap<string, FactCheckItem[]>, signal: AbortSignal): Promise<string[]> {
  const deps = rt.deps;
  const outline = await docs.outline(store);
  const facts = await docs.factsheet(store);
  const script = await docs.script(store, lang);
  if (!outline || !facts || !script) return [];
  const primary = lang === project.primaryLang ? null : await docs.script(store, project.primaryLang);
  const style = await styleFor(rt, project, store);
  const riskFlags = (await riskFlagsOf(rt, store, project)).filter((f) => f !== "none");
  const costs = await ProjectCosts.open(store, project, null, () => {});
  const sctx = { llm: rt.llmFor(project), signal, costs, logger: rt.logger, progress: () => {}, newRequest: false };
  const cps = cpsOf(project, style, lang);
  const actions: string[] = [];
  const chapters: ChapterScript[] = [];
  for (const [k, ch] of script.chapters.entries()) {
    const segs = ch.segments.filter((s) => bySegment.has(s.id));
    const plan = outline.chapters.find((c) => c.id === ch.chapterId);
    if (segs.length === 0 || !plan) {
      chapters.push(ch);
      continue;
    }
    const issues = segs.flatMap((s) => bySegment.get(s.id)!.map((it) => fixIssue(it, s.id)));
    const primaryCh = primary?.chapters.find((c) => c.chapterId === ch.chapterId) ?? null;
    const prev = script.chapters[k - 1];
    const revised = await deps.llm.reviseChapter(sctx, {
      lang, primaryLang: project.primaryLang, outline, plan, factSheet: facts, style, riskFlags,
      storySoFar: script.chapters.slice(0, k).map((c) => c.summaryForNext), previousTail: prev ? prev.segments.filter((s) => s.type === "narration").slice(-2).map((s) => s.displayText) : [],
      skeleton: primaryCh ? deps.llm.segmentSkeleton(primaryCh) : null,
      targetWords: primaryCh ? Math.max(1, Math.round((plan.targetSec * cps) / style.data.scriptProfile.avgCharsPerWord[lang])) : plan.targetWords,
      chapter: ch, issues,
    });
    chapters.push({ ...revised, userEdited: true, segments: revised.segments.map((s) => fillTtsText(deps, project, lang, s)) });
    actions.push(`${lang} ${ch.chapterId}: rewrote ${segs.map((s) => s.id).join(", ")} as attributed narration (${[...new Set(segs.flatMap((s) => bySegment.get(s.id)!.map((i) => i.verdict)))].join(", ")})`);
  }
  if (actions.length) await writeUserDoc(rt, store, P.script(lang), Script, { ...script, chapters }, await store.etag(P.script(lang)));
  return actions;
}
