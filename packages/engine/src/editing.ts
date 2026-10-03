// engine.writeDoc (§4.18, §5.3, §6.3): user edits of user-editable documents. Validates, keeps history (store writer
// "user"), runs lintScript + deterministicFactChecks on script/slices PUTs, validatePick on user-picks, checkRefs, and
// enforces the fact-check resolution rules (fix-only items, notes ≥ 10 characters).
import {
  ActiveTake, BeatSlicesDoc, DocmakerError, FactCheck, Outline, P, Project, Script, UserPicksDoc, checkRefs, docEntryFor, docHash,
  type BeatPlansDoc, type ChapterScript, type FactCheckItem, type FactSheet, type Lang, type LintIssue, type PublishInfo, type ScriptSegment,
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

const normText = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

/** Every string value of a JSON-ish value (motion data), unescaped. */
function stringsIn(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringsIn);
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(stringsIn);
  return [];
}

/** The documents a fact-check location is resolved against. */
export interface FlaggedTextSources {
  script: Script | null; slices: BeatSlicesDoc | null; plans: BeatPlansDoc | null; facts: FactSheet | null; publish: PublishInfo | null;
}

/**
 * The current text at a fact-check location (null when it cannot be located): a segment's displayText (+ the clip
 * subtitle), a beat's text, on-screen text, motion-data strings and cue-derived strings (a synthetic -CLIP beat also
 * includes its clip segment), or a publish surface (title, thumbnail, description).
 */
export function flaggedTextAt(src: FlaggedTextSources, where: string): string | null {
  const segText = (id: string): string | null => {
    const s = src.script?.chapters.flatMap((c) => c.segments).find((x) => x.id === id);
    return s ? `${s.displayText} ${s.subtitleTranslation}` : null;
  };
  if (where === "title") return src.publish?.title ?? null;
  if (where === "thumbnail") return src.publish?.thumbnailText ?? null;
  if (where === "description") return src.publish?.description ?? null;
  if (/^CH\d+-S\d+$/.test(where)) return segText(where);
  const beat = /^(CH\d+-S\d+)-(?:CLIP|BR)$/.exec(where);
  if (!beat && !/^CH\d+-B\d+$/.test(where)) return null;
  const parts: string[] = [];
  if (beat) {
    const seg = segText(beat[1]!);
    if (seg !== null) parts.push(seg);
  }
  const t = src.slices?.texts.find((x) => x.beatId === where);
  if (t) parts.push(t.text, t.onScreenText, ...stringsIn(t.motionData));
  const plan = src.plans?.plans.find((p) => p.id === where);
  if (plan) {
    parts.push(...plan.cueTags.map((c) => c.value));
    for (const pid of plan.personIds) {
      const person = src.facts?.people.find((p) => p.id === pid);
      if (person) parts.push(person.roleInStory, person.name);
    }
  }
  return parts.length ? parts.join(" \n ") : null;
}

/**
 * A "rewritten" resolution holds only when the flagged text can be located and no longer contains the flagged
 * sentence. Locations that cannot be resolved, and items whose "sentence" is only a placeholder (empty, or the location
 * id itself: a quote flagged on a synthetic clip beat), never count as rewritten: re-run the fact-check instead.
 */
export function rewrittenHolds(it: Pick<FactCheckItem, "where" | "sentence">, src: FlaggedTextSources): boolean {
  const sentence = normText(it.sentence);
  if (sentence === "" || sentence === normText(it.where)) return false;
  const text = flaggedTextAt(src, it.where);
  if (text === null) return false;
  return !normText(text).includes(sentence);
}

export async function flaggedTextSources(store: ProjectStore, project: Project, lang: Lang): Promise<FlaggedTextSources> {
  const script = await docs.script(store, lang);
  return {
    script, slices: await docs.slices(store, lang), plans: await docs.plans(store), facts: await docs.factsheet(store),
    publish: effectivePublish(project, lang, script, await docs.suggestion(store)),
  };
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
      const frozen = { ...(await rt.deps.assets.readUserFrozen(store.dir)), ...((await docs.frozen(store))?.assets ?? {}) };
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
      // Portraits are identity slots (quote/social cards show them next to the person's name): AI imagery, minors and
      // non-public persons are refused whatever beat the card sits on (§7.4).
      const prevPortraits = new Set((prev?.portraits ?? []).map((p) => JSON.stringify(p)));
      for (const pt of next.portraits) {
        if (prevPortraits.has(JSON.stringify(pt))) continue;
        const asset = frozen[pt.assetId];
        if (!asset) {
          denied.push({ level: "error", rule: "REF_PICK", where: `portrait:${pt.personId}`, msg: `asset ${pt.assetId.slice(0, 12)} is not frozen in this project` });
          continue;
        }
        if (!facts) continue;
        const pick = {
          beatId: `portrait:${pt.personId}`, slot: 0, assetId: pt.assetId, role: "primary" as const, focal: { x: 0.5, y: 0.45 }, crop: null, sourceInMs: null, sourceOutMs: null,
          score: { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "" }, pickedBy: "user" as const, planKey: "0000000000000000",
        };
        const r = rt.deps.assets.validatePick({ pick, plan: null, asset, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: acks, portraitOf: pt.personId });
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
      let sources: FlaggedTextSources | null = null;
      for (const it of next.items) {
        const old = prevById.get(it.id);
        if (!old) throw new DocmakerError("VALIDATION", `unknown fact-check item ${it.id} (items come from the fact-check stage)`);
        if (old.verdict !== it.verdict || old.risk !== it.risk || old.sentence !== it.sentence || old.where !== it.where) {
          throw new DocmakerError("VALIDATION", `${it.id}: only resolution and note can be edited`);
        }
        if (it.resolution === old.resolution && it.note === old.note) continue;
        if (it.resolution === "rewritten" && old.resolution !== "rewritten") {
          sources ??= await flaggedTextSources(store, project, next.lang);
          if (flaggedTextAt(sources, it.where) === null || !rewrittenHolds(it, sources)) {
            throw new DocmakerError("VALIDATION", `${it.id}: the flagged text is still in ${it.where} (or cannot be located there) — rewrite it first, or re-run the fact-check`);
          }
        }
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
