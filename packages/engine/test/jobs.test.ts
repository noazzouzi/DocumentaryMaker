// Job lifecycle (§5.6): NDJSON replay with afterSeq, coalescing, cancel, crash reconciliation (INTERRUPTED), resume.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocmakerError, JobsIndex, Outline, P, ProjectState, docHash, type JobRecord } from "@docmaker/core";
import { ProjectStore } from "@docmaker/core/node";
import { createLlmClient, type LlmClient } from "@docmaker/llm";
import { cancelRel, requestKey } from "../src/jobs";
import { updateStageState } from "../src/state";
import { silentLogger } from "../src/util";
import { REPO_ROOT, collect, deferred, fixtureProject, pipelineReq, runToEnd, stageReq, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

/** Fixture LLM whose calls wait for `gate` (abortable). */
function gatedLlm(fixture: string, gate: Promise<void>): LlmClient & { calls: number } {
  const inner = createLlmClient({ provider: "fixture", fixtureDir: path.join(REPO_ROOT, "fixtures", fixture), rawDir: "", refusalFallback: false, logger: silentLogger, apiKey: null });
  const wait = (signal: AbortSignal) => Promise.race([gate, new Promise<never>((_, rej) => {
    if (signal.aborted) rej(new DocmakerError("CANCELED", "canceled"));
    signal.addEventListener("abort", () => rej(new DocmakerError("CANCELED", "canceled")), { once: true });
  })]);
  const llm = {
    kind: "fixture" as const,
    calls: 0,
    async structured(req: Parameters<LlmClient["structured"]>[0], h: Parameters<LlmClient["structured"]>[1]) {
      llm.calls++;
      await wait(h.signal);
      return inner.structured(req, h);
    },
    async research(req: Parameters<LlmClient["research"]>[0], h: Parameters<LlmClient["research"]>[1]) {
      llm.calls++;
      await wait(h.signal);
      return inner.research(req, h);
    },
  };
  return llm as LlmClient & { calls: number };
}

describe("job events", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  beforeAll(async () => {
    t = testEnv("jobs-events");
    e = await testEngine(t);
    slug = (await fixtureProject(e, "tulip-mania", "ev")).slug;
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("appends every event to jobs/<id>.ndjson and replays after a sequence number", async () => {
    const r = await runToEnd(e, pipelineReq(slug, "research", "outline"));
    expect(r.status).toBe("succeeded");
    expect(r.events[0]).toMatchObject({ type: "job-start", seq: 0 });
    expect(r.events.at(-1)).toMatchObject({ type: "job-end", status: "succeeded" });
    const file = readFileSync(path.join(t.env.DOCMAKER_PROJECTS!, slug, P.jobEvents(r.jobId)), "utf8").trim().split("\n");
    expect(file).toHaveLength(r.events.length);
    const tail = await collect(e, r.jobId, 3);
    expect(tail.map((x) => x.seq)).toEqual(r.events.filter((x) => x.seq > 3).map((x) => x.seq));
    const idx = JobsIndex.parse(JSON.parse(readFileSync(path.join(t.env.DOCMAKER_PROJECTS!, slug, P.jobsIndex), "utf8")));
    expect(idx.jobs.find((j) => j.id === r.jobId)).toMatchObject({ status: "succeeded", error: null });
    expect((await e.listJobs(slug))[0]!.id).toBe(r.jobId);
  });

  it("rejects an invalid request at submit time", async () => {
    await expect(e.submit(pipelineReq(slug, "qa", "research"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.submit(stageReq(slug, "script", { langs: ["fr"] }))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("requestKey ignores language order", () => {
    expect(requestKey(stageReq("a", "script", { langs: ["fr", "en"] }))).toBe(requestKey(stageReq("a", "script", { langs: ["en", "fr"] })));
    expect(requestKey(stageReq("a", "script", { force: true }))).not.toBe(requestKey(stageReq("a", "script")));
  });
});

describe("coalescing and cancel", () => {
  let t: TestEnv;
  let e: EngineExt;
  const gate = deferred();
  let llm: ReturnType<typeof gatedLlm>;
  beforeAll(async () => {
    t = testEnv("jobs-coalesce");
    llm = gatedLlm("tulip-mania", gate.promise);
    e = await testEngine(t, { llmOverride: llm });
  });
  afterAll(async () => {
    gate.resolve();
    await e?.close();
    t?.cleanup();
  });

  it("merges identical queued requests and cancels a running job", async () => {
    const slug = (await fixtureProject(e, "tulip-mania", "co")).slug;
    const running = await e.submit(stageReq(slug, "research"));
    // wait until the research job holds the project and is blocked in the LLM
    for (let i = 0; i < 200 && llm.calls === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(llm.calls).toBe(1);
    const a = await e.submit(stageReq(slug, "style"));
    const b = await e.submit(stageReq(slug, "style"));
    expect(a.coalesced).toBe(false);
    expect(b).toEqual({ jobId: a.jobId, coalesced: true });
    const c = await e.submit(stageReq(slug, "style", { force: true }));
    expect(c.coalesced).toBe(false);
    const jobs = await e.listJobs(slug);
    const merged = jobs.find((j) => j.coalescedInto === a.jobId);
    expect(merged?.status).toBe("queued");
    expect((await e.status(slug)).queued).toEqual(expect.arrayContaining([a.jobId, c.jobId]));

    await e.cancel(running.jobId);
    expect((await e.getJob(running.jobId))?.status).toBe("canceled");
    const evs = await collect(e, running.jobId);
    expect(evs.at(-1)).toMatchObject({ type: "job-end", status: "canceled" });
    // cancel a queued job too
    await e.cancel(c.jobId);
    expect((await e.getJob(c.jobId))?.status).toBe("canceled");
    // the style job now runs (research was canceled → its stage fails for want of a fact sheet)
    gate.resolve();
    const ra = await e.waitForJob(a.jobId);
    expect(ra.status).toBe("failed");
    expect(ra.error?.code).toBe("UPSTREAM_MISSING");
    const mergedAfter = (await e.listJobs(slug)).find((j) => j.coalescedInto === a.jobId);
    expect(mergedAfter?.status).toBe("failed");
  });
});

describe("crash reconciliation", () => {
  it("marks queued/running jobs of dead processes as failed INTERRUPTED and appends error + job-end", async () => {
    const t = testEnv("jobs-crash");
    try {
      const e1 = await testEngine(t);
      const slug = (await fixtureProject(e1, "tulip-mania", "cr")).slug;
      await e1.close();
      const dir = path.join(t.env.DOCMAKER_PROJECTS!, slug);
      const req = pipelineReq(slug, "research", "qa");
      const mk = (id: string, status: JobRecord["status"]): JobRecord => ({ id, request: req, status, createdAt: "2026-10-02T10:00:00.000Z", startedAt: status === "running" ? "2026-10-02T10:00:01.000Z" : null, endedAt: null, error: null, coalescedInto: null, resumeOf: null });
      const dead = "job-20261002-100000-aaaaaa";
      const queued = "job-20261002-100001-bbbbbb";
      const done = "job-20261002-090000-cccccc";
      mkdirSync(path.join(dir, "jobs"), { recursive: true });
      writeFileSync(path.join(dir, P.jobsIndex), JSON.stringify({ schemaVersion: 1, jobs: [{ ...mk(done, "succeeded"), endedAt: "2026-10-02T09:10:00.000Z" }, mk(dead, "running"), mk(queued, "queued")] }));
      writeFileSync(path.join(dir, `jobs/${dead}.owner.json`), JSON.stringify({ pid: 2 ** 22 + 12345, engineId: "gone" }));
      writeFileSync(path.join(dir, `jobs/${queued}.owner.json`), JSON.stringify({ pid: process.pid, engineId: "a-dead-engine-of-this-process" }));
      writeFileSync(path.join(dir, P.jobEvents(dead)), [
        { jobId: dead, seq: 0, at: "2026-10-02T10:00:01.000Z", type: "job-start", request: req },
        { jobId: dead, seq: 1, at: "2026-10-02T10:00:02.000Z", type: "stage-start", stage: "research", lang: null },
      ].map((x) => JSON.stringify(x) + "\n").join(""));
      // the killed job left its stage "running" in state.json (runStage never reached its own bookkeeping)
      const store0 = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
      await updateStageState(store0, { stage: "research", lang: null, variant: null }, 1, { status: "running", startedAt: "2026-10-02T10:00:02.000Z" });
      writeFileSync(path.join(dir, P.lock), JSON.stringify({ pid: process.pid, owner: "test", jobId: dead, at: "2026-10-02T10:00:01.000Z" }));

      const e2 = await testEngine(t);
      try {
        for (const id of [dead, queued]) {
          const rec = await e2.getJob(id);
          expect(rec).toMatchObject({ status: "failed", error: { code: "INTERRUPTED" } });
        }
        expect((await e2.getJob(done))?.status).toBe("succeeded");
        const evs = await collect(e2, dead);
        expect(evs.map((x) => x.type)).toEqual(["job-start", "stage-start", "error", "job-end"]);
        expect(evs[2]).toMatchObject({ code: "INTERRUPTED", seq: 2 });
        // …and its interrupted stage is no longer reported as running
        const st = (await (await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug)).readJson(P.state, ProjectState)).stages.find((x) => x.stage === "research")!;
        expect(st).toMatchObject({ status: "failed", error: expect.stringMatching(/^INTERRUPTED/) });
        expect((await e2.status(slug)).stages.find((x) => x.stage === "research")?.status).toBe("failed");
        // the stale lock was taken over: a new job runs
        const r = await runToEnd(e2, stageReq(slug, "research"));
        expect(r.status).toBe("succeeded");
        // resume the interrupted pipeline: a new job with resumeOf
        const res = await e2.resume(dead);
        expect(res.jobId).not.toBe(dead);
        const resumed = await e2.waitForJob(res.jobId);
        expect(resumed.resumeOf).toBe(dead);
        expect(resumed.status).toBe("succeeded");
      } finally {
        await e2.close();
      }
    } finally {
      t.cleanup();
    }
  }, 300_000);
});

describe("resume after an approval (gate-test fixture: no auto-approval)", () => {
  it("waits at outline-approval, refuses --yes, then resumes after a CLI approval", async () => {
    const t = testEnv("jobs-resume");
    const e = await testEngine(t);
    try {
      const slug = (await fixtureProject(e, "gate-test", "gt")).slug;
      const r = await runToEnd(e, pipelineReq(slug, "research", "script"));
      expect(r.status).toBe("waiting-approval");
      const need = r.events.find((x) => x.type === "needs-approval");
      expect(need).toMatchObject({ gate: "outline-approval", stage: "script", reason: "unmet" });
      const base = { stage: "outline" as const, lang: null, planHash: "0".repeat(64), note: "looks right", items: [], itemNotes: {} };
      await expect(e.approve(slug, "outline-approval", { ...base, by: "flag" })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(e.approve(slug, "outline-approval", { ...base, by: "fixture" })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(e.approve(slug, "outline-approval", { ...base, planHash: need!.type === "needs-approval" ? need!.planHash : "", by: "cli" })).rejects.toThrow(/thesis/);
      // confirming the thesis = editing it (or an explicit confirmation)
      const { Outline } = await import("@docmaker/core");
      const o = await e.readDoc(slug, P.outline, Outline);
      await e.writeDoc(slug, P.outline, Outline, { ...o.value, thesisConfirmed: true }, o.etag);
      // an approval bound to an outline the user did not review is refused
      await expect(e.approve(slug, "outline-approval", { ...base, by: "cli" })).rejects.toMatchObject({ code: "CONFLICT" });
      const reviewed = (await e.readDoc(slug, P.outline, Outline)).value;
      await e.approve(slug, "outline-approval", { ...base, planHash: docHash(reviewed), by: "cli" });
      const res = await e.resume(r.jobId);
      const rec = await e.waitForJob(res.jobId);
      expect(rec).toMatchObject({ status: "succeeded", resumeOf: r.jobId });
      // editing the outline afterwards re-arms the gate (stale)
      const o2 = await e.readDoc(slug, P.outline, Outline);
      await e.writeDoc(slug, P.outline, Outline, { ...o2.value, title: `${o2.value.title} (v2)` }, o2.etag);
      const st = await e.status(slug);
      expect(st.stages.find((s) => s.stage === "script")).toMatchObject({ blockedBy: "outline-approval", blockedReason: "stale" });
    } finally {
      await e.close();
      t.cleanup();
    }
  }, 300_000);
});

describe("cancel from another process", () => {
  it("a job run by another engine stops on a cancel request; an ended job is left alone", async () => {
    const t = testEnv("jobs-xcancel");
    const gate = deferred();
    const llm = gatedLlm("tulip-mania", gate.promise);
    const owner = await testEngine(t, { llmOverride: llm });
    const other = await testEngine(t);
    try {
      const slug = (await fixtureProject(owner, "tulip-mania", "xc")).slug;
      const running = await owner.submit(stageReq(slug, "research"));
      for (let i = 0; i < 200 && llm.calls === 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(llm.calls).toBe(1);
      // `docmaker jobs <slug> --cancel <id>` from another terminal: the other engine has no live job
      await other.cancel(running.jobId);
      expect((await owner.getJob(running.jobId))?.status).toBe("canceled");
      expect((await collect(other, running.jobId)).at(-1)).toMatchObject({ type: "job-end", status: "canceled" });
      expect(readFileSync(path.join(t.env.DOCMAKER_PROJECTS!, slug, P.jobsIndex), "utf8")).toContain("canceled");
      // the cancel request is consumed with the job
      expect(() => readFileSync(path.join(t.env.DOCMAKER_PROJECTS!, slug, cancelRel(running.jobId)))).toThrow();
      // an ended job: nothing happens (the CLI reports its status)
      await other.cancel(running.jobId);
      expect((await other.getJob(running.jobId))?.status).toBe("canceled");
      await expect(other.cancel("job-20261002-100000-zzzzzz")).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
    } finally {
      gate.resolve();
      await owner.close();
      await other.close();
      t.cleanup();
    }
  }, 120_000);
});

describe("resume of a forced pipeline", () => {
  it("does not re-force the stages the forced job already completed (outline approval survives the resume)", async () => {
    const t = testEnv("jobs-force-resume");
    const e = await testEngine(t);
    try {
      const slug = (await fixtureProject(e, "gate-test", "fr")).slug;
      const r = await runToEnd(e, pipelineReq(slug, "research", "script", { force: true }));
      expect(r.status).toBe("waiting-approval");
      const base = { stage: "outline" as const, lang: null, note: "looks right", items: [], itemNotes: {} };
      for (let round = 0; round < 2; round++) {
        const o = await e.readDoc(slug, P.outline, Outline);
        await e.writeDoc(slug, P.outline, Outline, { ...o.value, thesisConfirmed: true }, o.etag);
        const reviewed = (await e.readDoc(slug, P.outline, Outline)).value;
        await e.approve(slug, "outline-approval", { ...base, planHash: docHash(reviewed), by: "cli" });
        const res = await e.resume(r.jobId);
        const events = await collect(e, res.jobId);
        const rec = await e.waitForJob(res.jobId);
        // research/style/outline are not re-run: the approved outline (thesis confirmation included) is kept
        expect(events.filter((x) => x.type === "stage-done").map((x) => x.type === "stage-done" && x.stage)).toEqual(["script"]);
        expect(events.some((x) => x.type === "needs-approval")).toBe(false);
        expect(rec).toMatchObject({ status: "succeeded", resumeOf: r.jobId });
        expect((await e.readDoc(slug, P.outline, Outline)).value).toMatchObject({ thesisConfirmed: true });
        expect(docHash((await e.readDoc(slug, P.outline, Outline)).value)).toBe(docHash(reviewed));
      }
    } finally {
      await e.close();
      t.cleanup();
    }
  }, 300_000);
});
