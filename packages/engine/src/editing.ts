// engine.writeDoc (§4.18, §5.3, §6.3): user edits of user-editable documents. Validates, keeps history (store writer
// "user"), runs lintScript + deterministicFactChecks on script/slices PUTs, validatePick on user-picks, checkRefs, and
// enforces the fact-check resolution rules (fix-only items, notes ≥ 10 characters).
import {
  ActiveTake, BeatSlicesDoc, DocmakerError, FactCheck, Outline, P, Project, Script, UserPicksDoc, checkRefs, docEntryFor, docHash,
  type ChapterScript, type FactCheckItem, type Lang, type LintIssue, type ScriptSegment,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { z } from "zod";
import type { Runtime } from "./runtime";
import { docs } from "./docs";
import { fixOnly, NOTE_MIN, personAcksOf } from "./gates";
import { loadDocSet, newRefErrors, riskFlagsOf, styleFor } from "./runner";
import { fillTtsText } from "./stages/script";
import { cpsOf } from "./stages/outline";
import { effectivePublish } from "./docs";
import { projectStarted } from "./project";
import { nowIso } from "./util";

const langOf = (rel: string): Lang | null => (/(?:^|\/)(en|fr)(?:[./]|$)/.exec(rel)?.[1] as Lang | undefined) ?? null;
const chapterKey = (c: ChapterScript) => docHash({ ...c, userEdited: false, locked: false });

/** Fact-check items as editor issues (high → error, medium/low → warn; risk "none" is not an issue). */
export function factIssues(items: readonly FactCheckItem[]): LintIssue[] {
  return items.filter((i) => i.risk !== "none").map((i) => ({
    level: i.risk === "high" ? ("error" as const) : ("warn" as const),
    rule: `FACTCHECK_${i.verdict.toUpperCase()}${i.rule ? `_${i.rule}` : ""}`, where: i.where, msg: `${i.problem}${i.suggestedRewrite ? ` — suggestion: ${i.suggestedRewrite}` : ""}`,
  }));
}

/** User script edit: userEdited per changed chapter, ttsText rebuilt for changed narration (unless ttsTextEdited). */
export function prepareScriptEdit(rt: Runtime, project: Project, next: Script, prev: Script | null): Script {
  const prevCh = new Map((prev?.chapters ?? []).map((c) => [c.chapterId, c]));
  const chapters = next.chapters.map((ch) => {
    const old = prevCh.get(ch.chapterId);
    const oldSeg = new Map((old?.segments ?? []).map((s) => [s.id, s]));
    const segments = ch.segments.map((s): ScriptSegment => {
      const o = oldSeg.get(s.id);
      // a hand-edited ttsText with an unchanged displayText marks the segment ttsTextEdited
      const ttsTextEdited = s.ttsTextEdited || (!!o && s.type === "narration" && s.ttsText !== o.ttsText && s.displayText === o.displayText && s.ttsText !== "");
      const seg = { ...s, ttsTextEdited };
      if (seg.type === "narration" && !ttsTextEdited && (!o || o.displayText !== s.displayText || s.ttsText === "")) return fillTtsText(rt.deps, project, next.lang, seg);
      return seg;
    });
    const changed = !old || chapterKey({ ...ch, segments }) !== chapterKey(old);
    return { ...ch, segments, userEdited: ch.userEdited || changed };
  });
  return { ...next, chapters, generatedBy: next.generatedBy, updatedAt: nowIso() };
}

export async function writeUserDoc<S extends z.ZodType>(
  rt: Runtime, store: ProjectStore, rel: string, schema: S, value: z.input<S>, etag: string | null,
): Promise<{ etag: string; issues: LintIssue[] }> {
  const entry = docEntryFor(rel);
  if (!entry || !entry.userEditable) throw new DocmakerError("VALIDATION", `${rel} is not a user-editable document`);
  const parsedIn = schema.safeParse(value);
  if (!parsedIn.success) throw new DocmakerError("VALIDATION", `${rel}: invalid document`, { details: parsedIn.error.issues });
  const reg = entry.schema.safeParse(parsedIn.data);
  if (!reg.success) throw new DocmakerError("VALIDATION", `${rel}: invalid ${entry.kind} document`, { details: reg.error.issues });
  let doc: unknown = reg.data;
  const project = await store.readJson(P.project, Project);
  const issues: LintIssue[] = [];
  const lang = langOf(rel);

  switch (entry.kind) {
    case "project": {
      const p = doc as Project;
      if (p.slug !== project.slug) throw new DocmakerError("VALIDATION", "the slug of a project cannot change");
      if (await projectStarted(store)) {
        for (const k of ["languages", "primaryLang", "video", "seed"] as const) {
          if (JSON.stringify(p[k]) !== JSON.stringify(project[k])) throw new DocmakerError("VALIDATION", `${k} cannot change once the pipeline has produced output`);
        }
      }
      doc = { ...p, createdAt: project.createdAt, updatedAt: nowIso() };
      break;
    }
    case "script": {
      const next = doc as Script;
      if (lang && next.lang !== lang) throw new DocmakerError("VALIDATION", `${rel} must hold the ${lang} script`);
      const prev = await docs.script(store, next.lang);
      const script = prepareScriptEdit(rt, project, next, prev);
      const outline = await docs.outline(store);
      const facts = await docs.factsheet(store);
      if (outline && facts) {
        const style = await styleFor(rt, project, store);
        const primary = next.lang !== project.primaryLang ? await docs.script(store, project.primaryLang) : null;
        script.lint = rt.deps.llm.lintScript({ lang: next.lang, profile: style.data.scriptProfile, outline, chapters: script.chapters, facts, cps: cpsOf(project, style, next.lang), primary: primary?.chapters });
        issues.push(...script.lint);
        const slices = await docs.slices(store, next.lang);
        const plans = await docs.plans(store);
        if (slices && plans) {
          const sugg = await docs.suggestion(store);
          issues.push(...factIssues(rt.deps.llm.deterministicFactChecks({
            script, slices, plans, factSheet: facts, publish: effectivePublish(project, next.lang, script, sugg), riskFlags: await riskFlagsOf(rt, store, project),
            personAcks: personAcksOf(await docs.approvals(store)),
          })));
        }
      }
      doc = script;
      break;
    }
    case "beatSlices": {
      const next = doc as BeatSlicesDoc;
      const script = await docs.script(store, next.lang);
      const plans = await docs.plans(store);
      const facts = await docs.factsheet(store);
      if (script && plans && facts) {
        const sugg = await docs.suggestion(store);
        issues.push(...factIssues(rt.deps.llm.deterministicFactChecks({
          script, slices: next, plans, factSheet: facts, publish: effectivePublish(project, next.lang, script, sugg), riskFlags: await riskFlagsOf(rt, store, project),
          personAcks: personAcksOf(await docs.approvals(store)),
        })));
      }
      doc = { ...next, updatedAt: nowIso() };
      break;
    }
    case "userPicks": {
      const next = doc as UserPicksDoc;
      const prev = await docs.userPicks(store);
      const prevKey = new Set((prev?.picks ?? []).map((p) => JSON.stringify(p)));
      const frozen = (await docs.frozen(store))?.assets ?? {};
      const plans = await docs.plans(store);
      const facts = await docs.factsheet(store);
      const acks = personAcksOf(await docs.approvals(store));
      const denied: LintIssue[] = [];
      for (const pick of next.picks) {
        if (prevKey.has(JSON.stringify(pick))) continue;
        const asset = frozen[pick.assetId];
        if (!asset) {
          denied.push({ level: "error", rule: "REF_PICK", where: `${pick.beatId}#${pick.slot}`, msg: `asset ${pick.assetId.slice(0, 12)} is not frozen in this project` });
          continue;
        }
        if (!facts) continue;
        const plan = plans?.plans.find((p) => p.id === pick.beatId) ?? null;
        const r = rt.deps.assets.validatePick({ pick, plan, asset, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: acks });
        issues.push(...r.filter((x) => x.level !== "error"));
        denied.push(...r.filter((x) => x.level === "error"));
      }
      if (denied.length) throw new DocmakerError("POLICY_DENIED", `${denied.length} pick(s) refused: ${denied.map((d) => `${d.where} ${d.msg}`).join("; ")}`, { details: denied });
      break;
    }
    case "outline": {
      const next = doc as Outline;
      const prev = await docs.outline(store);
      // editing the thesis counts as confirming it (§5.4)
      if (prev && next.thesis.trim() !== prev.thesis.trim()) doc = { ...next, thesisConfirmed: true, generatedBy: next.generatedBy, updatedAt: nowIso() };
      else doc = { ...next, updatedAt: nowIso() };
      break;
    }
    case "factcheck": {
      const next = doc as FactCheck;
      const prev = await docs.factcheck(store, next.lang);
      const prevById = new Map((prev?.items ?? []).map((i) => [i.id, i]));
      for (const it of next.items) {
        const old = prevById.get(it.id);
        if (!old) throw new DocmakerError("VALIDATION", `unknown fact-check item ${it.id} (items come from the fact-check stage)`);
        if (old.verdict !== it.verdict || old.risk !== it.risk || old.sentence !== it.sentence || old.where !== it.where) {
          throw new DocmakerError("VALIDATION", `${it.id}: only resolution and note can be edited`);
        }
        if (it.resolution === old.resolution && it.note === old.note) continue;
        if ((it.resolution === "acknowledged" || it.resolution === "dismissed") && fixOnly(it)) {
          throw new DocmakerError("VALIDATION", `${it.id} (${it.verdict}) can only be fixed: rewrite the text, then re-run the fact-check`);
        }
        if ((it.resolution === "acknowledged" || it.resolution === "dismissed") && it.risk !== "none" && it.risk !== "low" && it.note.trim().length < NOTE_MIN) {
          throw new DocmakerError("VALIDATION", `${it.id}: a note of at least ${NOTE_MIN} characters is required`);
        }
      }
      if (prev && next.items.length !== prev.items.length) throw new DocmakerError("VALIDATION", "fact-check items cannot be added or removed by hand");
      break;
    }
    case "activeTake": {
      const next = doc as ActiveTake;
      if (!(await store.exists(P.take(next.lang, next.takeId)))) throw new DocmakerError("VALIDATION", `take ${next.takeId} does not exist`);
      doc = { ...next, setAt: nowIso() };
      break;
    }
    default:
      break;
  }

  // integrity: the edit must not introduce broken references
  const before = checkRefs(await loadDocSet(store, project, lang, "direct"));
  const set = await loadDocSet(store, project, lang, "direct");
  switch (entry.kind) {
    case "script": set.scripts = { ...set.scripts, [(doc as Script).lang]: doc as Script }; break;
    case "beatSlices": set.slices = { ...set.slices, [(doc as BeatSlicesDoc).lang]: doc as BeatSlicesDoc }; break;
    case "beatPlans": set.plans = doc as typeof set.plans; break;
    case "userPicks": set.userPicks = doc as UserPicksDoc; break;
    case "factsheet": set.factSheet = doc as typeof set.factSheet; break;
    case "overrides": set.overrides = doc as typeof set.overrides; break;
    case "project": set.project = doc as Project; break;
    default: break;
  }
  const after = checkRefs(set);
  const added = newRefErrors(before, after);
  if (added.length) throw new DocmakerError("VALIDATION", `the edit breaks ${added.length} reference(s): ${added.slice(0, 5).map((i) => `${i.rule}@${i.where}`).join(", ")}`, { details: added });
  issues.push(...after.filter((i) => i.level === "warn" && entry.kind === "overrides"));

  const r = await store.writeJson(rel, entry.schema, doc as never, { writer: "user", ifMatch: etag });
  return { etag: r.etag, issues };
}
