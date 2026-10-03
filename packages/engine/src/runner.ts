// Stage execution (§5.1, §5.3, §5.4): StageCtx construction, docHash-based inputs hashing, up-to-date skips, gates (fixture
// auto-approval), cost gate (stage or job pipeline approval), checkRefs at stage boundaries, state.json bookkeeping.
import {
  DocmakerError, P, docEntryFor, hashJson, checkRefs, type Approval, type DocSet, type FixtureManifest, type GateId, type JobEventInput,
  type JobOptions, type Lang, type LintIssue, type Project, type RenderClient, type RiskFlag, type StageId, type StageState, type StylePlugin,
  Project as ProjectSchema, Outline, FactCheck, docHash, EDITORIAL_GATES,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { StageCtx, StageDef } from "./types";
import type { Runtime } from "./runtime";
import type { FrozenCacheLike } from "./deps";
import { ProjectCosts } from "./costs";
import { docs } from "./docs";
import {
  addApproval, factcheckGateState, pendingClaims, pendingPersons, personAcksOf, prepareApproval, type ApprovalInput, type GateNeed,
} from "./gates";
import { findStage, readState, updateStageState, type StageKey } from "./state";
import { X, attachExt, type StageExt } from "./stages/common";
import { stageDef } from "./stages";
import { errorInfo, nowIso, pickOptions, silentLogger } from "./util";

export interface StageInvocation { stage: StageId; lang: Lang | null; variant: string | null; options: JobOptions; force: boolean; scratch?: boolean }
export const invKey = (i: Pick<StageInvocation, "stage" | "lang" | "variant">): string => `${i.stage}${i.lang ? "." + i.lang : ""}${i.variant ? "@" + i.variant : ""}`;
export const costKey = (stage: StageId, lang: Lang | null): string => `${stage}${lang ? "." + lang : ""}`;

/** What a running job gives the stages (absent for read-only uses: status, estimates). */
export interface JobHandle {
  jobId: string;
  signal: AbortSignal;
  emit(e: JobEventInput): void;
  costs: ProjectCosts;
  releaseProjectLock(): Promise<void>;
  /** Per stage key: the amount approved through the job's pipeline estimate (null when none was needed/approved). */
  pipelineApproved: Map<string, number> | null;
}

const NEVER = new AbortController().signal;

export async function readProject(store: ProjectStore): Promise<Project> {
  return store.readJson(P.project, ProjectSchema);
}

/** project.styleId → its plugin; before a style exists: the suggestion, else the first registered style. */
export async function styleFor(rt: Runtime, project: Project, store: ProjectStore | null): Promise<StylePlugin> {
  const reg = await rt.styles();
  const candidates = [project.styleId, store ? (await docs.suggestion(store))?.recommendedStyleId ?? null : null, "drama-commentary"];
  for (const id of candidates) if (id && reg.has(id)) return reg.get(id);
  const first = reg.list()[0];
  if (!first) throw new DocmakerError("VALIDATION", "no style is installed");
  return reg.get(first.id);
}

export async function fixtureOf(rt: Runtime, project: Project): Promise<FixtureManifest | null> {
  return project.llm.provider === "fixture" ? rt.fixture(project.llm.fixtureId) : null;
}
export const fixtureAutoApproves = (fx: FixtureManifest | null): boolean => fx?.autoApproveGates === true;

export async function updateProjectDoc(store: ProjectStore, patch: Partial<Project>, writer: "engine" | "user" = "engine"): Promise<Project> {
  const cur = await readProject(store);
  const next = ProjectSchema.parse({ ...cur, ...patch, slug: cur.slug, formatVersion: 1, schemaVersion: cur.schemaVersion, createdAt: cur.createdAt, updatedAt: nowIso() });
  if (docHash({ ...next, updatedAt: "" }) === docHash({ ...cur, updatedAt: "" })) return cur;
  await store.writeJson(P.project, ProjectSchema, next, { writer });
  return next;
}

export async function riskFlagsOf(rt: Runtime, store: ProjectStore, project: Project): Promise<RiskFlag[]> {
  const s = await docs.suggestion(store);
  return s?.riskFlags ?? rt.deps.styles.riskFlagsOffline(project.idea);
}

/** Builds a StageCtx (+ engine extension) for one invocation. */
export async function buildCtx(rt: Runtime, store: ProjectStore, inv: StageInvocation, job: JobHandle | null, renderClient: RenderClient | null): Promise<StageCtx> {
  const project = await readProject(store);
  const style = await styleFor(rt, project, store);
  const fixture = await fixtureOf(rt, project);
  const emit = job?.emit ?? (() => {});
  const costs = job?.costs ?? (await ProjectCosts.open(store, project, null, () => {}));
  let lastProgress = 0;
  const progress: StageCtx["progress"] = (pct, message, detail) => {
    const now = Date.now();
    const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
    if (p < 1 && now - lastProgress < 250) return;
    lastProgress = now;
    emit({ type: "progress", stage: inv.stage, lang: inv.lang, pct: p, message, detail: detail ?? {} });
  };
  let cache: FrozenCacheLike | null = null;
  const ctx: StageCtx = {
    project, lang: inv.lang, variant: inv.variant, store, config: rt.config, secrets: rt.secrets,
    logger: (rt.logger ?? silentLogger).child({ stage: inv.stage, lang: inv.lang, slug: project.slug }),
    signal: job?.signal ?? NEVER, emit, progress, costs, llm: rt.llmFor(project), style,
    render: renderClient as RenderClient, options: inv.options, jobId: job?.jobId ?? "", releaseProjectLock: job?.releaseProjectLock,
  };
  const ext: StageExt = {
    rt, force: inv.force, costs, fixture, offline: project.assets.offline || rt.config.offline,
    async updateProject(patch) {
      const next = await updateProjectDoc(store, patch, "engine");
      ctx.project = next;
      costs.setProject(next);
      return next;
    },
    personAcks: async () => personAcksOf(await docs.approvals(store)),
    riskFlags: () => riskFlagsOf(rt, store, ctx.project),
    frozenCache() {
      if (!cache) cache = rt.deps.assets.createFrozenCache({ config: rt.config, logger: ctx.logger });
      return cache;
    },
    startEtags: new Map(),
  };
  return attachExt(ctx, ext);
}

export async function inputsHashOf(def: StageDef, ctx: StageCtx): Promise<string> {
  const inputs = await def.inputs(ctx);
  return hashJson({ stage: def.id, stageVersion: def.version, lang: ctx.lang, variant: ctx.variant, inputs, options: pickOptions(ctx.options, def.optionKeys) });
}

export async function outputsExist(def: StageDef, ctx: StageCtx): Promise<boolean> {
  for (const rel of def.outputs(ctx)) if (!(await ctx.store.exists(rel))) return false;
  return true;
}

export async function outputsHashOf(store: ProjectStore, rels: readonly string[]): Promise<string> {
  const parts: [string, string | null][] = [];
  for (const rel of [...new Set(rels)].sort()) {
    parts.push([rel, docEntryFor(rel) ? await store.docHashOf(rel).catch(() => null) : await store.etag(rel).catch(() => null)]);
  }
  return hashJson(parts);
}

export function upToDate(state: StageState | null, inputsHash: string): boolean {
  return !!state && state.status === "done" && state.inputsHash === inputsHash;
}

// ---------------------------------------------------------------- integrity at stage boundaries
export async function loadDocSet(store: ProjectStore, project: Project, lang: Lang | null, stage: StageId): Promise<DocSet> {
  const scripts: DocSet["scripts"] = {};
  const slices: DocSet["slices"] = {};
  for (const l of project.languages) {
    const s = await docs.script(store, l).catch(() => null);
    if (s) scripts[l] = s;
    const sl = await docs.slices(store, l).catch(() => null);
    if (sl) slices[l] = sl;
  }
  const set: DocSet = { project, scripts, slices };
  const fs = await docs.factsheet(store).catch(() => null);
  if (fs) set.factSheet = fs;
  const plans = await docs.plans(store).catch(() => null);
  if (plans) set.plans = plans;
  const up = await docs.userPicks(store).catch(() => null);
  if (up) set.userPicks = up;
  const picks = await docs.picks(store).catch(() => null);
  if (picks) set.picks = picks;
  const frozen = await docs.frozen(store).catch(() => null);
  if (frozen) set.frozen = frozen;
  if (lang && stage === "direct") {
    const t = await docs.timeline(store, lang).catch(() => null);
    if (t) set.timeline = t;
    const ov = await docs.overrides(store, lang).catch(() => null);
    if (ov) set.overrides = ov;
  }
  return set;
}
const issueKey = (i: LintIssue) => `${i.rule}|${i.where}|${i.msg}`;
/** Errors present after the stage that were not there before it (a stage must not introduce broken references). */
export function newRefErrors(before: readonly LintIssue[], after: readonly LintIssue[]): LintIssue[] {
  const seen = new Set(before.filter((i) => i.level === "error").map(issueKey));
  return after.filter((i) => i.level === "error" && !seen.has(issueKey(i)));
}
const REF_STAGES: readonly StageId[] = ["research", "script", "beats", "beatslice", "assets", "direct"];

// ---------------------------------------------------------------- approvals (engine.approve and fixture auto-approval)
export async function persistApproval(rt: Runtime, store: ProjectStore, gate: GateId, a: ApprovalInput, o: { fixtureAllowed: boolean; stage?: StageId }): Promise<Approval> {
  const project = await readProject(store);
  const facts = await docs.factsheet(store);
  const fx = await prepareApproval(store, project, gate, a, { fixtureAllowed: o.fixtureAllowed, facts, stage: o.stage });
  if (fx.outline) await store.writeJson(P.outline, Outline, fx.outline, { writer: "user" });
  if (fx.factCheck) await store.writeJson(P.factcheck(fx.factCheck.lang), FactCheck, fx.factCheck, { writer: "user" });
  if (gate === "style-confirm" && fx.projectPatch?.styleId && !project.styleConfirmed) {
    // confirming a style applies its caption default (defaultProject cannot know the style, F note 7)
    const reg = await rt.styles();
    if (reg.has(fx.projectPatch.styleId)) fx.projectPatch = { ...fx.projectPatch, captions: reg.get(fx.projectPatch.styleId).data.captionDNA.defaultMode };
  }
  if (fx.projectPatch) await updateProjectDoc(store, fx.projectPatch, "engine");
  // the outline approval binds to the outline as written (thesis confirmation included)
  const approval = gate === "outline-approval" && fx.outline ? { ...fx.approval, planHash: docHash(fx.outline) } : fx.approval;
  await addApproval(store, approval);
  rt.logger.info("approval recorded", { gate, by: a.by, items: approval.items.length });
  return approval;
}

/** Fixture projects with autoApproveGates approve every editorial gate with by:"fixture" (never fix-only items). */
async function autoApprove(rt: Runtime, store: ProjectStore, project: Project, need: GateNeed, inv: StageInvocation): Promise<boolean> {
  const note = "demo fixture";
  let items: string[] = [];
  let lang: Lang | null = null;
  switch (need.gate) {
    case "cost":
      return false;
    case "factcheck-ack": {
      lang = inv.lang ?? project.primaryLang;
      const st = await factcheckGateState(store, project, lang);
      if (st.stale || !st.factCheck) return false;
      items = st.gating.filter((i) => i.resolution !== "rewritten").map((i) => i.id);
      break;
    }
    case "person-ack":
      items = (await pendingPersons(store, project)).map((p) => p.id);
      break;
    case "recheck":
      items = (await pendingClaims(store, project)).map((c) => c.id);
      break;
    default:
      break;
  }
  try {
    await persistApproval(rt, store, need.gate, {
      stage: inv.stage, lang, planHash: need.planHash, by: "fixture", note, items, itemNotes: Object.fromEntries(items.map((id) => [id, note])),
    }, { fixtureAllowed: true, stage: inv.stage });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- cost gate
async function costApproved(store: ProjectStore, project: Project, est: { planHash: string; totalUsd: number; stage: StageId; lang: Lang | null }, job: JobHandle): Promise<boolean> {
  const key = costKey(est.stage, est.lang);
  const threshold = project.budget.autoApproveUnderUsd;
  const approvals = (await docs.approvals(store)).approvals.filter((a) => a.gate === "cost");
  if (approvals.some((a) => a.planHash === est.planHash || a.items.includes(est.planHash))) {
    job.costs.setApproved(est.stage, est.lang, est.totalUsd);
    return true;
  }
  const viaPipeline = job.pipelineApproved?.get(key);
  if (viaPipeline !== undefined && est.totalUsd <= viaPipeline * 1.25 + 0.25) {
    job.costs.setApproved(est.stage, est.lang, Math.max(viaPipeline, est.totalUsd));
    return true;
  }
  if (est.totalUsd <= threshold) {
    await addApproval(store, {
      gate: "cost", stage: est.stage, lang: est.lang, planHash: est.planHash, approvedAt: nowIso(), by: "auto-threshold",
      note: `estimate $${est.totalUsd.toFixed(2)} ≤ auto-approve threshold $${threshold.toFixed(2)}`, items: [est.planHash], itemNotes: {},
    });
    job.costs.setApproved(est.stage, est.lang, est.totalUsd);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- one stage
export type StageOutcome =
  | { kind: "done"; outputsHash: string; durationMs: number }
  | { kind: "skipped" }
  | { kind: "blocked"; needs: GateNeed[] };

export async function runStage(rt: Runtime, store: ProjectStore, inv: StageInvocation, job: JobHandle, renderClient: RenderClient | null): Promise<StageOutcome> {
  const def = stageDef(inv.stage);
  let ctx = await buildCtx(rt, store, inv, job, renderClient);
  const key: StageKey = { stage: inv.stage, lang: inv.lang, variant: inv.variant };
  const inputsHash = await inputsHashOf(def, ctx);
  const state = findStage(await readState(store), key);
  if (!inv.force && upToDate(state, inputsHash) && (await outputsExist(def, ctx))) {
    job.emit({ type: "stage-skip", stage: inv.stage, lang: inv.lang, reason: "up-to-date" });
    return { kind: "skipped" };
  }

  // gates (editorial ones auto-approve only for fixtures with autoApproveGates)
  const fixture = await fixtureOf(rt, ctx.project);
  for (let round = 0; round < 3; round++) {
    const needs = def.gatesBefore ? await def.gatesBefore(ctx) : [];
    if (needs.length === 0) break;
    let progressed = false;
    if (fixtureAutoApproves(fixture)) {
      for (const n of needs) if (await autoApprove(rt, store, ctx.project, n, inv)) progressed = true;
    }
    if (progressed) {
      ctx = await buildCtx(rt, store, inv, job, renderClient);
      continue;
    }
    for (const n of needs) {
      job.emit({ type: "needs-approval", gate: n.gate, stage: inv.stage, lang: inv.lang, planHash: n.planHash, reason: n.reason, summary: n.summary });
    }
    await updateStageState(store, key, def.version, { status: "blocked", error: needs.map((n) => `${n.gate}: ${n.summary}`).join("; ") });
    return { kind: "blocked", needs };
  }
  // the editorial approvals may have changed documents this stage hashes: recompute
  const finalInputsHash = await inputsHashOf(def, ctx);

  // cost gate
  if (def.estimate) {
    const e = await def.estimate(ctx);
    if (e && e.totalUsd > 0) {
      const est = await job.costs.estimate(e, finalInputsHash);
      job.emit({ type: "estimate", estimate: est });
      if (!(await costApproved(store, ctx.project, est, job))) {
        const need: GateNeed = { gate: "cost", reason: "unmet", planHash: est.planHash, summary: `${costKey(est.stage, est.lang)} is estimated at $${est.totalUsd.toFixed(2)} (${est.confidence})` };
        job.emit({ type: "needs-approval", gate: "cost", stage: inv.stage, lang: inv.lang, planHash: est.planHash, reason: "unmet", summary: need.summary });
        await updateStageState(store, key, def.version, { status: "blocked", error: `cost: ${need.summary}` });
        return { kind: "blocked", needs: [need] };
      }
    }
  }

  // user-editable outputs are written with ifMatch on the etag captured now (§4.18)
  const etags = X(ctx).startEtags as Map<string, string | null>;
  for (const rel of def.outputs(ctx)) if (docEntryFor(rel)?.userEditable) etags.set(rel, await store.etag(rel));

  const refsBefore = REF_STAGES.includes(inv.stage) ? checkRefs(await loadDocSet(store, ctx.project, inv.lang, inv.stage)) : [];
  const t0 = Date.now();
  await updateStageState(store, key, def.version, { status: "running", startedAt: nowIso(), finishedAt: null, error: null });
  job.emit({ type: "stage-start", stage: inv.stage, lang: inv.lang });
  const spentBefore = job.costs.spentUsd(inv.stage, inv.lang);
  try {
    if (job.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
    const r = await def.run(ctx);
    if (job.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
    job.costs.assertWithinBudget(inv.stage, inv.lang);
    if (REF_STAGES.includes(inv.stage)) {
      const fresh = await readProject(store);
      const added = newRefErrors(refsBefore, checkRefs(await loadDocSet(store, fresh, inv.lang, inv.stage)));
      if (added.length) {
        throw new DocmakerError("VALIDATION", `${invKey(inv)} produced ${added.length} broken reference(s): ${added.slice(0, 5).map((i) => `${i.rule}@${i.where}`).join(", ")}`, { details: added });
      }
    }
    const outputsHash = await outputsHashOf(store, def.outputs(ctx));
    const durationMs = Date.now() - t0;
    await updateStageState(store, key, def.version, {
      status: "done", stageVersion: def.version, inputsHash: finalInputsHash, outputsHash, finishedAt: nowIso(), error: null,
      costUsd: Math.round((job.costs.spentUsd(inv.stage, inv.lang) - spentBefore) * 1e6) / 1e6 + (state?.costUsd ?? 0), artifacts: [...new Set(r.artifacts)].sort(),
    });
    job.emit({ type: "stage-done", stage: inv.stage, lang: inv.lang, durationMs, outputsHash });
    return { kind: "done", outputsHash, durationMs };
  } catch (err) {
    const info = errorInfo(err);
    await updateStageState(store, key, def.version, { status: info.code === "CANCELED" ? "idle" : "failed", finishedAt: nowIso(), error: `${info.code}: ${info.message}` }).catch(() => undefined);
    throw err;
  }
}

/** Is any editorial gate in this list? (CLI: `--yes` never satisfies them.) */
export const isEditorial = (g: GateId): boolean => EDITORIAL_GATES.includes(g);
