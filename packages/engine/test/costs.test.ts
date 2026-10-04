// Cost control (§5.4, §17.6): receipts, overrun rule, pipeline estimate + one approval, BUDGET_EXCEEDED stop.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { P, Project, sha256Hex } from "@docmaker/core";
import { ProjectStore } from "@docmaker/core/node";
import { createLlmClient, type LlmClient } from "@docmaker/llm";
import { ProjectCosts, readReceipts } from "../src/costs";
import { silentLogger } from "../src/util";
import { REPO_ROOT, fixtureProject, pipelineReq, runToEnd, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

/**
 * The fixture LLM presented as a live client: as the API ("anthropic": estimates become non-zero; each call records a
 * receipt of `usd`) or as the claude-code subscription (estimates $0, receipts $0).
 */
function paidLlm(fixture: string, usd: number, kind: "anthropic" | "claude-code" = "anthropic"): LlmClient {
  const inner = createLlmClient({ provider: "fixture", fixtureDir: path.join(REPO_ROOT, "fixtures", fixture), rawDir: "", refusalFallback: false, logger: silentLogger, apiKey: null });
  let n = 0;
  const pay = async (stage: Parameters<LlmClient["structured"]>[0]["stage"], lang: Parameters<LlmClient["structured"]>[0]["lang"], h: Parameters<LlmClient["structured"]>[1]) => {
    await h.costs.record({ fingerprint: sha256Hex(`call-${n++}`), provider: kind, endpoint: "messages", model: "claude-opus-5-5", stage, lang, usage: { input_tokens: 1000 }, costUsd: usd, outputRef: null });
  };
  return {
    kind,
    async structured(req, h) {
      const out = await inner.structured(req, h);
      await pay(req.stage, req.lang, h);
      return out;
    },
    async research(req, h) {
      const out = await inner.research(req, h);
      await pay("research", null, h);
      return out;
    },
  };
}

describe("ProjectCosts", () => {
  let t: TestEnv;
  let e: EngineExt;
  let store: ProjectStore;
  beforeAll(async () => {
    t = testEnv("costs-unit");
    e = await testEngine(t);
    const p = await fixtureProject(e, "tulip-mania", "c1");
    store = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, p.slug);
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("stops a stage over max(1.5 × approved estimate, estimate + $1), maxUsdPerStage and maxUsdTotal", async () => {
    const project = await store.readJson(P.project, Project);
    const events: unknown[] = [];
    const c = await ProjectCosts.open(store, project, "job-20261003-000000-aaaaaa", (ev) => events.push(ev));
    c.setApproved("script", "en", 1);
    const rec = (usd: number, k: number) => c.record({ fingerprint: sha256Hex(`r${k}`), provider: "anthropic", endpoint: "messages", model: null, stage: "script", lang: "en", usage: {}, costUsd: usd, outputRef: null });
    await rec(1.5, 1);
    await rec(0.5, 2); // 2.0 = estimate + $1: still allowed
    await expect(rec(0.2, 3)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(events.filter((x) => (x as { type: string }).type === "cost")).toHaveLength(3);
    expect((await readReceipts(store)).map((r) => r.costUsd)).toEqual([1.5, 0.5, 0.2]);
    expect(c.spentTotalUsd()).toBeCloseTo(2.2, 6);
    // per-stage cap
    const c2 = await ProjectCosts.open(store, { ...project, budget: { ...project.budget, maxUsdPerStage: 0.3 } }, null, () => {});
    await expect(c2.record({ fingerprint: sha256Hex("x"), provider: "anthropic", endpoint: "messages", model: null, stage: "beats", lang: null, usage: {}, costUsd: 0.31, outputRef: null })).rejects.toThrow(/maxUsdPerStage/);
    // project cap (receipts.ndjson is the whole history)
    const c3 = await ProjectCosts.open(store, { ...project, budget: { ...project.budget, maxUsdTotal: 2.5 } }, null, () => {});
    await expect(c3.record({ fingerprint: sha256Hex("y"), provider: "anthropic", endpoint: "messages", model: null, stage: "outline", lang: null, usage: {}, costUsd: 0.4, outputRef: null })).rejects.toThrow(/maxUsdTotal/);
    // paid-call idempotence: receipts are found by fingerprint
    expect((await c3.findReceipt(sha256Hex("r1")))?.costUsd).toBe(1.5);
  });

  it("an estimate's planHash includes the spend so far (a new approval is needed after an overrun)", async () => {
    const project = await store.readJson(P.project, Project);
    const c = await ProjectCosts.open(store, project, null, () => {});
    const e1 = await c.estimate({ stage: "script", lang: "en", lines: [], totalUsd: 1, confidence: "estimate" }, "f".repeat(64));
    await c.record({ fingerprint: sha256Hex("z"), provider: "anthropic", endpoint: "messages", model: null, stage: "script", lang: "en", usage: {}, costUsd: 0.1, outputRef: null }).catch(() => undefined);
    const e2 = await c.estimate({ stage: "script", lang: "en", lines: [], totalUsd: 1, confidence: "estimate" }, "f".repeat(64));
    expect(e1.planHash).not.toBe(e2.planHash);
  });
});

describe("pipeline cost gate", () => {
  let t: TestEnv;
  let e: EngineExt;
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("one pipeline estimate + approval; --yes satisfies it; the job resumes and records receipts", async () => {
    t = testEnv("costs-pipeline");
    e = await testEngine(t, { llmOverride: paidLlm("tulip-mania", 0.01) });
    const slug = (await fixtureProject(e, "tulip-mania", "paid")).slug;
    const pe = await e.estimatePipeline(slug, { from: "research", to: "outline", langs: [] });
    expect(pe.totalUsd).toBeGreaterThan(0);
    expect(pe.stages.map((s) => s.stage)).toEqual(expect.arrayContaining(["research", "outline"]));
    const r = await runToEnd(e, pipelineReq(slug, "research", "outline"));
    expect(r.status).toBe("waiting-approval");
    const need = r.events.find((x) => x.type === "needs-approval");
    expect(need).toMatchObject({ gate: "cost", planHash: pe.planHash });
    expect(r.events.some((x) => x.type === "stage-start")).toBe(false); // nothing ran (nothing was paid)
    await e.approve(slug, "cost", { stage: "research", lang: null, planHash: pe.planHash, by: "flag", note: "--yes", items: pe.stages.map((s) => s.planHash), itemNotes: {} });
    const res = await e.waitForJob((await e.resume(r.jobId)).jobId);
    expect(res.status).toBe("succeeded");
    const store = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
    expect((await readReceipts(store)).length).toBeGreaterThan(0);
    expect((await e.status(slug)).costUsd).toBeGreaterThan(0);
  });

  it("a stage that overruns its approved estimate stops with BUDGET_EXCEEDED", async () => {
    const t2 = testEnv("costs-overrun");
    const e2 = await testEngine(t2, { llmOverride: paidLlm("tulip-mania", 5) });
    try {
      const slug = (await fixtureProject(e2, "tulip-mania", "over")).slug;
      const pe = await e2.estimatePipeline(slug, { from: "research", to: "research", langs: [] });
      await e2.approve(slug, "cost", { stage: "research", lang: null, planHash: pe.planHash, by: "cli", note: "ok", items: pe.stages.map((s) => s.planHash), itemNotes: {} });
      const r = await runToEnd(e2, pipelineReq(slug, "research", "research"));
      expect(r.status).toBe("failed");
      expect(r.events.find((x) => x.type === "error")).toMatchObject({ code: "BUDGET_EXCEEDED" });
      expect((await e2.status(slug)).stages.find((s) => s.stage === "research")).toMatchObject({ status: "failed" });
    } finally {
      await e2.close();
      t2.cleanup();
    }
  });
});

describe("claude-code subscription", () => {
  it("LLM stages are estimated at $0: the pipeline runs without a cost gate", async () => {
    const t3 = testEnv("costs-subscription");
    const e3 = await testEngine(t3, { llmOverride: paidLlm("tulip-mania", 0, "claude-code") });
    try {
      const slug = (await fixtureProject(e3, "tulip-mania", "sub")).slug;
      const pe = await e3.estimatePipeline(slug, { from: "research", to: "outline", langs: [] });
      expect(pe.totalUsd).toBe(0);
      const r = await runToEnd(e3, pipelineReq(slug, "research", "outline"));
      expect(r.events.some((x) => x.type === "needs-approval" && x.gate === "cost")).toBe(false);
      expect(r.status).toBe("succeeded");
      expect((await e3.status(slug)).costUsd).toBe(0);
    } finally {
      await e3.close();
      t3.cleanup();
    }
  });

  it("new projects take the home default provider, and the runtime builds the claude-code client for them", async () => {
    const t4 = testEnv("costs-default-llm");
    const e4 = await testEngine(t4);
    try {
      const hc = await e4.homeConfig();
      await e4.setHomeConfig({ defaults: { ...hc.defaults, llm: "claude-code" } });
      const p = await e4.createProject({ idea: "The terrible secret of a tulip trader" });
      expect(p.llm.provider).toBe("claude-code");
      expect(e4.rt.llmFor(p).kind).toBe("claude-code");
      expect((await e4.createProject({ idea: "Explicit fixture project", llm: "fixture", fixtureId: "tulip-mania" })).llm.provider).toBe("fixture");
      expect((await e4.createProject({ idea: "Explicit API project", llm: "anthropic" })).llm.provider).toBe("anthropic");
    } finally {
      await e4.close();
      t4.cleanup();
    }
  });
});
