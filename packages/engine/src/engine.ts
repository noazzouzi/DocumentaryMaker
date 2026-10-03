// createEngine (§4.19, §5.5): the Engine implementation (in-process runner; "worker" runner forwards jobs to a forked
// job worker, see worker.ts). Reads/writes/approvals/estimates/styles/assets run in the calling process.
import { existsSync } from "node:fs";
import path from "node:path";
import {
  DocmakerError, ENV_KEYS, P, UserPicksDoc, VARIANT_STAGES, canonicalJson, docEntryFor, hashJson, type Approval, type CostEstimate, type CostTracker, type GateId,
  type HomeConfig, type JobEvent, type JobRecord, type JobRequest, type Lang, type NewProjectInput, type PipelineEstimate, type Project,
  type RenderPresetId, type StageId, type StyleSuggestion,
} from "@docmaker/core";
import { ProjectStore, ensureHome, readHomeConfig, run, writeHomeConfig, writeSecret } from "@docmaker/core/node";
import type { z } from "zod";
import type { DemoOptions, Engine, EngineOptions, ImpactReport, StageStatus } from "./types";
import { REAL_DEPS } from "./deps";
import { createRuntime, type Runtime } from "./runtime";
import { JobManager, isTerminal } from "./jobs";
import { ProjectCosts } from "./costs";
import { docs } from "./docs";
import { STAGE_LIST, stageDef } from "./stages";
import { buildCtx, fixtureAutoApproves, fixtureOf, inputsHashOf, persistApproval, readProject, type StageInvocation } from "./runner";
import { pipelineEstimate, planInvocations, stageRange } from "./pipeline";
import { emptyStageState, findStage, readState } from "./state";
import { createProjectIn, listProjectsIn, updateProjectIn } from "./project";
import { writeUserDoc } from "./editing";
import { runDoctor } from "./doctor";
import { createDemoProject, demoOutputs } from "./demo";
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
      for (const a of after) {
        const b = before.find((x) => x.stage === a.stage && x.lang === a.lang && x.variant === a.variant);
        if (b && b.status === "done" && !b.stale && a.stale) staleStages.push({ stage: a.stage, lang: a.lang });
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
        return `${await this.setupPython(o.signal)} (faster-whisper downloads its model on first use into ${path.join(config.paths.models, "whisper")})`;
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
