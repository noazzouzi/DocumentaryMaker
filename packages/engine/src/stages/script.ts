// script[lang] (§6.3 step 4, App. D): per chapter writeChapter (cached) → engine fills ttsText → lintScript → ≤ N revisions;
// secondary languages receive the primary skeleton; parity is a hard invariant (1 repair, else LANG_PARITY).
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DocmakerError, P, Script, docHash, hashJson, spokenText, validateLangParity, type ChapterScript, type Lang, type LintIssue, type Project,
  type ScriptSegment, type VoiceProviderId,
} from "@docmaker/core";
import type { StageDef, StageCtx } from "../types";
import type { EngineDeps } from "../deps";
import { docs, need } from "../docs";
import { outlineGate } from "../gates";
import { writeTextIfChanged } from "../util";
import { X, emitLog, llmBilled, needLang, skeletonOf, stepCtx, writeDoc } from "./common";
import { cpsOf } from "./outline";

const CROSS_CHAPTER_RULES = new Set(["loop-unpaid", "loop-order", "teaser-unpaid", "clip-share"]);

/** ttsText options per provider (voice ISSUES #4): synthetic expands numbers itself; v3/v4 ElevenLabs keep [tags]. */
export function ttsOptions(project: Project, lang: Lang): { expandNumbers: boolean; stripTags: boolean } {
  const v = project.voice[lang];
  const provider: VoiceProviderId = v?.provider ?? "synthetic";
  const expandNumbers = provider === "synthetic" || provider === "recording";
  const tagged = provider === "elevenlabs" && (v?.modelId === "eleven_v3" || v?.modelId === "eleven_v4");
  return { expandNumbers, stripTags: !tagged };
}

/** Fills ttsText for narration segments that the user did not hand-edit (§8.2: only the engine calls buildTtsText). */
export function fillTtsText(deps: EngineDeps, project: Project, lang: Lang, seg: ScriptSegment): ScriptSegment {
  if (seg.type !== "narration") return seg.ttsTextEdited ? seg : { ...seg, ttsText: "" };
  if (seg.ttsTextEdited) return seg;
  const o = ttsOptions(project, lang);
  const r = deps.voice.buildTtsText(spokenText(seg, "vo"), lang, { lexicon: project.voice[lang]?.lexicon ?? [], expandNumbers: o.expandNumbers, stripTags: o.stripTags });
  return { ...seg, ttsText: r.ttsText };
}

export function primarySkeletonHash(script: Script | null): string | null {
  return script ? hashJson(script.chapters.map((c) => ({ id: c.chapterId, segments: skeletonOf(c) }))) : null;
}

interface ChapterCache { key: string; chapter: ChapterScript; videoTitle: string | null }

async function readCache(abs: string, key: string): Promise<ChapterCache | null> {
  try {
    const c = JSON.parse(await readFile(abs, "utf8")) as ChapterCache;
    return c.key === key ? c : null;
  } catch {
    return null;
  }
}

export const scriptStage: StageDef = {
  id: "script",
  perLang: true,
  version: 1,
  optionKeys: ["chapters", "forceOverwriteEdits"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const p = ctx.project;
    const outlineHash = await ctx.store.docHashOf(P.outline);
    return {
      outline: outlineHash, factsheet: await ctx.store.docHashOf(P.factsheet), styleHash: ctx.style.dataHash, lang, cps: cpsOf(p, ctx.style, lang),
      primarySkeleton: lang === p.primaryLang ? null : primarySkeletonHash(await docs.script(ctx.store, p.primaryLang)),
      tts: ttsOptions(p, lang), lexicon: p.voice[lang]?.lexicon ?? [],
    };
  },
  async gatesBefore(ctx) {
    const g = await outlineGate(ctx.store);
    return g ? [g] : [];
  },
  async estimate(ctx) {
    const lang = needLang(ctx);
    if (!llmBilled(ctx)) return { stage: "script", lang, lines: [], totalUsd: 0, confidence: "exact" };
    const outline = await docs.outline(ctx.store);
    const chars = outline?.budgets[lang]?.chars ?? Math.round(ctx.project.targetMinutes * 60 * cpsOf(ctx.project, ctx.style, lang) * ctx.style.data.scriptProfile.narrationShare);
    const n = outline?.chapters.length ?? 6;
    const lines = X(ctx).rt.deps.llm.estimateStepCost("chapter", { inputChars: n * 6_000, outputChars: Math.round(chars * 1.6), cachedChars: n * 25_000, lang });
    return { stage: "script", lang, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: (ctx) => [P.script(needLang(ctx))],
  async run(ctx) {
    return runScript(ctx);
  },
};

async function runScript(ctx: StageCtx): Promise<{ artifacts: string[] }> {
  const e = X(ctx);
  const lang = needLang(ctx);
  const p = ctx.project;
  const deps = e.rt.deps;
  const outline = need(await docs.outline(ctx.store), "outline/outline.json", "outline");
  const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
  const riskFlags = (await e.riskFlags()).filter((f) => f !== "none");
  const isPrimary = lang === p.primaryLang;
  const primary = isPrimary ? null : need(await docs.script(ctx.store, p.primaryLang), `script/${p.primaryLang}/script.json`, `script (${p.primaryLang})`);
  const previous = await docs.script(ctx.store, lang);
  const prevCh = new Map((previous?.chapters ?? []).map((c) => [c.chapterId, c]));
  const only = ctx.options.chapters && ctx.options.chapters.length ? new Set<string>(ctx.options.chapters) : null;
  const force = ctx.options.forceOverwriteEdits === true;
  const cps = cpsOf(p, ctx.style, lang);
  const profile = ctx.style.data.scriptProfile;
  const sctx = stepCtx(ctx);
  const factsHash = docHash(facts);

  const chapters: ChapterScript[] = [];
  let title: string | null = null;
  const story: string[] = [];
  let tail: string[] = [];
  const kept: string[] = [];
  for (const [k, plan] of outline.chapters.entries()) {
    ctx.progress(k / outline.chapters.length, `chapter ${plan.id}`);
    const prev = prevCh.get(plan.id);
    const protectedEdit = prev && (prev.userEdited || prev.locked) && !force;
    const outOfScope = only !== null && !only.has(plan.id) && prev;
    let ch: ChapterScript;
    if (protectedEdit || outOfScope) {
      ch = prev!;
      if (protectedEdit) kept.push(plan.id);
    } else {
      const primaryCh = primary?.chapters.find((c) => c.chapterId === plan.id) ?? null;
      if (!isPrimary && !primaryCh) throw new DocmakerError("UPSTREAM_MISSING", `chapter ${plan.id} is missing in the ${p.primaryLang} script`);
      const skeleton = primaryCh ? deps.llm.segmentSkeleton(primaryCh) : null;
      const input = {
        lang, primaryLang: p.primaryLang, outline, plan, factSheet: facts, style: ctx.style, storySoFar: [...story], previousTail: [...tail],
        skeleton, targetWords: isPrimary ? plan.targetWords : Math.max(1, Math.round((plan.targetSec * cps) / profile.avgCharsPerWord[lang])), riskFlags,
      };
      const key = hashJson({ plan, storySoFar: story, previousTail: tail, factsHash, style: ctx.style.dataHash, lang, skeleton, v: 1 });
      const cacheAbs = ctx.store.abs(P.chapterCache(lang, plan.id));
      const cached = ctx.options.newRequest ? null : await readCache(cacheAbs, key);
      let written: { chapter: ChapterScript; videoTitle: string | null };
      if (cached) written = { chapter: cached.chapter, videoTitle: cached.videoTitle };
      else {
        const r = await deps.llm.writeChapterWithTitle(sctx, input);
        written = { chapter: r.chapter, videoTitle: r.videoTitle };
        await mkdir(path.dirname(cacheAbs), { recursive: true });
        await writeTextIfChanged(cacheAbs, JSON.stringify({ key, chapter: r.chapter, videoTitle: r.videoTitle } satisfies ChapterCache));
      }
      ch = { ...written.chapter, userEdited: false, locked: prev?.locked ?? false };
      if (k === 0 && written.videoTitle) title = written.videoTitle;

      // lint → ≤ revisionRounds revisions (chapter-local errors only)
      const lintOf = (c: ChapterScript): LintIssue[] =>
        deps.llm.lintScript({ lang, profile, outline, chapters: [c], facts, cps, primary: primaryCh ? [primaryCh] : undefined })
          .filter((x) => x.level === "error" && !CROSS_CHAPTER_RULES.has(x.rule));
      for (let round = 0; round < profile.revisionRounds; round++) {
        const errors = lintOf(ch);
        if (errors.length === 0) break;
        try {
          ch = await deps.llm.reviseChapter(sctx, { ...input, chapter: ch, issues: errors });
        } catch (err) {
          if ((err as { code?: string }).code === "FIXTURE_MISSING") {
            emitLog(ctx, "script", "warn", `${lang} ${plan.id}: ${errors.length} lint error(s) and no recorded revision`);
            break;
          }
          throw err;
        }
      }
      // secondary: parity is a hard invariant (one repair round)
      if (primaryCh) {
        const tmp = (c: ChapterScript) => validateLangParity({ ...primary!, chapters: [primaryCh] }, { ...primary!, lang, chapters: [c] });
        let parity = tmp(ch);
        if (parity.length) {
          try {
            ch = await deps.llm.reviseChapter(sctx, { ...input, chapter: ch, issues: parity.map((x) => ({ ...x, rule: "lang-parity" })) });
            parity = tmp(ch);
          } catch (err) {
            if ((err as { code?: string }).code !== "FIXTURE_MISSING") throw err;
          }
          if (parity.length) throw new DocmakerError("LANG_PARITY", `${lang} ${plan.id}: segment skeleton differs from ${p.primaryLang}`, { details: parity });
        }
      }
    }
    ch = { ...ch, segments: ch.segments.map((s) => fillTtsText(deps, p, lang, s)) };
    chapters.push(ch);
    story.push(ch.summaryForNext);
    tail = ch.segments.filter((s) => s.type === "narration").slice(-2).map((s) => s.displayText);
  }
  if (kept.length) emitLog(ctx, "script", "info", `${lang}: kept user-edited/locked chapter(s) ${kept.join(", ")} (use --force-overwrite-edits to regenerate)`);
  const lint = deps.llm.lintScript({ lang, profile, outline, chapters, facts, cps, primary: primary?.chapters });
  const script = Script.parse({
    schemaVersion: 1, lang, outlineHash: docHash(outline), title: title ?? previous?.title ?? outline.title, chapters, lint,
    generatedBy: ctx.llm.kind === "fixture" ? "fixture" : "llm", updatedAt: new Date().toISOString(),
  });
  if (primary) {
    const parity = validateLangParity(primary, script);
    if (parity.length) throw new DocmakerError("LANG_PARITY", `${lang} script does not match the ${p.primaryLang} skeleton`, { details: parity });
  }
  await writeDoc(ctx, "script", P.script(lang), Script, script);
  return { artifacts: [P.script(lang)] };
}
