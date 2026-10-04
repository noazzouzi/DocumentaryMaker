// Autopilot (editorial.autopilot) on the gate-test fixture (autoApproveGates:false): the runner approves the editorial
// gates itself (by "autopilot"), never fix-only fact-check items; autopilotFixes rewrites those through the chapter
// revision step; by:"autopilot" is refused on a project that is not in autopilot.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalsDoc, FactSheet, P, Script } from "@docmaker/core";
import { ProjectStore } from "@docmaker/core/node";
import type { LintIssue } from "@docmaker/core";
import { factcheckGateState, fixOnly } from "../src/gates";
import { fixIssue, segmentOf } from "../src/autopilot";
import { AUTOPILOT_NOTE } from "../src/runner";
import { REAL_DEPS, type EngineDeps } from "../src/deps";
import { fixtureProject, pipelineReq, runToEnd, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

describe("autopilot on gate-test", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  let store: ProjectStore;
  const revised: { where: string[]; rules: string[] }[] = [];
  // the chapter revision step, faked: the flagged clip segments get their verbatim quote back
  const deps: EngineDeps = {
    ...REAL_DEPS,
    llm: {
      ...REAL_DEPS.llm,
      async reviseChapter(_ctx, i) {
        revised.push({ where: i.issues.map((x: LintIssue) => x.where), rules: i.issues.map((x: LintIssue) => x.rule) });
        return { ...i.chapter, segments: i.chapter.segments.map((s) => (i.issues.some((x: LintIssue) => x.where === s.id) && s.quoteId ? { ...s, displayText: i.factSheet.quotes.find((q) => q.id === s.quoteId)!.verbatim } : s)) };
      },
    },
  };

  beforeAll(async () => {
    t = testEnv("autopilot");
    e = await testEngine(t, { deps });
    const p = await fixtureProject(e, "gate-test", "auto");
    slug = p.slug;
    store = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
    await e.updateProject(slug, { editorial: { ...p.editorial, autopilot: true } });
  });

  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("research → factcheck runs without stopping: the thesis and the outline approve themselves", async () => {
    const r = await runToEnd(e, pipelineReq(slug, "research", "factcheck"));
    expect(r.status).toBe("succeeded");
    expect(r.events.some((x) => x.type === "needs-approval")).toBe(false);
    const approvals = (await store.readJson(P.approvals, ApprovalsDoc)).approvals;
    expect(approvals.find((a) => a.gate === "outline-approval")).toMatchObject({ by: "autopilot", note: AUTOPILOT_NOTE });
  }, 300_000);

  it("person-ack and recheck approve themselves; factcheck-ack stops only on fix-only items", async () => {
    const r = await runToEnd(e, pipelineReq(slug, "render", "render"));
    expect(r.status).toBe("waiting-approval");
    expect(r.events.filter((x) => x.type === "needs-approval").map((x) => x.type === "needs-approval" && x.gate)).toEqual(["factcheck-ack"]);
    const approvals = (await store.readJson(P.approvals, ApprovalsDoc)).approvals;
    expect(approvals.filter((a) => a.by === "autopilot").map((a) => a.gate)).toEqual(expect.arrayContaining(["person-ack", "recheck"]));
    expect(approvals.find((a) => a.gate === "person-ack")!.items).toContain("P2");
    const st = await factcheckGateState(store, await e.getProject(slug), "en");
    expect(st.open.some(fixOnly)).toBe(true);
  }, 300_000);

  it("autopilotFixes rewrites the flagged segments through the revision step and writes them as user edits", async () => {
    const st = await factcheckGateState(store, await e.getProject(slug), "en");
    const segs = [...new Set(st.gating.filter(fixOnly).map((i) => segmentOf(i.where)).filter((s): s is string => s !== null))];
    expect(segs.length).toBeGreaterThan(0);
    revised.length = 0; // the script stage's own lint revisions went through the same fake
    const fx = await e.autopilotFixes(slug);
    expect(revised.flatMap((r) => r.where).sort()).toEqual(expect.arrayContaining(segs));
    expect(revised.every((r) => r.rules.every((x) => x === "FACTCHECK_FIX_ONLY"))).toBe(true);
    expect(fx.actions.some((a) => a.startsWith("en CH"))).toBe(true);
    const facts = await store.readJson(P.factsheet, FactSheet);
    const script = await store.readJson(P.script("en"), Script);
    for (const id of segs) {
      const ch = script.chapters.find((c) => c.segments.some((s) => s.id === id))!;
      const s = ch.segments.find((x) => x.id === id)!;
      expect(ch.userEdited).toBe(true);
      if (s.quoteId) expect(s.displayText).toBe(facts.quotes.find((q) => q.id === s.quoteId)!.verbatim);
    }
    // the script changed: the fact-check is stale until the next run re-runs it
    expect((await factcheckGateState(store, await e.getProject(slug), "en")).stale).toBe(true);
  }, 300_000);

  it("by:\"autopilot\" is refused on a project that is not in autopilot", async () => {
    const p = await e.getProject(slug);
    await e.updateProject(slug, { editorial: { ...p.editorial, autopilot: false } });
    await expect(e.approve(slug, "fair-use", { stage: "assets", lang: null, planHash: "", note: AUTOPILOT_NOTE, items: [], itemNotes: {}, by: "autopilot" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.autopilotFixes(slug)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("autopilot helpers", () => {
  it("segmentOf maps synthetic clip/b-roll beats to their segment; fixIssue asks for an attributed narration", () => {
    expect(segmentOf("CH2-S05")).toBe("CH2-S05");
    expect(segmentOf("CH2-S05-CLIP")).toBe("CH2-S05");
    expect(segmentOf("CH4-B019")).toBeNull();
    expect(segmentOf("title")).toBeNull();
    const issue = fixIssue({ id: "FC-1", where: "CH2-S05", surface: "clip-quote", verdict: "unverified_quote", risk: "high", factIds: ["Q23"], problem: "quote Q23 was not found on its source page", suggestedRewrite: "", sentence: "x", claimKind: "quote", origin: "deterministic", rule: "", resolution: "open", note: "" } as never, "CH2-S05");
    expect(issue).toMatchObject({ level: "error", rule: "FACTCHECK_FIX_ONLY", where: "CH2-S05" });
    expect(issue.msg).toMatch(/could not be found on its source page/);
    expect(issue.msg).toMatch(/type narration/);
  });
});
