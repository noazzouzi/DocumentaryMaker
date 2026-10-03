// Job lifecycle (§5.6): per-project FIFO, one job holding the project lock at a time (the render stage releases it after
// its snapshot), jobs/index.json at queue/start/end, every event appended to jobs/<id>.ndjson BEFORE it is emitted,
// coalescing of identical queued requests, crash reconciliation (INTERRUPTED), resume ("approve & continue"), cancel.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  DocmakerError, JobEvent, JobRecord, JobRequest, JobsIndex, P, canonicalJson,
  type JobEventInput, type JobStatus, type RenderClient,
} from "@docmaker/core";
import { ProjectStore, withFileLock } from "@docmaker/core/node";
import type { Runtime } from "./runtime";
import { ProjectCosts } from "./costs";
import { NEEDS_TAKE, pipelineEstimate, pipelineSummary, planInvocations } from "./pipeline";
import { costKey, readProject, runStage, type JobHandle, type StageInvocation } from "./runner";
import { docs } from "./docs";
import { JOB_ID_RE, errorInfo, newJobId, nowIso, pidAlive, sleep } from "./util";

const INDEX_KEEP = 200;
const TERMINAL: readonly JobStatus[] = ["waiting-approval", "succeeded", "failed", "canceled"];
export const isTerminal = (s: JobStatus): boolean => TERMINAL.includes(s);
/** Engines alive in this process (crash reconciliation treats jobs of a dead engine of this same pid as interrupted). */
const LIVE_ENGINES = new Set<string>();
const NEVER = new AbortController().signal;
const ownerRel = (jobId: string) => `jobs/${jobId}.owner.json`;

/** Canonical identity of a request for coalescing (§5.6). */
export function requestKey(r: JobRequest): string {
  return canonicalJson({ slug: r.slug, kind: r.kind, stage: r.stage, from: r.from, to: r.to, langs: [...r.langs].sort(), options: r.options, preset: r.preset, force: r.force });
}

/** FIFO in-process slot per project (pairs with the .lock file across processes). */
class Slot {
  private held = false;
  private waiters: (() => void)[] = [];
  acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held = true;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.held = false;
          const next = this.waiters.shift();
          if (next) next();
        });
      };
      if (!this.held) return grant();
      const w = () => {
        signal.removeEventListener("abort", onAbort);
        grant();
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new DocmakerError("CANCELED", "canceled while queued"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(w);
    });
  }
}

interface LiveJob {
  record: JobRecord;
  store: ProjectStore;
  controller: AbortController;
  seq: number;
  chain: Promise<void>;
  listeners: Set<() => void>;
  done: Promise<JobRecord>;
  resolveDone(r: JobRecord): void;
  coalesced: string[]; // ids of records coalesced into this one
}

export interface JobManagerOptions { engineId?: string; renderClient: RenderClient | null }

export class JobManager {
  readonly engineId: string;
  private readonly live = new Map<string, LiveJob>();
  private readonly slots = new Map<string, Slot>();
  private readonly slugOf = new Map<string, string>();
  private readonly renderClient: RenderClient | null;
  private readonly external = new Map<string, Set<() => void>>();
  private closed = false;

  constructor(private readonly rt: Runtime, o: JobManagerOptions) {
    this.engineId = o.engineId ?? randomUUID();
    this.renderClient = o.renderClient;
    LIVE_ENGINES.add(this.engineId);
  }

  private slot(slug: string): Slot {
    let s = this.slots.get(slug);
    if (!s) this.slots.set(slug, (s = new Slot()));
    return s;
  }

  // ------------------------------------------------------------ index
  async readIndex(store: ProjectStore): Promise<JobsIndex> {
    return (await store.readJsonOrNull(P.jobsIndex, JobsIndex).catch(() => null)) ?? { schemaVersion: 1, jobs: [] };
  }

  private async mutateIndex(store: ProjectStore, fn: (jobs: JobRecord[]) => JobRecord[]): Promise<void> {
    await withFileLock(store.abs("jobs/.index.lock"), `jobs:${process.pid}`, async () => {
      const ix = await this.readIndex(store);
      let jobs = fn(ix.jobs);
      if (jobs.length > INDEX_KEEP) {
        const active = jobs.filter((j) => !isTerminal(j.status));
        const ended = jobs.filter((j) => isTerminal(j.status)).slice(-Math.max(0, INDEX_KEEP - active.length));
        const keep = new Set([...active, ...ended].map((j) => j.id));
        jobs = jobs.filter((j) => keep.has(j.id));
      }
      await store.writeJson(P.jobsIndex, JobsIndex, { schemaVersion: 1, jobs }, { writer: "engine" });
    }, { signal: NEVER, pollMs: 20 });
  }

  private async saveRecord(store: ProjectStore, rec: JobRecord): Promise<void> {
    await this.mutateIndex(store, (jobs) => {
      const i = jobs.findIndex((j) => j.id === rec.id);
      if (i >= 0) jobs[i] = rec;
      else jobs.push(rec);
      return jobs;
    });
  }

  // ------------------------------------------------------------ events
  private emitFor(job: LiveJob, e: JobEventInput): void {
    const ev = JobEvent.parse({ ...e, jobId: job.record.id, seq: job.seq++, at: nowIso() });
    job.chain = job.chain
      .then(() => job.store.appendNdjson(P.jobEvents(job.record.id), ev))
      .catch((err: unknown) => this.rt.logger.error("cannot append a job event", { jobId: job.record.id, err: String(err) }))
      .then(() => {
        for (const l of job.listeners) l();
      });
  }

  /** Replays jobs/<id>.ndjson after `afterSeq`, then follows it live until the job-end event. */
  async *events(jobId: string, afterSeq = -1): AsyncIterable<JobEvent> {
    const slug = await this.findSlug(jobId);
    const store = await ProjectStore.open(this.rt.config.projectsDir, slug);
    const file = store.abs(P.jobEvents(jobId));
    let offset = 0;
    let carry = "";
    let terminalSince: number | null = null;
    for (;;) {
      let chunk = "";
      try {
        const fh = await open(file, "r");
        try {
          const { size } = await fh.stat();
          if (size > offset) {
            const buf = Buffer.alloc(size - offset);
            await fh.read(buf, 0, buf.length, offset);
            offset = size;
            chunk = buf.toString("utf8");
          }
        } finally {
          await fh.close();
        }
      } catch { /* not created yet */ }
      const text = carry + chunk;
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: JobEvent;
        try {
          ev = JobEvent.parse(JSON.parse(line));
        } catch {
          continue;
        }
        if (ev.seq > afterSeq) yield ev;
        if (ev.type === "job-end") return;
      }
      const live = this.live.get(jobId);
      if (!live) {
        const rec = await this.getJob(jobId);
        if (!rec) return;
        if (isTerminal(rec.status) && !chunk) {
          // the index turns terminal just before job-end is appended: give the line a moment, then stop
          terminalSince ??= Date.now();
          if (Date.now() - terminalSince > 2_000) return;
        }
      }
      await new Promise<void>((resolve) => {
        const ext = live ? null : this.external.get(jobId) ?? new Set<() => void>();
        if (ext) this.external.set(jobId, ext);
        const t = setTimeout(done, 250);
        function done() {
          clearTimeout(t);
          live?.listeners.delete(done);
          ext?.delete(done);
          resolve();
        }
        live?.listeners.add(done);
        ext?.add(done);
      });
    }
  }

  private async readIndexRecord(store: ProjectStore, jobId: string): Promise<JobRecord | null> {
    return (await this.readIndex(store)).jobs.find((j) => j.id === jobId) ?? null;
  }

  // ------------------------------------------------------------ lookup
  private async findSlug(jobId: string): Promise<string> {
    if (!JOB_ID_RE.test(jobId)) throw new DocmakerError("VALIDATION", `invalid job id ${jobId}`);
    const known = this.live.get(jobId)?.record.request.slug ?? this.slugOf.get(jobId);
    if (known) return known;
    const dir = this.rt.config.projectsDir;
    let slugs: string[] = [];
    try {
      slugs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch { /* no projects */ }
    for (const slug of slugs) {
      if (existsSync(path.join(dir, slug, P.jobEvents(jobId))) || existsSync(path.join(dir, slug, ownerRel(jobId)))) {
        this.slugOf.set(jobId, slug);
        return slug;
      }
      try {
        const ix = JSON.parse(await readFile(path.join(dir, slug, P.jobsIndex), "utf8")) as { jobs?: { id: string }[] };
        if (ix.jobs?.some((j) => j.id === jobId)) {
          this.slugOf.set(jobId, slug);
          return slug;
        }
      } catch { /* no index */ }
    }
    throw new DocmakerError("UPSTREAM_MISSING", `job ${jobId} not found`);
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const live = this.live.get(jobId);
    if (live) return structuredClone(live.record);
    let slug: string;
    try {
      slug = await this.findSlug(jobId);
    } catch {
      return null;
    }
    const store = await ProjectStore.open(this.rt.config.projectsDir, slug);
    return this.readIndexRecord(store, jobId);
  }

  async listJobs(slug: string): Promise<JobRecord[]> {
    const store = await ProjectStore.open(this.rt.config.projectsDir, slug);
    const ix = await this.readIndex(store);
    const byId = new Map(ix.jobs.map((j) => [j.id, j]));
    for (const l of this.live.values()) if (l.record.request.slug === slug) byId.set(l.record.id, structuredClone(l.record));
    return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }

  /** Wakes event followers of a job run by another process (pushed worker events). */
  poke(jobId: string): void {
    const ext = this.external.get(jobId);
    if (!ext) return;
    for (const l of [...ext]) l();
    if (ext.size === 0) this.external.delete(jobId);
  }

  liveIds(): string[] {
    return [...this.live.keys()];
  }

  liveJobsOf(slug: string): JobRecord[] {
    return [...this.live.values()].filter((l) => l.record.request.slug === slug).map((l) => structuredClone(l.record));
  }

  /** Resolves when the job reaches a terminal status (in this process). */
  async wait(jobId: string): Promise<JobRecord> {
    const live = this.live.get(jobId);
    if (live) return live.done;
    const rec = await this.getJob(jobId);
    if (!rec) throw new DocmakerError("UPSTREAM_MISSING", `job ${jobId} not found`);
    if (isTerminal(rec.status)) return rec;
    for (;;) {
      await sleep(250);
      const r = await this.getJob(jobId);
      if (!r || isTerminal(r.status)) return r ?? rec;
    }
  }

  // ------------------------------------------------------------ crash reconciliation
  /** Marks queued|running jobs whose owner process (or engine) is gone as failed INTERRUPTED; takes over stale locks. */
  async reconcile(slug: string): Promise<string[]> {
    let store: ProjectStore;
    try {
      store = await ProjectStore.open(this.rt.config.projectsDir, slug);
    } catch {
      return [];
    }
    const ix = await this.readIndex(store);
    const dead: JobRecord[] = [];
    for (const j of ix.jobs) {
      // coalesced records follow their target (updated with it, below)
      if (isTerminal(j.status) || this.live.has(j.id) || j.coalescedInto) continue;
      let owner: { pid?: number; engineId?: string } | null = null;
      try {
        owner = JSON.parse(await readFile(store.abs(ownerRel(j.id)), "utf8")) as { pid?: number; engineId?: string };
      } catch { /* missing */ }
      const pid = owner?.pid ?? -1;
      const gone = pid <= 0 || !pidAlive(pid) || (pid === process.pid && !LIVE_ENGINES.has(owner?.engineId ?? ""));
      if (gone) dead.push(j);
    }
    if (dead.length === 0) return [];
    const deadIds = new Set(dead.map((j) => j.id));
    const at = nowIso();
    for (const j of dead) {
      if (j.coalescedInto) continue;
      const lines = await readFile(store.abs(P.jobEvents(j.id)), "utf8").catch(() => "");
      let seq = lines.split("\n").filter((l) => l.trim()).length;
      const message = "the process running this job exited before it finished";
      await store.appendNdjson(P.jobEvents(j.id), JobEvent.parse({ jobId: j.id, seq: seq++, at, type: "error", stage: null, code: "INTERRUPTED", message, retryable: true, hint: "resume the job" }));
      await store.appendNdjson(P.jobEvents(j.id), JobEvent.parse({ jobId: j.id, seq: seq++, at, type: "job-end", status: "failed" }));
      await rm(store.abs(ownerRel(j.id)), { force: true });
    }
    await this.mutateIndex(store, (jobs) => jobs.map((j) => (deadIds.has(j.id) || (j.coalescedInto && deadIds.has(j.coalescedInto) && !isTerminal(j.status))
      ? { ...j, status: "failed" as const, endedAt: at, error: { code: "INTERRUPTED" as const, message: "the process running this job exited before it finished" } }
      : j)));
    // a lock left by an interrupted job of this same process (dead engine) is not taken over by ProjectStore (pid alive)
    try {
      const body = JSON.parse(await readFile(store.abs(P.lock), "utf8")) as { pid?: number; jobId?: string };
      if (body.jobId && deadIds.has(body.jobId) && (body.pid === process.pid || !pidAlive(body.pid ?? -1))) await unlink(store.abs(P.lock));
    } catch { /* no lock */ }
    return [...deadIds];
  }

  async reconcileAll(): Promise<string[]> {
    const dir = this.rt.config.projectsDir;
    let slugs: string[] = [];
    try {
      slugs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, P.jobsIndex))).map((d) => d.name);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const s of slugs) out.push(...(await this.reconcile(s)));
    return out;
  }

  // ------------------------------------------------------------ submit / resume / cancel
  async submit(reqIn: JobRequest, o: { resumeOf?: string | null } = {}): Promise<{ jobId: string; coalesced: boolean }> {
    if (this.closed) throw new DocmakerError("INTERNAL", "the engine is closed");
    const req = JobRequest.parse(reqIn);
    if (req.kind === "setup") throw new DocmakerError("VALIDATION", "setup jobs are run by the CLI, not the pipeline runner");
    const store = await ProjectStore.open(this.rt.config.projectsDir, req.slug);
    await this.reconcile(req.slug);
    // validate the plan now so a bad request fails at submit time
    planInvocations(await readProject(store), req);
    const key = requestKey(req);
    const target = [...this.live.values()].find((l) => l.record.status === "queued" && l.record.request.slug === req.slug && requestKey(l.record.request) === key);
    const id = newJobId();
    const record: JobRecord = { id, request: req, status: "queued", createdAt: nowIso(), startedAt: null, endedAt: null, error: null, coalescedInto: target?.record.id ?? null, resumeOf: o.resumeOf ?? null };
    this.slugOf.set(id, req.slug);
    if (target) {
      target.coalesced.push(id);
      await this.saveRecord(store, record);
      return { jobId: target.record.id, coalesced: true };
    }
    let resolveDone!: (r: JobRecord) => void;
    const done = new Promise<JobRecord>((r) => (resolveDone = r));
    const job: LiveJob = { record, store, controller: new AbortController(), seq: 0, chain: Promise.resolve(), listeners: new Set(), done, resolveDone, coalesced: [] };
    this.live.set(id, job);
    await mkdir(store.abs("jobs"), { recursive: true });
    await writeFile(store.abs(ownerRel(id)), JSON.stringify({ pid: process.pid, engineId: this.engineId, at: record.createdAt }));
    await this.saveRecord(store, record);
    void this.execute(job);
    return { jobId: id, coalesced: false };
  }

  async resume(jobId: string): Promise<{ jobId: string }> {
    const rec = await this.getJob(jobId);
    if (!rec) throw new DocmakerError("UPSTREAM_MISSING", `job ${jobId} not found`);
    if (rec.coalescedInto) return this.resume(rec.coalescedInto);
    if (!isTerminal(rec.status)) throw new DocmakerError("VALIDATION", `job ${jobId} is ${rec.status}`, { hint: "wait for it to end (or cancel it)" });
    if (rec.status === "succeeded") throw new DocmakerError("VALIDATION", `job ${jobId} already succeeded`);
    const r = await this.submit(rec.request, { resumeOf: jobId });
    return { jobId: r.jobId };
  }

  async cancel(jobId: string): Promise<void> {
    const live = this.live.get(jobId);
    if (live) {
      live.controller.abort();
      await live.done;
      return;
    }
    const rec = await this.getJob(jobId);
    if (!rec) throw new DocmakerError("UPSTREAM_MISSING", `job ${jobId} not found`);
    if (rec.coalescedInto) return this.cancel(rec.coalescedInto);
    if (!isTerminal(rec.status)) {
      throw new DocmakerError("LOCKED", `job ${jobId} runs in another process`, { hint: "cancel it from the process that runs it (web: the job worker)" });
    }
  }

  // ------------------------------------------------------------ execution
  private async execute(job: LiveJob): Promise<void> {
    const { store } = job;
    const signal = job.controller.signal;
    const emit = (e: JobEventInput) => this.emitFor(job, e);
    let releaseSlot: (() => void) | null = null;
    let releaseFile: (() => Promise<void>) | null = null;
    const ensureLock = async () => {
      if (releaseSlot) return;
      releaseSlot = await this.slot(job.record.request.slug).acquire(signal);
      let warned = false;
      for (;;) {
        try {
          releaseFile = await store.lock(`docmaker:${process.pid}`, job.record.id);
          break;
        } catch (err) {
          if (!(err instanceof DocmakerError) || err.code !== "LOCKED") {
            releaseSlot();
            releaseSlot = null;
            throw err;
          }
          if (!warned && job.record.status === "running") {
            warned = true;
            emit({ type: "log", level: "info", stage: null, message: `waiting for the project lock (${err.message})` });
          }
          try {
            await sleep(500, signal);
          } catch (e) {
            releaseSlot();
            releaseSlot = null;
            throw e;
          }
        }
      }
    };
    const releaseLock = async () => {
      const f = releaseFile;
      releaseFile = null;
      if (f) await f().catch(() => undefined);
      const s = releaseSlot;
      releaseSlot = null;
      s?.();
    };

    let status: JobStatus = "failed";
    let error: { code: import("@docmaker/core").ErrorCode; message: string } | null = null;
    try {
      await ensureLock();
      job.record = { ...job.record, status: "running", startedAt: nowIso() };
      await this.saveRecord(store, job.record);
      emit({ type: "job-start", request: job.record.request });
      status = await this.runPlan(job, emit, ensureLock, releaseLock);
    } catch (err) {
      const info = errorInfo(err);
      if (info.code === "CANCELED" || signal.aborted) {
        status = "canceled";
        error = null;
        emit({ type: "log", level: "info", stage: null, message: "canceled" });
      } else {
        status = "failed";
        error = { code: info.code, message: info.message };
        emit({ type: "error", stage: (err as { stage?: import("@docmaker/core").StageId }).stage ?? null, code: info.code, message: info.message, retryable: info.retryable, hint: info.hint });
        this.rt.logger.error("job failed", { jobId: job.record.id, code: info.code, message: info.message });
      }
    }
    await job.chain;
    await releaseLock();
    // the index says terminal BEFORE job-end is emitted: a follower that saw job-end reads a terminal record
    job.record = { ...job.record, status, endedAt: nowIso(), error };
    const ended = job.record;
    await this.mutateIndex(store, (jobs) => {
      const out = jobs.map((j) => (j.id === ended.id ? ended : job.coalesced.includes(j.id) ? { ...j, status, startedAt: ended.startedAt, endedAt: ended.endedAt, error } : j));
      if (!out.some((j) => j.id === ended.id)) out.push(ended);
      return out;
    }).catch((e: unknown) => this.rt.logger.error("cannot update jobs/index.json", { err: String(e) }));
    emit({ type: "job-end", status });
    await job.chain;
    await rm(store.abs(ownerRel(job.record.id)), { force: true }).catch(() => undefined);
    this.live.delete(job.record.id);
    for (const l of job.listeners) l();
    job.resolveDone(structuredClone(ended));
  }

  private async runPlan(job: LiveJob, emit: (e: JobEventInput) => void, ensureLock: () => Promise<void>, releaseLock: () => Promise<void>): Promise<JobStatus> {
    const { store } = job;
    const req = job.record.request;
    const signal = job.controller.signal;
    const project = await readProject(store);
    const plan = planInvocations(project, req);
    const costs = await ProjectCosts.open(store, project, job.record.id, emit);
    const handle: JobHandle = { jobId: job.record.id, signal, emit, costs, releaseProjectLock: releaseLock, pipelineApproved: null };

    // one pipeline estimate + approval for pipelines (§5.4); single stages use the stage gate
    if (req.kind !== "stage") {
      const pe = await pipelineEstimate(this.rt, store, plan, this.renderClient, costs);
      if (pe.totalUsd > 0) {
        for (const s of pe.stages) emit({ type: "estimate", estimate: s });
        const approvals = (await docs.approvals(store)).approvals;
        const approved = approvals.some((a) => a.gate === "cost" && a.planHash === pe.planHash) || pe.totalUsd <= project.budget.autoApproveUnderUsd;
        if (!approved) {
          const first = pe.stages[0]!;
          emit({ type: "needs-approval", gate: "cost", stage: first.stage, lang: first.lang, planHash: pe.planHash, reason: "unmet", summary: pipelineSummary(pe) });
          return "waiting-approval";
        }
        handle.pipelineApproved = new Map(pe.stages.map((s) => [costKey(s.stage, s.lang), s.totalUsd]));
      }
    }

    const ranVoice = new Set<string>();
    for (const inv of plan) {
      if (signal.aborted) throw new DocmakerError("CANCELED", "canceled");
      await ensureLock();
      if (inv.lang && NEEDS_TAKE.includes(inv.stage) && !ranVoice.has(inv.lang) && !(await store.exists(P.activeTake(inv.lang)))) {
        const scratch: StageInvocation = { stage: "voice", lang: inv.lang, variant: null, options: { ...inv.options, takeKind: "scratch", segments: undefined }, force: false, scratch: true };
        emit({ type: "log", level: "info", stage: "voice", message: `${inv.lang}: no active take — generating a free scratch take first` });
        const r = await this.runOne(scratch, handle);
        if (r === "blocked") return "waiting-approval";
        ranVoice.add(inv.lang);
      }
      const r = await this.runOne(inv, handle);
      if (r === "blocked") return "waiting-approval";
      if (inv.stage === "voice" && inv.lang) ranVoice.add(inv.lang);
    }
    return "succeeded";
  }

  private async runOne(inv: StageInvocation, handle: JobHandle): Promise<"ok" | "blocked"> {
    const job = this.live.get(handle.jobId)!;
    try {
      const out = await runStage(this.rt, job.store, inv, handle, this.renderClient);
      return out.kind === "blocked" ? "blocked" : "ok";
    } catch (err) {
      if (err && typeof err === "object") Object.defineProperty(err, "stage", { value: inv.stage, configurable: true, enumerable: false });
      throw err;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.live.values()].map((l) => l.done));
    LIVE_ENGINES.delete(this.engineId);
  }
}

export async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size;
  } catch {
    return 0;
  }
}
