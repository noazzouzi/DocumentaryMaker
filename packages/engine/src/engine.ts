// createEngine (§4.19, §5.5): the Engine implementation (in-process runner; "worker" runner forwards jobs to a forked
// job worker, see worker.ts). Reads/writes/approvals/estimates/styles/assets run in the calling process.
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CostEstimate as CostEstimateSchema, DocmakerError, Script as ScriptSchema, type LintIssue, ENV_KEYS, FactSheet as FactSheetSchema, LocalIndexDoc, P, UserPicksDoc, VARIANT_STAGES, canonicalJson, docEntryFor, hashJson, type Approval, type CostEstimate, type CostTracker, type GateId,
  type HomeConfig, type JobEvent, type JobRecord, type JobRequest, type Lang, type NewProjectInput, type PipelineEstimate, type Project,
  type RenderPresetId, type StageId, type StyleSuggestion, type UploadDeclaration, type VoiceInfo, type VoiceProviderId, type VoiceTrack,
} from "@docmaker/core";
import { ProjectStore, cacheCapBytes, ensureHome, maskSecret, readHomeConfig, run, writeHomeConfig, writeSecret } from "@docmaker/core/node";
import type { z } from "zod";
import type { DemoOptions, Engine, EngineOptions, ImpactReport, StageStatus } from "./types";
import { REAL_DEPS } from "./deps";
import { createRuntime, type Runtime } from "./runtime";
import { JobManager, isTerminal } from "./jobs";
import { ProjectCosts, readReceipts } from "./costs";
import { docs } from "./docs";
import { STAGE_LIST, stageDef } from "./stages";
import { buildCtx, fixtureAutoApproves, fixtureOf, inputsHashOf, persistApproval, readProject, updateProjectDoc, type StageInvocation } from "./runner";
import { pendingClaims } from "./gates";
import { pipelineEstimate, planInvocations, stageRange } from "./pipeline";
import { emptyStageState, findStage, readState } from "./state";
import { createProjectIn, listProjectsIn, updateProjectIn } from "./project";
import { writeUserDoc } from "./editing";
import { FASTER_WHISPER_MODEL, runDoctor } from "./doctor";
import { createDemoProject, demoOutputs } from "./demo";
import { researchResumeInfo, type ResearchResumeInfo } from "./stages/research";
import { WorkerHost } from "./worker";
import { orderLangs, pickOptions } from "./util";

/** A ProjectStore view that memoizes reads for one status/estimate computation (many stages hash the same docs). */
export function memoStore(store: ProjectStore): ProjectStore {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(k: string, f: () => Promise<T>): Promise<T> => {
    let p = cache.get(k) as Promise<T> | undefined;
    if (!p) cache.set(k, (p = f()));
    return p;
  };
  const view = Object.create(store) as ProjectStore;
  Object.assign(view, {
    docHashOf: (rel: string) => memo(`h:${rel}`, () => store.docHashOf(rel)),
    etag: (rel: string) => memo(`e:${rel}`, () => store.etag(rel)),
    exists: (rel: string) => memo(`x:${rel}`, () => store.exists(rel)),
    readJsonOrNull: (rel: string, schema: z.ZodType) => memo(`j:${rel}`, () => store.readJsonOrNull(rel, schema)),
    readJson: (rel: string, schema: z.ZodType) => memo(`r:${rel}`, () => store.readJson(rel, schema)),
  });
  return view;
}

/** In-memory CostTracker for calls outside a project (style suggestion at /new). */
function looseCosts(): CostTracker {
  let total = 0;
  return {
    async estimate(e, inputsHash) {
      return { ...e, schemaVersion: 1, id: `est-${e.stage}`, createdAt: new Date().toISOString(), planHash: hashJson({ inputsHash, e }) };
    },
    async findReceipt() {
      return null;
    },
    async record(r) {
      total += r.costUsd;
      return { ...r, createdAt: new Date().toISOString(), jobId: null };
    },
    spentUsd: () => total,
    spentTotalUsd: () => total,
    assertWithinBudget() {},
  };
}

const KEY_TESTS: Partial<Record<keyof typeof ENV_KEYS, (key: string) => { url: string; headers: Record<string, string> }>> = {
  anthropic: (k) => ({ url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": k, "anthropic-version": "2023-06-01" } }),
  elevenlabs: (k) => ({ url: "https://api.elevenlabs.io/v1/user/subscription", headers: { "xi-api-key": k } }),
  pexels: (k) => ({ url: "https://api.pexels.com/v1/search?query=archive&per_page=1", headers: { Authorization: k } }),
  pixabay: (k) => ({ url: `https://pixabay.com/api/?key=${encodeURIComponent(k)}&q=archive&per_page=3`, headers: {} }),
  brave: (k) => ({ url: "https://api.search.brave.com/res/v1/images/search?q=archive&count=1", headers: { "X-Subscription-Token": k, Accept: "application/json" } }),
};

export function secretNameOf(name: string): keyof typeof ENV_KEYS {
  const n = name.trim();
  for (const [k, env] of Object.entries(ENV_KEYS)) if (k.toLowerCase() === n.toLowerCase() || env === n.toUpperCase()) return k as keyof typeof ENV_KEYS;
  throw new DocmakerError("VALIDATION", `unknown key ${name}`, { hint: `one of: ${Object.keys(ENV_KEYS).join(", ")}` });
}

class EngineImpl implements Engine {
  readonly jobs: JobManager;
  private readonly worker: WorkerHost | null;
  constructor(readonly rt: Runtime, o: EngineOptions) {
    this.jobs = new JobManager(rt, { renderClient: o.renderClient });
    this.worker = o.runner?.kind === "worker" ? new WorkerHost(rt, { workerPath: o.runner.workerPath, jobs: this.jobs }) : null;
  }
  get config() {
    return this.rt.config;
  }
  private open(slug: string): Promise<ProjectStore> {
    return ProjectStore.open(this.rt.config.projectsDir, slug);
  }

  // ---------------------------------------------------------------- projects
  async createProject(input: NewProjectInput): Promise<Project> {
    this.rt.refresh();
    return createProjectIn(this.rt, input);
  }
  async listProjects() {
    const list = await listProjectsIn(this.rt);
    const out = [];
    for (const p of list) {
      const jobs = await this.jobs.listJobs(p.slug).catch(() => [] as JobRecord[]);
      out.push({ ...p, activeJobId: jobs.find((j) => j.status === "running")?.id ?? null });
    }
    return out;
  }
  async getProject(slug: string): Promise<Project> {
    return readProject(await this.open(slug));
  }
  async updateProject(slug: string, patch: Partial<Project>): Promise<Project> {
    return updateProjectIn(this.rt, slug, patch);
  }

  // ---------------------------------------------------------------- status / impact
  private async invocations(project: Project, store: ProjectStore): Promise<StageInvocation[]> {
    const state = await readState(store);
    const out: StageInvocation[] = [];
    for (const def of STAGE_LIST) {
      if (!def.perLang) {
        out.push({ stage: def.id, lang: null, variant: null, options: {}, force: false });
        continue;
      }
      for (const lang of orderLangs(project, null)) {
        if (!VARIANT_STAGES.includes(def.id)) {
          out.push({ stage: def.id, lang, variant: null, options: {}, force: false });
          continue;
        }
        const presets = new Set<string>([project.render.defaultPreset, ...state.stages.filter((s) => s.stage === def.id && s.lang === lang && s.variant).map((s) => s.variant!)]);
        for (const v of [...presets].sort()) out.push({ stage: def.id, lang, variant: v, options: {}, force: false });
      }
    }
    return out;
  }

  /** Option sets a stage was plausibly run with (absent options + those of recent jobs): stale only if none matches. */
  private async optionCandidates(slug: string): Promise<JobRequest["options"][]> {
    const jobs = await this.jobs.listJobs(slug).catch(() => [] as JobRecord[]);
    const seen = new Map<string, JobRequest["options"]>([["{}", {}]]);
    for (const j of jobs.slice(0, 30)) seen.set(canonicalJson(j.request.options), j.request.options);
    return [...seen.values()];
  }

  private async stageStatuses(slug: string, projectOverride?: Project): Promise<StageStatus[]> {
    const real = await this.open(slug);
    const store = memoStore(real);
    const project = await readProject(store);
    const state = await readState(store);
    const candidates = await this.optionCandidates(slug);
    const out: StageStatus[] = [];
    for (const inv of await this.invocations(projectOverride ?? project, store)) {
      const def = stageDef(inv.stage);
      const st = findStage(state, inv) ?? emptyStageState(inv, def.version);
      let stale = false;
      let blockedBy: GateId | null = null;
      let blockedReason: "unmet" | "stale" | null = null;
      try {
        const ctx = await buildCtx(this.rt, store, inv, null, null);
        if (projectOverride) ctx.project = projectOverride;
        if (st.status === "done" && st.inputsHash) {
          const tried = new Set<string>();
          let match = false;
          for (const o of candidates) {
            const picked = canonicalJson(pickOptions(o, def.optionKeys));
            if (tried.has(picked)) continue;
            tried.add(picked);
            ctx.options = o;
            if ((await inputsHashOf(def, ctx)) === st.inputsHash) {
              match = true;
              break;
            }
          }
          stale = !match;
        }
        ctx.options = {};
        if (!projectOverride && def.gatesBefore) {
          const needs = await def.gatesBefore(ctx);
          if (needs[0]) {
            blockedBy = needs[0].gate;
            blockedReason = needs[0].reason;
          }
        }
      } catch {
        stale = st.status === "done";
      }
      out.push({ ...st, stale, blockedBy, blockedReason });
    }
    return out;
  }

  async status(slug: string) {
    const stages = await this.stageStatuses(slug);
    const store = await this.open(slug);
    const project = await readProject(store);
    const costs = await ProjectCosts.open(store, project, null, () => {});
    const jobs = await this.jobs.listJobs(slug);
    return {
      stages, costUsd: Math.round(costs.spentTotalUsd() * 1e4) / 1e4, activeJobId: jobs.find((j) => j.status === "running")?.id ?? null,
      queued: jobs.filter((j) => j.status === "queued" && !j.coalescedInto).map((j) => j.id),
    };
  }

  async impact(slug: string, patch: Partial<Project> | { doc: string }): Promise<ImpactReport> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const before = await this.stageStatuses(slug);
    const staleStages: { stage: StageId; lang: Lang | null }[] = [];
    const lostUserEdits: string[] = [];
    if ("doc" in patch && typeof (patch as { doc: unknown }).doc === "string") {
      // a document edit stales every done stage downstream of the document's owner stage (same language for per-language docs)
      const rel = (patch as { doc: string }).doc;
      const owner = docEntryFor(rel)?.owner;
      const lang = (/(?:^|\/)(en|fr)(?:[./]|$)/.exec(rel)?.[1] as Lang | undefined) ?? null;
      const from = owner && owner !== "user" && owner !== "engine" ? STAGE_LIST.findIndex((s) => s.id === owner) + 1 : rel.startsWith("assets/user-picks") ? STAGE_LIST.findIndex((s) => s.id === "assets") : rel.includes(".overrides.") ? STAGE_LIST.findIndex((s) => s.id === "direct") : 0;
      for (const s of before) {
        if (STAGE_LIST.findIndex((d) => d.id === s.stage) < from || s.status !== "done") continue;
        if (lang && s.lang && s.lang !== lang && s.stage !== "beats") continue;
        staleStages.push({ stage: s.stage, lang: s.lang });
      }
    } else {
      const p = patch as Partial<Project>;
      const next = { ...project, ...p } as Project;
      const after = await this.stageStatuses(slug, next);
      const direct: StageStatus[] = [];
      for (const a of after) {
        const b = before.find((x) => x.stage === a.stage && x.lang === a.lang && x.variant === a.variant);
        if (b && b.status === "done" && !b.stale && a.stale) direct.push(a);
      }
      // downstream closure: everything done after a stale stage (same language for per-language stages)
      const idx = (s: StageId) => STAGE_LIST.findIndex((d) => d.id === s);
      for (const s of before) {
        if (s.status !== "done") continue;
        const hit = direct.some((d) => idx(s.stage) >= idx(d.stage) && (d.lang === null || s.lang === null ? d.lang === null || d.lang === project.primaryLang || s.lang !== null : s.lang === d.lang));
        if (hit) staleStages.push({ stage: s.stage, lang: s.lang });
      }
      const rewrites = ["styleId", "targetMinutes", "languages", "primaryLang"].some((k) => k in p && canonicalJson((p as Record<string, unknown>)[k]) !== canonicalJson((project as Record<string, unknown>)[k]));
      if (rewrites) {
        for (const l of project.languages) {
          const s = await docs.script(store, l);
          for (const c of s?.chapters ?? []) if (c.userEdited || c.locked) lostUserEdits.push(`script/${l} ${c.chapterId}${c.locked ? " (locked)" : ""}`);
        }
        const up = await docs.userPicks(store);
        if (up && up.picks.length) lostUserEdits.push(`${up.picks.length} user pick(s) may be orphaned`);
      }
    }
    let usd = 0;
    for (const s of staleStages) {
      const def = stageDef(s.stage);
      if (!def.estimate) continue;
      try {
        const ctx = await buildCtx(this.rt, store, { stage: s.stage, lang: s.lang, variant: null, options: {}, force: true }, null, null);
        usd += (await def.estimate(ctx))?.totalUsd ?? 0;
      } catch { /* unknown */ }
    }
    const uniq = new Map(staleStages.map((s) => [`${s.stage}|${s.lang}`, s]));
    return { staleStages: [...uniq.values()], estimatedRerunUsd: Math.round(usd * 100) / 100, lostUserEdits };
  }

  // ---------------------------------------------------------------- costs & gates
  async estimate(slug: string, stage: StageId, lang: Lang | null): Promise<CostEstimate | null> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const def = stageDef(stage);
    if (def.perLang && !lang) throw new DocmakerError("VALIDATION", `${stage} is per language: pass a language`);
    if (!def.estimate) return null;
    const variant = VARIANT_STAGES.includes(stage) ? project.render.defaultPreset : null;
    const ctx = await buildCtx(this.rt, store, { stage, lang: def.perLang ? lang : null, variant, options: {}, force: false }, null, null);
    const e = await def.estimate(ctx);
    if (!e) return null;
    return ctx.costs.estimate(e, await inputsHashOf(def, ctx));
  }

  async estimatePipeline(slug: string, o: { from: StageId; to: StageId; langs: Lang[] }): Promise<PipelineEstimate> {
    const store = await this.open(slug);
    const project = await readProject(store);
    stageRange(o.from, o.to);
    const plan = planInvocations(project, { slug, kind: "pipeline", stage: null, from: o.from, to: o.to, langs: o.langs, force: false, options: {}, preset: null });
    return pipelineEstimate(this.rt, store, plan, null);
  }

  async approve(slug: string, gate: GateId, a: Omit<Approval, "gate" | "approvedAt">): Promise<void> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const fx = await fixtureOf(this.rt, project);
    await persistApproval(this.rt, store, gate, a, { fixtureAllowed: a.by === "fixture" && fixtureAutoApproves(fx), stage: a.stage });
  }

  // ---------------------------------------------------------------- jobs
  async submit(req: JobRequest) {
    this.rt.refresh();
    if (this.worker) return this.worker.submit(req);
    return this.jobs.submit(req);
  }
  async resume(jobId: string) {
    if (this.worker) return this.worker.resume(jobId);
    return this.jobs.resume(jobId);
  }
  async cancel(jobId: string) {
    if (this.worker) return this.worker.cancel(jobId);
    return this.jobs.cancel(jobId);
  }
  listJobs(slug: string) {
    return this.jobs.listJobs(slug);
  }
  getJob(jobId: string) {
    return this.jobs.getJob(jobId);
  }
  events(jobId: string, afterSeq?: number): AsyncIterable<JobEvent> {
    return this.jobs.events(jobId, afterSeq);
  }
  /** Additive: resolves when the job ends (CLI, demo, tests). */
  async waitForJob(jobId: string): Promise<JobRecord> {
    if (!this.worker) {
      const live = this.jobs.liveIds().includes(jobId);
      if (live) return this.jobs.wait(jobId);
    }
    for await (const ev of this.events(jobId)) if (ev.type === "job-end") break;
    for (let i = 0; i < 40; i++) {
      const r = await this.getJob(jobId);
      if (r && isTerminal(r.status)) return r;
      await new Promise((res) => setTimeout(res, 50));
    }
    const r = await this.getJob(jobId);
    if (!r) throw new DocmakerError("UPSTREAM_MISSING", `job ${jobId} not found`);
    return r;
  }

  // ---------------------------------------------------------------- documents
  async readDoc<S extends z.ZodType>(slug: string, rel: string, schema: S) {
    const store = await this.open(slug);
    const value = await store.readJson(rel, schema);
    return { value, etag: await store.etag(rel) };
  }
  async writeDoc<S extends z.ZodType>(slug: string, rel: string, schema: S, value: z.input<S>, etag: string | null) {
    this.rt.refresh();
    return writeUserDoc(this.rt, await this.open(slug), rel, schema, value, etag);
  }
  async history(slug: string, rel: string) {
    return (await this.open(slug)).history(rel);
  }
  async revert(slug: string, rel: string, historyFile: string) {
    return (await this.open(slug)).revert(rel, historyFile);
  }

  // ---------------------------------------------------------------- styles
  async listStyles() {
    return (await this.rt.styles(true)).list();
  }
  async suggestStyleForIdea(idea: string, o: { useLlm: boolean }): Promise<StyleSuggestion> {
    const reg = await this.rt.styles();
    const offline = { ...this.rt.deps.styles.suggestStyleOffline(idea, reg), stage: "idea" as const };
    this.rt.refresh();
    if (!o.useLlm || !this.rt.secrets.anthropic || this.rt.config.offline) return offline;
    const llm = this.rt.deps.llm.createLlmClient({ provider: "anthropic", fixtureDir: null, rawDir: path.join(this.rt.config.paths.cache, "llm"), refusalFallback: true, logger: this.rt.logger, apiKey: this.rt.secrets.anthropic });
    const styles = reg.list().map((s) => ({ id: s.id, names: s.names, description: s.description, bestFor: s.bestFor }));
    try {
      const s = await this.rt.deps.llm.suggestStyle({ llm, signal: new AbortController().signal, costs: looseCosts(), logger: this.rt.logger, progress: () => {}, newRequest: false }, { idea, styles, factSummary: null, stage: "idea" });
      return reg.has(s.recommendedStyleId) ? { ...s, stage: "idea" } : offline;
    } catch (e) {
      this.rt.logger.warn("LLM style suggestion failed; using the offline ranking", { err: e instanceof Error ? e.message : String(e) });
      return offline;
    }
  }
  async getStyle(id: string) {
    return (await this.rt.styles()).get(id);
  }

  // ---------------------------------------------------------------- assets (interactive)
  private async assetsCtx(store: ProjectStore, project: Project) {
    const offline = project.assets.offline || this.rt.config.offline;
    const config = { ...this.rt.config, offline };
    const costs = await ProjectCosts.open(store, project, null, () => {});
    return {
      config, secrets: this.rt.secrets, logger: this.rt.logger, http: this.rt.deps.assets.createHttpClient({ config, logger: this.rt.logger }),
      signal: new AbortController().signal, progress: () => {}, costs, cache: this.rt.deps.assets.createFrozenCache({ config, logger: this.rt.logger }),
    };
  }
  async liveSearch(slug: string, i: Parameters<Engine["liveSearch"]>[1]) {
    const store = await this.open(slug);
    const project = await readProject(store);
    const query = {
      beatId: i.beatId, kind: i.query.kind ?? "image", role: i.query.role ?? "broll", text: i.query.text, localText: i.query.localText ?? null,
      entityQid: i.query.entityQid ?? null, personIds: i.query.personIds ?? [], orientation: i.query.orientation ?? "landscape", minWidth: i.query.minWidth ?? 1280,
      durationSec: i.query.durationSec ?? null, limit: i.query.limit ?? 24, lang: i.query.lang ?? null,
    } as const;
    const acks = (await docs.approvals(store)).approvals.filter((a) => a.gate === "person-ack").flatMap((a) => a.items);
    const facts = await docs.factsheet(store);
    for (const pid of query.personIds) {
      const p = facts?.people.find((x) => x.id === pid);
      if (p?.isMinorOrPrivateVictim) throw new DocmakerError("POLICY_DENIED", `${pid} is a minor or a private victim: never searched`);
      if (p && !p.publicFigure && !acks.includes(pid)) throw new DocmakerError("POLICY_DENIED", `${pid} is not a public figure: identity searches need the person-ack gate`);
    }
    return this.rt.deps.assets.liveSearch({ query: { ...query }, providers: i.providers, allowPaid: i.allowPaid, policy: project.assets.licensePolicy, editorial: project.editorial, projectDir: store.dir }, await this.assetsCtx(store, project));
  }
  async freeze(slug: string, i: Parameters<Engine["freeze"]>[1]) {
    const store = await this.open(slug);
    const project = await readProject(store);
    const asset = await this.rt.deps.assets.freezeCandidate({ projectDir: store.dir, beatId: i.beatId, provider: i.provider, providerAssetId: i.providerAssetId }, await this.assetsCtx(store, project));
    const plan = (await docs.plans(store))?.plans.find((p) => p.id === i.beatId) ?? null;
    const facts = await docs.factsheet(store);
    const issues = facts ? this.rt.deps.assets.validatePick({
      pick: { beatId: i.beatId, slot: i.slot, assetId: asset.id, role: i.slot === 0 ? "primary" : "alt", focal: { x: 0.5, y: 0.45 }, crop: null, sourceInMs: null, sourceOutMs: null, score: { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "" }, pickedBy: "user", planKey: plan?.planKey ?? "0000000000000000" },
      plan, asset, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: (await docs.approvals(store)).approvals.filter((a) => a.gate === "person-ack").flatMap((a) => a.items),
    }) : [];
    return { asset, issues };
  }
  async upload(slug: string, i: Parameters<Engine["upload"]>[1]) {
    const store = await this.open(slug);
    const project = await readProject(store);
    if (i.kind === "recording") {
      if (!i.lang) throw new DocmakerError("VALIDATION", "a recording upload needs its language");
      const ext = path.extname(i.tmpPath).toLowerCase() || ".wav";
      const name = i.segmentId ? `${i.segmentId}${ext}` : `take-${Date.now()}${ext}`;
      const rel = `${P.recordings(i.lang)}${name}`;
      await store.linkOrCopy(i.tmpPath, rel);
      return { rel, asset: null };
    }
    const declaration = this.rt.deps.assets.requireDeclaration(i.declaration);
    const asset = await this.rt.deps.assets.importUpload({ file: i.tmpPath, declaration, projectDir: store.dir }, await this.assetsCtx(store, project));
    return { rel: asset.projectRel, asset };
  }
  async resolveClip(slug: string, i: Parameters<Engine["resolveClip"]>[1]) {
    const store = await this.open(slug);
    const project = await readProject(store);
    const script = await docs.script(store, project.primaryLang);
    const seg = script?.chapters.flatMap((c) => c.segments).find((s) => s.id === i.segmentId);
    if (!seg || seg.type !== "clip" || !seg.quoteId) throw new DocmakerError("VALIDATION", `${i.segmentId} is not a clip segment of the ${project.primaryLang} script`);
    if (!i.url && !i.uploadRel) throw new DocmakerError("VALIDATION", "a manual clip needs a URL or an uploaded file");
    const r = await this.rt.deps.assets.resolveManualClip({
      projectDir: store.dir, segmentId: i.segmentId, quoteId: seg.quoteId, url: i.url, file: i.uploadRel ? store.abs(i.uploadRel) : null,
      startMs: i.startMs, endMs: i.endMs, channel: i.channel, title: i.title, fps: project.video.fps,
    }, await this.assetsCtx(store, project));
    const cur = (await docs.userPicks(store)) ?? { schemaVersion: 1 as const, picks: [], portraits: [], clips: [] };
    const next = { ...cur, clips: [...cur.clips.filter((c) => c.segmentId !== i.segmentId), r.clip] };
    const w = await writeUserDoc(this.rt, store, P.userPicks, UserPicksDoc, next, await store.etag(P.userPicks));
    const issues = [...w.issues];
    if (project.assets.maxClipSeconds && i.endMs - i.startMs > project.assets.maxClipSeconds * 1000) {
      issues.push({ level: "warn", rule: "CLIP_LONG", where: i.segmentId, msg: `the clip lasts ${((i.endMs - i.startMs) / 1000).toFixed(1)} s (> maxClipSeconds ${project.assets.maxClipSeconds})` });
    }
    return { issues };
  }

  // ---------------------------------------------------------------- environment
  async doctor() {
    this.rt.refresh();
    return runDoctor(this.rt, { probeNetwork: true });
  }
  homeConfig(): Promise<HomeConfig> {
    return readHomeConfig(this.rt.config);
  }
  setHomeConfig(patch: Partial<Omit<HomeConfig, "schemaVersion">>): Promise<HomeConfig> {
    return writeHomeConfig(this.rt.config, patch);
  }
  async setSecret(name: string, value: string): Promise<void> {
    const key = secretNameOf(name);
    await ensureHome(this.rt.config);
    await writeSecret(this.rt.config.paths.home, ENV_KEYS[key], value.trim());
    this.rt.refresh();
  }
  async testKey(name: string): Promise<{ ok: boolean; tier: string | null; message: string }> {
    const key = secretNameOf(name);
    this.rt.refresh();
    const value = this.rt.secrets[key];
    if (!value) return { ok: false, tier: null, message: `${ENV_KEYS[key]} is not set` };
    if (this.rt.config.offline) return { ok: false, tier: null, message: "offline: not tested" };
    const t = KEY_TESTS[key];
    if (!t) return { ok: true, tier: null, message: "present (this key has no free verification endpoint)" };
    const { url, headers } = t(value);
    try {
      const res = await fetch(url, { headers: { ...headers, "User-Agent": this.rt.config.userAgentBase }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, tier: null, message: `rejected (HTTP ${res.status})` };
      if (!res.ok) return { ok: false, tier: null, message: `HTTP ${res.status}` };
      let tier: string | null = null;
      if (key === "elevenlabs") tier = ((await res.json().catch(() => ({}))) as { tier?: string }).tier ?? null;
      return { ok: true, tier, message: tier ? `ok (tier ${tier})` : "ok" };
    } catch (e) {
      return { ok: false, tier: null, message: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** Additive (CLI): creates the demo project and submits its pipeline job without waiting. */
  async startDemo(opts: DemoOptions): Promise<{ slug: string; jobId: string; mp4: string; exportDir: string; langs: Lang[]; preset: RenderPresetId }> {
    const o: DemoOptions = { ...opts, langs: opts.langs?.length ? opts.langs : ["en"], preset: (opts.preset ?? "draft") as RenderPresetId };
    const plan = await createDemoProject(this.rt, o);
    const { jobId } = await this.submit({
      slug: plan.project.slug, kind: "demo", stage: null, from: "research", to: "qa", langs: plan.langs, force: false,
      options: plan.onlyChapters ? { onlyChapters: plan.onlyChapters } : {}, preset: plan.preset,
    });
    const outs = demoOutputs(path.join(this.rt.config.projectsDir, plan.project.slug), plan.langs[0]!, plan.preset);
    return { slug: plan.project.slug, jobId, ...outs, langs: plan.langs, preset: plan.preset };
  }

  async runDemo(opts: DemoOptions): Promise<{ slug: string; jobId: string; mp4: string; exportDir: string }> {
    const d = await this.startDemo(opts);
    const rec = await this.waitForJob(d.jobId);
    if (rec.status !== "succeeded") {
      throw new DocmakerError(rec.error?.code ?? (rec.status === "canceled" ? "CANCELED" : rec.status === "waiting-approval" ? "GATE_REQUIRED" : "INTERNAL"),
        `the demo job ${d.jobId} ended ${rec.status}${rec.error ? `: ${rec.error.message}` : ""}`, { details: { slug: d.slug, jobId: d.jobId } });
    }
    return { slug: d.slug, jobId: d.jobId, mp4: d.mp4, exportDir: d.exportDir };
  }

  // ---------------------------------------------------------------- additive helpers (CLI / web)
  private async transcreateInputs(slug: string, lang: Lang, segmentId: string) {
    const store = await this.open(slug);
    const project = await readProject(store);
    if (lang === project.primaryLang) throw new DocmakerError("VALIDATION", `${lang} is the primary language`);
    if (!project.languages.includes(lang)) throw new DocmakerError("VALIDATION", `${lang} is not a language of ${slug}`);
    const primary = await docs.script(store, project.primaryLang);
    const cur = await this.readDoc(slug, P.script(lang), ScriptSchema).catch(() => null);
    const facts = await docs.factsheet(store);
    if (!primary || !cur || !facts) throw new DocmakerError("UPSTREAM_MISSING", "both scripts and the fact sheet are needed", { hint: "run the script stage for both languages" });
    const pSeg = primary.chapters.flatMap((c) => c.segments).find((s) => s.id === segmentId);
    const cSeg = cur.value.chapters.flatMap((c) => c.segments).find((s) => s.id === segmentId);
    if (!pSeg || !cSeg) throw new DocmakerError("VALIDATION", `segment ${segmentId} is not in both scripts`);
    return { store, project, cur, facts, pSeg, cSeg };
  }

  /**
   * Cost estimate of one segment transcreation (§6.2 6t: cost-gated per segment). The plan hash binds the approval to
   * this segment's current primary and secondary texts.
   */
  async estimateTranscreate(slug: string, lang: Lang, segmentId: string): Promise<{ planHash: string; totalUsd: number; lines: CostEstimate["lines"]; approved: boolean }> {
    const { store, project, facts, pSeg, cSeg } = await this.transcreateInputs(slug, lang, segmentId);
    const lines = project.llm.provider === "fixture" ? [] : this.rt.deps.llm.estimateStepCost("transcreate", {
      // the system prompt carries the style pack and the whole fact sheet; output: display text + subtitle translation
      inputChars: 8_000 + canonicalJson(facts).length + 2 * (pSeg.displayText.length + cSeg.displayText.length + pSeg.subtitleTranslation.length),
      outputChars: Math.max(600, 3 * (pSeg.displayText.length + pSeg.subtitleTranslation.length)), cachedChars: 0, lang,
    });
    const totalUsd = Math.round(lines.reduce((a, l) => a + l.totalUsd, 0) * 1e6) / 1e6;
    const planHash = hashJson({ op: "transcreate", lang, segmentId, primary: pSeg.displayText, current: cSeg.displayText, lines, totalUsd });
    const approvals = (await docs.approvals(store)).approvals;
    const approved = totalUsd === 0 || totalUsd <= project.budget.autoApproveUnderUsd || approvals.some((a) => a.gate === "cost" && (a.planHash === planHash || a.items.includes(planHash)));
    return { planHash, totalUsd, lines, approved };
  }

  /**
   * "Out of sync" secondary segment (§5.3): re-transcreate it from the current primary segment (cheap LLM call behind the
   * cost gate, receipt recorded), set primaryHash, rebuild ttsText, save as a user edit. Returns the new text and the
   * lint/fact-check issues. Throws GATE_REQUIRED (details {gate:"cost", planHash, totalUsd}) until the estimate is
   * approved (`approve cost --plan <planHash>`) unless it is under the project's auto-approve threshold.
   */
  async transcreate(slug: string, lang: Lang, segmentId: string): Promise<{ displayText: string; issues: LintIssue[] }> {
    const est = await this.estimateTranscreate(slug, lang, segmentId);
    const { store, project, cur, facts, pSeg, cSeg } = await this.transcreateInputs(slug, lang, segmentId);
    if (!est.approved) {
      throw new DocmakerError("GATE_REQUIRED", `transcreating ${segmentId} (${lang}) is estimated at $${est.totalUsd.toFixed(3)}: it needs a cost approval`, {
        hint: `docmaker approve ${slug} cost --stage script --lang ${lang} --plan ${est.planHash}   (or --yes / --max-cost)`,
        details: { gate: "cost", stage: "script", lang, planHash: est.planHash, totalUsd: est.totalUsd },
      });
    }
    // record an auto-threshold approval only when the threshold is what approved it (not an existing approval, by planHash or items)
    const covered = (await docs.approvals(store)).approvals.some((a) => a.gate === "cost" && (a.planHash === est.planHash || a.items.includes(est.planHash)));
    if (est.totalUsd > 0 && est.totalUsd <= project.budget.autoApproveUnderUsd && !covered) {
      await persistApproval(this.rt, store, "cost", {
        stage: "script", lang, planHash: est.planHash, by: "auto-threshold", items: [est.planHash], itemNotes: {},
        note: `transcreate ${segmentId}: estimate $${est.totalUsd.toFixed(3)} ≤ auto-approve threshold $${project.budget.autoApproveUnderUsd.toFixed(2)}`,
      }, { fixtureAllowed: false, stage: "script" });
    }
    this.rt.refresh();
    const style = await this.getStyle(project.styleId ?? "drama-commentary");
    const costs = await ProjectCosts.open(store, project, null, () => {});
    costs.setApproved("script", lang, est.totalUsd); // overrun rule (§5.4) against this estimate
    const r = await this.rt.deps.llm.transcreateSegment(
      { llm: this.rt.llmFor(project), signal: new AbortController().signal, costs, logger: this.rt.logger, progress: () => {}, newRequest: false },
      { primary: pSeg, current: cSeg, lang, style, factSheet: facts },
    );
    const next = structuredClone(cur.value);
    for (const ch of next.chapters) {
      ch.segments = ch.segments.map((s) => (s.id === segmentId
        ? { ...s, displayText: r.displayText, subtitleTranslation: r.subtitleTranslation, primaryHash: hashJson(pSeg.displayText), ttsTextEdited: false, ttsText: "" }
        : s));
    }
    const w = await writeUserDoc(this.rt, store, P.script(lang), ScriptSchema, next, cur.etag);
    return { displayText: r.displayText, issues: w.issues };
  }

  /** Saved research turns of a project and whether the next research run resumes from them (CLI `research --resume`). */
  async researchResume(slug: string): Promise<ResearchResumeInfo> {
    const store = await this.open(slug);
    return researchResumeInfo(store, await readProject(store));
  }

  /** Voices of a TTS provider (static lists for kokoro/piper/synthetic; ElevenLabs needs its key and the network). */
  async listVoices(provider: VoiceProviderId, lang: Lang | null): Promise<VoiceInfo[]> {
    this.rt.refresh();
    if (provider === "recording") return [];
    if (provider === "elevenlabs" && (this.rt.config.offline || !this.rt.secrets.elevenlabs)) return [];
    const p = this.rt.deps.voice.createTtsProvider(provider, { config: this.rt.config, secrets: this.rt.secrets, logger: this.rt.logger });
    return p.listVoices(lang ?? undefined);
  }

  /** Every take of a language (newest first), scratch and final. */
  async listTakes(slug: string, lang: Lang): Promise<VoiceTrack[]> {
    const store = await this.open(slug);
    let names: string[] = [];
    try {
      names = (await readdir(store.abs(`voice/${lang}`))).filter((n) => /^(take|scratch)-[a-f0-9]{12}$/.test(n));
    } catch {
      return [];
    }
    const out: VoiceTrack[] = [];
    for (const n of names) {
      const t = await docs.take(store, lang, n).catch(() => null);
      if (t) out.push(t);
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
  }

  /** Which provider keys are set (masked values only; never the secrets). */
  async secretStatus(): Promise<{ name: keyof typeof ENV_KEYS; env: string; set: boolean; masked: string }[]> {
    this.rt.refresh();
    return (Object.entries(ENV_KEYS) as [keyof typeof ENV_KEYS, string][]).map(([name, env]) => ({ name, env, set: !!this.rt.secrets[name], masked: maskSecret(this.rt.secrets[name]) }));
  }

  async importLocalDir(slug: string, i: { dir: string; declaration: UploadDeclaration | null; tags: string[] }): Promise<LocalIndexDoc> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const declaration = this.rt.deps.assets.requireDeclaration(i.declaration);
    const previous = await store.readJsonOrNull(P.localIndex, LocalIndexDoc);
    const doc = await this.rt.deps.assets.importLocalDir({ dir: i.dir, declaration, tags: i.tags, projectDir: store.dir, previous }, await this.assetsCtx(store, project));
    await store.writeJson(P.localIndex, LocalIndexDoc, doc, { writer: "user" });
    return doc;
  }

  async calibrate(slug: string, lang: Lang): Promise<{ charsPerSec: number }> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const voice = project.voice[lang];
    if (!voice) throw new DocmakerError("VALIDATION", `${lang} is not a project language`);
    const r = await this.rt.deps.voice.calibrateVoice({ lang, voice, projectDir: store.dir }, {
      config: this.rt.config, secrets: this.rt.secrets, logger: this.rt.logger, signal: new AbortController().signal, progress: () => {}, costs: await ProjectCosts.open(store, project, null, () => {}),
    });
    await updateProjectDoc(store, { voice: { ...project.voice, [lang]: { ...voice, charsPerSec: r.charsPerSec } } }, "user");
    return r;
  }

  async teleprompter(slug: string, lang: Lang, o: { mirror: boolean }): Promise<string> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const script = await docs.script(store, lang);
    if (!script) throw new DocmakerError("UPSTREAM_MISSING", `no ${lang} script yet`, { hint: "run the script stage first" });
    const style = await this.getStyle(project.styleId ?? "drama-commentary").catch(() => null);
    const cps = project.voice[lang]?.charsPerSec ?? style?.data.scriptProfile.charsPerSec[lang] ?? 15;
    const take = await docs.activeTake(store, lang).then((a) => (a ? docs.take(store, lang, a.takeId) : null));
    const html = this.rt.deps.voice.teleprompterHtml(script, { cps, mirror: o.mirror, lang, outdated: take ? this.rt.deps.voice.editedAfterTake(script, take) : [] });
    const rel = P.teleprompter(lang);
    await mkdir(path.dirname(store.abs(rel)), { recursive: true });
    await writeFile(store.abs(rel), html);
    return store.abs(rel);
  }

  async costReport(slug: string): Promise<{ receipts: { stage: StageId; lang: Lang | null; usd: number; calls: number }[]; totalUsd: number; maxUsdTotal: number; maxUsdPerStage: number; estimates: CostEstimate[] }> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const receipts = await readReceipts(store);
    const by = new Map<string, { stage: StageId; lang: Lang | null; usd: number; calls: number }>();
    for (const r of receipts) {
      const k = `${r.stage}|${r.lang ?? ""}`;
      const cur = by.get(k) ?? { stage: r.stage, lang: r.lang, usd: 0, calls: 0 };
      cur.usd += r.costUsd;
      cur.calls += 1;
      by.set(k, cur);
    }
    const estimates: CostEstimate[] = [];
    for (const def of STAGE_LIST) {
      for (const lang of def.perLang ? project.languages : [null]) {
        const e = await store.readJsonOrNull(P.estimate(def.id, lang), CostEstimateSchema).catch(() => null);
        if (e) estimates.push(e);
      }
    }
    return { receipts: [...by.values()], totalUsd: receipts.reduce((a, r) => a + r.costUsd, 0), maxUsdTotal: project.budget.maxUsdTotal, maxUsdPerStage: project.budget.maxUsdPerStage, estimates };
  }

  async credits(slug: string, lang: Lang): Promise<string> {
    const store = await this.open(slug);
    const ledger = (await docs.ledger(store)) ?? { schemaVersion: 1 as const, entries: [] };
    const usage = (await docs.usage(store, lang)) ?? { schemaVersion: 1 as const, lang, usage: [] };
    const music = (await docs.music(store)) ?? { schemaVersion: 1 as const, tracks: [] };
    const voice = await docs.activeTake(store, lang).then((a) => (a ? docs.take(store, lang, a.takeId) : null));
    const project = await readProject(store);
    let sfx: import("@docmaker/core").SfxEntry[] = [];
    try {
      sfx = await this.rt.deps.audio.loadSfxEntries(project.audio.sfxPacks, { config: this.rt.config, logger: this.rt.logger, signal: new AbortController().signal, progress: () => {} });
    } catch { /* packs not generated */ }
    const used = new Set(usage.usage.map((u) => u.assetId));
    return this.rt.deps.assets.buildCredits({ ledger, usage, lang, voice, music, sfx: sfx.filter((x) => used.has(x.assetId)) });
  }

  /**
   * `factcheck --recheck`: re-research pending claims (LLM, receipts recorded). A claim whose status changed is updated in the
   * fact sheet (asOf = today; the script and fact-check become stale, as they should). Unchanged claims leave the fact sheet
   * untouched (no needless re-outlining) and are recorded as a dated recheck approval, valid for 30 days.
   */
  async recheckClaims(slug: string, by: "cli" | "web" = "cli"): Promise<{ changed: string[]; checked: string[]; omitted: string[] }> {
    const store = await this.open(slug);
    const project = await readProject(store);
    const facts = await docs.factsheet(store);
    if (!facts) throw new DocmakerError("UPSTREAM_MISSING", "no fact sheet yet", { hint: "run the research stage first" });
    const pending = await pendingClaims(store, project, new Date(8.64e15));
    const ids = pending.map((c) => c.id);
    if (ids.length === 0) return { changed: [], checked: [], omitted: [] };
    this.rt.refresh();
    const costs = await ProjectCosts.open(store, project, null, () => {});
    const llm = this.rt.llmFor(project);
    const today = new Date().toISOString().slice(0, 10);
    const r = await this.rt.deps.llm.recheck({ llm, signal: new AbortController().signal, costs, logger: this.rt.logger, progress: () => {}, newRequest: false }, { factSheet: facts, claimIds: ids, asOf: today });
    if (r.changed.length) {
      const next = { ...r.factSheet, claims: r.factSheet.claims.map((c) => (r.changed.includes(c.id) ? { ...c, asOf: today } : c)) };
      await store.writeJson(P.factsheet, FactSheetSchema, next, { writer: "user" });
    }
    // only claims the re-check output actually covered count as re-checked; omitted ones stay pending (the gate holds)
    const covered = new Set(r.checked);
    const unchanged = ids.filter((id) => covered.has(id) && !r.changed.includes(id));
    const omitted = ids.filter((id) => !covered.has(id));
    if (omitted.length) this.rt.logger.warn("the re-check output omitted claims: they stay pending", { claims: omitted });
    if (unchanged.length) {
      await persistApproval(this.rt, store, "recheck", {
        stage: "render", lang: null, planHash: "", by, note: `re-checked on ${today}: status unchanged`, items: unchanged, itemNotes: {},
      }, { fixtureAllowed: false, stage: "render" });
    }
    return { changed: r.changed, checked: ids.filter((id) => covered.has(id)), omitted };
  }

  async cacheGc(o: { dryRun: boolean }): Promise<{ removed: number; freedBytes: number; totalBytes: number; capBytes: number }> {
    const config = this.rt.config;
    const referenced = await this.rt.deps.assets.collectReferencedBlobs(config.projectsDir);
    const capBytes = await cacheCapBytes(config);
    const cache = this.rt.deps.assets.createFrozenCache({ config, logger: this.rt.logger });
    const ix = await cache.readIndex();
    const totalBytes = ix.blobs.reduce((a, b) => a + b.bytes, 0);
    if (o.dryRun) {
      let over = totalBytes - capBytes;
      let removed = 0;
      let freedBytes = 0;
      for (const b of [...ix.blobs].sort((x, y) => (x.lastUsed < y.lastUsed ? -1 : 1))) {
        if (referenced.has(b.sha256)) continue;
        removed++;
        freedBytes += b.bytes;
        over -= b.bytes;
        if (over <= 0) break;
      }
      return totalBytes > capBytes ? { removed, freedBytes, totalBytes, capBytes } : { removed: 0, freedBytes: 0, totalBytes, capBytes };
    }
    const r = await cache.gc({ referenced, capBytes });
    return { ...r, totalBytes, capBytes };
  }

  /** Additive (CLI `setup`): installs one optional component; returns a short description of what is in place. */
  async setupComponent(what: SetupComponent, arg: string | null, o: { signal: AbortSignal; progress: (pct: number, msg: string) => void }): Promise<string> {
    const config = this.rt.config;
    await ensureHome(config);
    const progress = (pct: number, msg: string) => o.progress(pct, msg);
    switch (what) {
      case "sfx": {
        const pack = arg === "remotion" ? "remotion-sfx-cc0" : (arg ?? "procedural");
        if (!["procedural", "remotion-sfx-cc0", "hyperframes-pixabay", "user"].includes(pack)) throw new DocmakerError("VALIDATION", `unknown SFX pack ${pack}`);
        const m = await this.rt.deps.audio.ensureSfxPack(pack as "procedural", { config, logger: this.rt.logger, signal: o.signal, progress });
        return `${m.entries.length} sounds (${m.pack} ${m.version})`;
      }
      case "tts": {
        if (!arg) throw new DocmakerError("VALIDATION", "--tts needs kokoro or piper:<voice>");
        const dir = await this.rt.deps.voice.ensureModel(arg, { config, secrets: this.rt.secrets, logger: this.rt.logger, signal: o.signal, progress, costs: looseCosts() });
        return dir;
      }
      case "python":
      case "yt-dlp":
        return this.setupPython(o.signal);
      case "whisper": {
        if (arg === "whisper-cpp") return this.rt.deps.voice.installWhisperCppRuntime(config, o.signal);
        if (arg && arg !== "faster-whisper") throw new DocmakerError("VALIDATION", "--whisper must be faster-whisper or whisper-cpp");
        const venv = await this.setupPython(o.signal);
        const dir = await this.rt.deps.voice.ensureFasterWhisperModel(config, o.signal, { model: FASTER_WHISPER_MODEL, onProgress: progress });
        return `${venv}; faster-whisper ${FASTER_WHISPER_MODEL} in ${dir}`;
      }
      case "clip":
        throw new DocmakerError("TOOL_MISSING", "the CLIP runtime is a later milestone (M3)", { hint: "vision rerank works without it" });
    }
  }

  private async setupPython(signal: AbortSignal): Promise<string> {
    const config = this.rt.config;
    const pyDir = path.join(config.repoRoot, "python");
    const lock = existsSync(path.join(pyDir, "uv.lock"));
    const r = await run("uv", ["sync", "--project", pyDir, ...(lock ? ["--locked"] : [])], {
      signal, timeoutMs: 30 * 60_000, env: { ...this.rt.env, UV_PROJECT_ENVIRONMENT: config.paths.pyVenv },
    }).catch((e: unknown) => {
      if ((e as { code?: string }).code === "TOOL_MISSING") throw new DocmakerError("TOOL_MISSING", "uv is not installed", { hint: "install uv: https://docs.astral.sh/uv/getting-started/installation/" });
      throw e;
    });
    if (r.code !== 0) throw new DocmakerError("TOOL_MISSING", `uv sync failed: ${r.stderr.split("\n").filter(Boolean).slice(-4).join(" | ")}`);
    return `${config.paths.pyVenv} (faster-whisper, yt-dlp)`;
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.jobs.close();
  }
}

export type SetupComponent = "sfx" | "tts" | "python" | "yt-dlp" | "whisper" | "clip";

export type EngineExt = Engine & {
  researchResume(slug: string): Promise<ResearchResumeInfo>;
  transcreate(slug: string, lang: Lang, segmentId: string): Promise<{ displayText: string; issues: LintIssue[] }>;
  estimateTranscreate(slug: string, lang: Lang, segmentId: string): Promise<{ planHash: string; totalUsd: number; lines: CostEstimate["lines"]; approved: boolean }>;
  listVoices(provider: VoiceProviderId, lang: Lang | null): Promise<VoiceInfo[]>;
  listTakes(slug: string, lang: Lang): Promise<VoiceTrack[]>;
  secretStatus(): Promise<{ name: keyof typeof ENV_KEYS; env: string; set: boolean; masked: string }[]>;
  importLocalDir(slug: string, i: { dir: string; declaration: UploadDeclaration | null; tags: string[] }): Promise<LocalIndexDoc>;
  calibrate(slug: string, lang: Lang): Promise<{ charsPerSec: number }>;
  teleprompter(slug: string, lang: Lang, o: { mirror: boolean }): Promise<string>;
  costReport(slug: string): Promise<{ receipts: { stage: StageId; lang: Lang | null; usd: number; calls: number }[]; totalUsd: number; maxUsdTotal: number; maxUsdPerStage: number; estimates: CostEstimate[] }>;
  credits(slug: string, lang: Lang): Promise<string>;
  recheckClaims(slug: string, by?: "cli" | "web"): Promise<{ changed: string[]; checked: string[]; omitted: string[] }>;
  cacheGc(o: { dryRun: boolean }): Promise<{ removed: number; freedBytes: number; totalBytes: number; capBytes: number }>;
  setupComponent(what: SetupComponent, arg: string | null, o: { signal: AbortSignal; progress: (pct: number, msg: string) => void }): Promise<string>;
  readonly rt: Runtime; readonly jobs: JobManager;
  waitForJob(jobId: string): Promise<JobRecord>;
  startDemo(opts: DemoOptions): Promise<{ slug: string; jobId: string; mp4: string; exportDir: string; langs: Lang[]; preset: RenderPresetId }>;
};

export async function createEngineImpl(opts: EngineOptions): Promise<EngineExt> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? env.DOCMAKER_REPO_ROOT ?? process.cwd();
  const rt = createRuntime({ cwd, env, deps: opts.deps ?? REAL_DEPS, renderClient: opts.renderClient, llmOverride: opts.llmOverride ?? null, logger: opts.logger });
  await ensureHome(rt.config);
  const engine = new EngineImpl(rt, opts);
  if (!opts.skipReconcile && opts.runner?.kind !== "worker") await engine.jobs.reconcileAll();
  return engine;
}
