// Shared helpers for stage implementations.
import path from "node:path";
import {
  DocmakerError, docEntryFor, docHash, type BeatLang, type BeatPlan, type ChapterId, type FixtureManifest, type JobEventInput, type Lang, type Project,
  type RiskFlag, type Script, type StageId, type StylePlugin, type StyleRenderTokens,
} from "@docmaker/core";
import type { z } from "zod";
import type { AssetsCtx } from "@docmaker/assets";
import type { AudioCtx } from "@docmaker/audio";
import type { VoiceCtx } from "@docmaker/voice";
import type { StepCtx } from "@docmaker/llm";
import type { ExportCtx } from "@docmaker/export";
import { BUILTIN_FONT_FAMILIES } from "@docmaker/core";
import type { StageCtx } from "../types";
import type { ProjectCosts } from "../costs";
import type { Runtime } from "../runtime";
import type { FrozenCacheLike } from "../deps";

export interface StageExt {
  rt: Runtime;
  force: boolean;
  costs: ProjectCosts;
  fixture: FixtureManifest | null;
  /** project.assets.offline || DOCMAKER_OFFLINE */
  offline: boolean;
  updateProject(patch: Partial<Project>): Promise<Project>;
  personAcks(): Promise<string[]>;
  riskFlags(): Promise<RiskFlag[]>;
  frozenCache(): FrozenCacheLike;
  /** Byte etags of the stage's user-editable outputs captured when the stage started (null = did not exist). */
  startEtags: ReadonlyMap<string, string | null>;
}

const EXT = Symbol.for("docmaker.engine.stageExt");
export function attachExt(ctx: StageCtx, ext: StageExt): StageCtx {
  Object.defineProperty(ctx, EXT, { value: ext, enumerable: false });
  return ctx;
}
export function X(ctx: StageCtx): StageExt {
  const e = (ctx as unknown as Record<symbol, StageExt | undefined>)[EXT];
  if (!e) throw new DocmakerError("INTERNAL", "stage context without engine extension");
  return e;
}

export function stepCtx(ctx: StageCtx): StepCtx {
  return { llm: ctx.llm, signal: ctx.signal, costs: ctx.costs, logger: ctx.logger, progress: ctx.progress, newRequest: ctx.options.newRequest === true };
}
export function audioCtx(ctx: StageCtx): AudioCtx {
  return { config: ctx.config, logger: ctx.logger, signal: ctx.signal, progress: ctx.progress };
}
export function voiceCtx(ctx: StageCtx): VoiceCtx {
  return { config: ctx.config, secrets: ctx.secrets, logger: ctx.logger, signal: ctx.signal, progress: ctx.progress, costs: ctx.costs };
}
export function exportCtx(ctx: StageCtx): ExportCtx {
  return { config: ctx.config, logger: ctx.logger, signal: ctx.signal };
}
export function assetsCtx(ctx: StageCtx): AssetsCtx {
  const e = X(ctx);
  return {
    config: { ...ctx.config, offline: e.offline }, secrets: ctx.secrets, logger: ctx.logger, http: e.rt.deps.assets.createHttpClient({ config: { ...ctx.config, offline: e.offline }, logger: ctx.logger }),
    signal: ctx.signal, progress: ctx.progress, costs: ctx.costs, cache: e.frozenCache(),
  };
}

export function needLang(ctx: StageCtx): Lang {
  if (!ctx.lang) throw new DocmakerError("INTERNAL", "per-language stage without a language");
  return ctx.lang;
}

/** Writes a stage-owned document (ownership enforced by the store); user-editable outputs use the etag captured at start. */
export async function writeDoc<S extends z.ZodType>(ctx: StageCtx, stage: StageId, rel: string, schema: S, value: z.input<S>): Promise<boolean> {
  const ext = X(ctx);
  const ifMatch = docEntryFor(rel)?.userEditable && ext.startEtags.has(rel) ? ext.startEtags.get(rel) : undefined;
  const r = await ctx.store.writeJson(rel, schema, value, ifMatch === undefined ? { writer: "stage", stage } : { writer: "stage", stage, ifMatch });
  if (r.changed) ctx.emit({ type: "artifact", stage, lang: ctx.lang, path: rel, kind: "doc" } as JobEventInput);
  return r.changed;
}

export const projectAbs = (ctx: StageCtx, rel: string) => ctx.store.abs(rel);

// ---------------------------------------------------------------- onlyChapters (§9.1)
export function filterScript(script: Script, only: readonly ChapterId[] | null | undefined): Script {
  if (!only || only.length === 0) return script;
  const set = new Set(only);
  const chapters = script.chapters.filter((c) => set.has(c.chapterId));
  if (chapters.length === 0) throw new DocmakerError("VALIDATION", `onlyChapters ${only.join(",")} selects no chapter of the ${script.lang} script`);
  return { ...script, chapters };
}
export function filterPlans(plans: readonly BeatPlan[], only: readonly ChapterId[] | null | undefined): BeatPlan[] {
  if (!only || only.length === 0) return [...plans];
  const set = new Set<string>(only);
  return plans.filter((p) => set.has(p.chapterId));
}
export function filterTexts(texts: readonly BeatLang[], plans: readonly BeatPlan[]): BeatLang[] {
  const ids = new Set(plans.map((p) => p.id));
  return texts.filter((t) => ids.has(t.beatId));
}
export const onlyChaptersOf = (ctx: StageCtx): ChapterId[] | null => (ctx.options.onlyChapters && ctx.options.onlyChapters.length > 0 ? [...ctx.options.onlyChapters] : null);

// ---------------------------------------------------------------- render tokens (§4.12; direct)
export function buildRenderTokens(style: StylePlugin, project: Pick<Project, "themeOverride" | "captionsVariant">, fontUrls: StyleRenderTokens["fonts"]): StyleRenderTokens {
  const d = style.data;
  const th = project.themeOverride;
  const fontOk = (f: string) => BUILTIN_FONT_FAMILIES.includes(f) || style.fonts.some((sf) => sf.family === f);
  const tokens = structuredClone(d.tokens);
  if (th?.accent) tokens.palette.accent = th.accent;
  if (th?.backdropRecipe) tokens.backdrop = th.backdropRecipe;
  if (th?.fontHeadline && fontOk(th.fontHeadline)) tokens.fonts.headline = th.fontHeadline;
  return {
    styleId: d.manifest.id,
    tokens,
    motion: structuredClone(d.motion),
    captionDNA: { ...structuredClone(d.captionDNA), variant: project.captionsVariant ?? d.captionDNA.variant },
    stills: structuredClone(d.stills.card),
    theme: th ? { ...th, fontHeadline: th.fontHeadline && fontOk(th.fontHeadline) ? th.fontHeadline : null } : null,
    fonts: fontUrls,
  };
}

/** Skeleton hash of a chapter: hashJson([{id,type,quoteId}]) — what beat plans depend on (§5.1). */
export function skeletonOf(ch: Script["chapters"][number]): { id: string; type: string; quoteId: string | null }[] {
  return ch.segments.map((s) => ({ id: s.id, type: s.type, quoteId: s.quoteId }));
}

export async function hashOf(ctx: StageCtx, rel: string): Promise<string | null> {
  return ctx.store.docHashOf(rel);
}

export const relOf = (projectDir: string, abs: string) => path.relative(projectDir, abs).split(path.sep).join("/");
export const docHashOrNull = (v: unknown) => (v === null || v === undefined ? null : docHash(v));
export type { StageCtx };
export const emitLog = (ctx: StageCtx, stage: StageId, level: "debug" | "info" | "warn" | "error", message: string) =>
  ctx.emit({ type: "log", level, message, stage } as JobEventInput);
