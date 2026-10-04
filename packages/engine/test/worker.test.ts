// Forked job worker (§5.5): the host forwards submit/resume/cancel over IPC, follows jobs through jobs/<id>.ndjson,
// and reconciles the worker's jobs as INTERRUPTED when the worker dies.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobEvent } from "@docmaker/core";
import { createEngineImpl, type EngineExt } from "../src/engine";
import { REAL_DEPS } from "../src/deps";
import { silentLogger } from "../src/util";
import { REPO_ROOT, collect, fixtureProject, pipelineReq, testEnv, type TestEnv } from "./helpers";

const WORKER = "packages/engine/test/fixtures/fake-worker.ts";

describe("forked job worker", () => {
  let t: TestEnv;
  let host: EngineExt;
  let slug: string;

  beforeAll(async () => {
    t = testEnv("worker");
    t.env.DOCMAKER_TEST_RENDER_DELAY_MS = "4000";
    host = await createEngineImpl({ cwd: REPO_ROOT, env: t.env, renderClient: null, runner: { kind: "worker", workerPath: WORKER }, deps: REAL_DEPS, logger: silentLogger });
    slug = (await fixtureProject(host, "tulip-mania", "wk")).slug;
  });
  afterAll(async () => {
    await host?.close();
    t?.cleanup();
  });

  it("runs a pipeline in the worker process; the host follows its events from the NDJSON log", async () => {
    const { jobId, coalesced } = await host.submit(pipelineReq(slug, "research", "mix"));
    expect(coalesced).toBe(false);
    const events = await collect(host, jobId);
    expect(events.at(-1)).toMatchObject({ type: "job-end", status: "succeeded" });
    expect(events.filter((e) => e.type === "stage-done")).toHaveLength(12);
    const rec = await host.getJob(jobId);
    expect(rec?.status).toBe("succeeded");
    // the host never ran a job itself
    expect(host.jobs.liveIds()).toEqual([]);
    const pid = (host as unknown as { worker: { pid: number | null } }).worker.pid;
    expect(pid).not.toBeNull();
    expect(pid).not.toBe(process.pid);
  }, 420_000); // a whole research→mix pipeline in a freshly forked tsx worker: ~95 s alone, > 180 s on the shared 4-vCPU box during `pnpm test`

  it("forwards cancel to the worker", async () => {
    const { jobId } = await host.submit(pipelineReq(slug, "render", "render", { force: true }));
    const seen: JobEvent[] = [];
    for await (const e of host.events(jobId)) {
      seen.push(e);
      if (e.type === "stage-start" && e.stage === "render") await host.cancel(jobId);
    }
    expect(seen.at(-1)).toMatchObject({ type: "job-end", status: "canceled" });
    expect((await host.getJob(jobId))?.status).toBe("canceled");
  });

  it("marks the worker's running job INTERRUPTED when the worker dies", async () => {
    const { jobId } = await host.submit(pipelineReq(slug, "render", "render", { force: true }));
    const w = (host as unknown as { worker: { pid: number | null } }).worker;
    for await (const e of host.events(jobId)) {
      if (e.type === "stage-start" && e.stage === "render") {
        process.kill(w.pid!, "SIGKILL");
        break;
      }
    }
    let rec = await host.getJob(jobId);
    for (let i = 0; i < 100 && rec?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      rec = await host.getJob(jobId);
    }
    expect(rec).toMatchObject({ status: "failed", error: { code: "INTERRUPTED" } });
    const evs = await collect(host, jobId);
    expect(evs.at(-1)).toMatchObject({ type: "job-end", status: "failed" });
    // the next submit starts a fresh worker
    const again = await host.submit(pipelineReq(slug, "layout", "mix"));
    const done = await collect(host, again.jobId);
    expect(done.at(-1)).toMatchObject({ type: "job-end", status: "succeeded" });
    expect(path.isAbsolute(REPO_ROOT)).toBe(true);
  });
});
