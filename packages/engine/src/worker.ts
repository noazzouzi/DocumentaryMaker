// Forked job worker (§5.5): the host (web server engine, runner {kind:"worker"}) forwards submit/resume/cancel to ONE
// forked process running runJobWorker() (apps/cli/src/worker.ts); events are pushed over IPC and also tailed from
// jobs/<id>.ndjson, so a host restart loses nothing. Forking rules: worker path from config.repoRoot (never
// import.meta.resolve), cwd = repoRoot, execArgv ["--import", <repoRoot>/node_modules/tsx/dist/esm/index.mjs], minimal env.
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DocmakerError, ENV_KEYS, ENV_SETTINGS, JobRequest, type ErrorCode, type JobEvent, type RenderClient } from "@docmaker/core";
import type { Runtime } from "./runtime";
import type { JobManager } from "./jobs";

export type WorkerMethod = "submit" | "resume" | "cancel" | "ping";
export interface WorkerRequestMsg { id: number; method: WorkerMethod; params: unknown }
export type WorkerReplyMsg =
  | { id: number; type: "result"; result: unknown }
  | { id: number; type: "error"; error: { code: ErrorCode; message: string; hint: string | null } }
  | { type: "event"; event: JobEvent }
  | { type: "ready"; pid: number };

const PASS_ENV = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TEMP", "TMP", "NO_PROXY", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"];
const PROXY_ENV = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

/** The worker's environment: only what it needs (tooling, DOCMAKER_* settings, provider keys, proxy). */
export function workerEnv(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const copy = (k: string) => {
    const v = src[k];
    if (v !== undefined && v !== "") out[k] = v;
  };
  PASS_ENV.forEach(copy);
  PROXY_ENV.forEach(copy);
  Object.values(ENV_SETTINGS).forEach(copy);
  Object.values(ENV_KEYS).forEach(copy);
  for (const k of Object.keys(src)) if (k.startsWith("DOCMAKER_") || k.startsWith("REMOTION_")) copy(k);
  if (PROXY_ENV.some((k) => out[k])) out.NODE_USE_ENV_PROXY = "1";
  out.NODE_ENV = src.NODE_ENV === "test" ? "test" : "production";
  return out;
}

export function workerForkOptions(repoRoot: string, env: NodeJS.ProcessEnv) {
  return {
    cwd: repoRoot,
    execArgv: ["--import", path.join(repoRoot, "node_modules", "tsx", "dist", "esm", "index.mjs")],
    env: { ...workerEnv(env), [ENV_SETTINGS.repoRoot]: repoRoot },
    stdio: ["ignore", "pipe", "pipe", "ipc"] as ("ignore" | "pipe" | "ipc")[],
  };
}

interface Pending { resolve(v: unknown): void; reject(e: unknown): void }

export class WorkerHost {
  private child: ChildProcess | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly slugs = new Set<string>();
  private starting: Promise<ChildProcess> | null = null;
  private closed = false;

  constructor(private readonly rt: Runtime, private readonly o: { workerPath: string; jobs: JobManager }) {}

  private resolveWorkerPath(): string {
    const p = path.isAbsolute(this.o.workerPath) ? this.o.workerPath : path.join(this.rt.config.repoRoot, this.o.workerPath);
    if (!existsSync(p)) throw new DocmakerError("TOOL_MISSING", `job worker not found: ${p}`, { hint: "workerPath is resolved from config.repoRoot (apps/cli/src/worker.ts)" });
    return p;
  }

  private start(): Promise<ChildProcess> {
    if (this.child && this.child.connected) return Promise.resolve(this.child);
    if (this.starting) return this.starting;
    this.starting = new Promise<ChildProcess>((resolve, reject) => {
      const child = fork(this.resolveWorkerPath(), [], workerForkOptions(this.rt.config.repoRoot, this.rt.env));
      const log = this.rt.logger.child({ worker: child.pid });
      child.stdout?.on("data", (d: Buffer) => log.info(d.toString("utf8").trimEnd()));
      child.stderr?.on("data", (d: Buffer) => log.warn(d.toString("utf8").trimEnd()));
      const timer = setTimeout(() => reject(new DocmakerError("INTERNAL", "the job worker did not start within 60 s")), 60_000);
      child.on("message", (raw: unknown) => {
        const m = raw as WorkerReplyMsg;
        if (m.type === "ready") {
          clearTimeout(timer);
          this.child = child;
          resolve(child);
          return;
        }
        if (m.type === "event") {
          this.o.jobs.poke(m.event.jobId);
          return;
        }
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.type === "result") p.resolve(m.result);
        else p.reject(new DocmakerError(m.error.code, m.error.message, { hint: m.error.hint ?? undefined }));
      });
      child.on("exit", (code, sig) => {
        clearTimeout(timer);
        log.warn("job worker exited", { code, sig });
        this.child = null;
        this.starting = null;
        for (const [, p] of this.pending) p.reject(new DocmakerError("INTERRUPTED", "the job worker exited"));
        this.pending.clear();
        if (!this.closed) for (const s of this.slugs) void this.o.jobs.reconcile(s).catch(() => undefined);
        reject(new DocmakerError("INTERNAL", `the job worker exited during start-up (code ${code ?? sig})`));
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async call(method: WorkerMethod, params: unknown): Promise<unknown> {
    const child = await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.send({ id, method, params } satisfies WorkerRequestMsg, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async submit(req: JobRequest): Promise<{ jobId: string; coalesced: boolean }> {
    const r = JobRequest.parse(req);
    this.slugs.add(r.slug);
    return (await this.call("submit", r)) as { jobId: string; coalesced: boolean };
  }
  /** Projects whose jobs this host reconciles when the worker exits (a resumed or canceled job counts as well). */
  private async track(jobId: string): Promise<void> {
    const rec = await this.o.jobs.getJob(jobId).catch(() => null);
    if (rec) this.slugs.add(rec.request.slug);
  }
  async resume(jobId: string): Promise<{ jobId: string }> {
    await this.track(jobId);
    return (await this.call("resume", { jobId })) as { jobId: string };
  }
  async cancel(jobId: string): Promise<void> {
    await this.track(jobId);
    await this.call("cancel", { jobId });
  }
  /** For tests: the projects reconciled on a worker exit. */
  trackedSlugs(): string[] {
    return [...this.slugs].sort();
  }
  async ping(): Promise<{ pid: number }> {
    return (await this.call("ping", {})) as { pid: number };
  }
  get pid(): number | null {
    return this.child?.pid ?? null;
  }
  async close(): Promise<void> {
    this.closed = true;
    const c = this.child;
    if (!c) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        c.kill("SIGKILL");
        resolve();
      }, 5000);
      c.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      if (c.connected) c.disconnect();
      else c.kill("SIGTERM");
    });
  }
}

/**
 * Job-worker main loop (§5.5, §14.5). Runs an in-process engine with the given RenderClient, answers IPC requests and
 * pushes every job event to the host. Exits when the host disconnects (running jobs are canceled first).
 */
export async function runWorkerLoop(o: { renderClient: RenderClient; cwd: string; makeEngine: (renderClient: RenderClient, cwd: string) => Promise<{ submit(r: JobRequest): Promise<{ jobId: string; coalesced: boolean }>; resume(id: string): Promise<{ jobId: string }>; cancel(id: string): Promise<void>; events(id: string, after?: number): AsyncIterable<JobEvent>; listLive(): string[]; close(): Promise<void> }> }): Promise<void> {
  if (!process.send) throw new DocmakerError("VALIDATION", "runJobWorker must run in a forked process (IPC channel missing)");
  const engine = await o.makeEngine(o.renderClient, o.cwd);
  const send = (m: WorkerReplyMsg) => {
    if (process.connected) process.send!(m);
  };
  const followed = new Set<string>();
  const follow = (jobId: string) => {
    if (followed.has(jobId)) return;
    followed.add(jobId);
    void (async () => {
      try {
        for await (const ev of engine.events(jobId)) send({ type: "event", event: ev });
      } catch { /* job vanished */ }
    })();
  };
  process.on("message", (raw: unknown) => {
    const m = raw as WorkerRequestMsg;
    if (!m || typeof m.id !== "number") return;
    void (async () => {
      try {
        let result: unknown;
        switch (m.method) {
          case "submit":
            result = await engine.submit(m.params as JobRequest);
            follow((result as { jobId: string }).jobId);
            break;
          case "resume":
            result = await engine.resume((m.params as { jobId: string }).jobId);
            follow((result as { jobId: string }).jobId);
            break;
          case "cancel":
            await engine.cancel((m.params as { jobId: string }).jobId);
            result = null;
            break;
          case "ping":
            result = { pid: process.pid };
            break;
          default:
            throw new DocmakerError("VALIDATION", `unknown worker method ${String(m.method)}`);
        }
        send({ id: m.id, type: "result", result });
      } catch (e) {
        const err = e as { code?: ErrorCode; message?: string; hint?: string | null };
        send({ id: m.id, type: "error", error: { code: err.code ?? "INTERNAL", message: err.message ?? String(e), hint: err.hint ?? null } });
      }
    })();
  });
  await new Promise<void>((resolve) => {
    process.once("disconnect", resolve);
    send({ type: "ready", pid: process.pid });
  });
  for (const id of engine.listLive()) await engine.cancel(id).catch(() => undefined);
  await engine.close();
}
