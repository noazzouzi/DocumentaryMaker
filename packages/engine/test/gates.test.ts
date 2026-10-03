// Gates (§5.4) on the gate-test fixture (autoApproveGates:false): editorial gates refuse --yes/auto-threshold/fixture,
// per-gate validation (factcheck-ack items ⊇ blocking, fix-only items, notes, identical notes), staleness re-arming,
// person-ack, recheck, and the render gate summary.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalsDoc, FactCheck, FactSheet, Outline, P, Project, Script, docHash, type Approval } from "@docmaker/core";
import { ProjectStore } from "@docmaker/core/node";
import { addApproval, factcheckGateState, fixOnly, pendingClaims, pendingPersons } from "../src/gates";
import { flaggedTextAt, rewrittenHolds } from "../src/editing";
import { updateProjectDoc } from "../src/runner";
import { REAL_DEPS, type EngineDeps } from "../src/deps";
import { fixtureProject, pipelineReq, runToEnd, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

describe("editorial gates on gate-test", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  let store: ProjectStore;
  const base = { stage: "render" as const, lang: "en" as const, planHash: "", note: "", items: [] as string[], itemNotes: {} as Record<string, string> };

  beforeAll(async () => {
    t = testEnv("gates");
    e = await testEngine(t);
    slug = (await fixtureProject(e, "gate-test", "gates")).slug;
    store = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
    const first = await runToEnd(e, pipelineReq(slug, "research", "factcheck"));
    expect(first.status).toBe("waiting-approval");
    const o = await e.readDoc(slug, P.outline, Outline);
    await e.writeDoc(slug, P.outline, Outline, { ...o.value, thesisConfirmed: true }, o.etag);
    await e.approve(slug, "outline-approval", { ...base, stage: "outline", lang: null, planHash: docHash((await e.readDoc(slug, P.outline, Outline)).value), by: "cli" });
    const second = await e.waitForJob((await e.resume(first.jobId)).jobId);
    expect(second.status).toBe("succeeded");
  }, 300_000);

  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("every editorial gate refuses --yes, the auto-approve threshold and by:fixture on a non-auto fixture", async () => {
    for (const gate of ["outline-approval", "factcheck-ack", "person-ack", "recheck", "fair-use"] as const) {
      for (const by of ["flag", "auto-threshold"] as const) {
        await expect(e.approve(slug, gate, { ...base, by, note: "approved from a flag" })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/editorial/) });
      }
      await expect(e.approve(slug, gate, { ...base, by: "fixture", note: "demo fixture" })).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("the render is blocked by factcheck-ack, person-ack and recheck", async () => {
    const r = await runToEnd(e, pipelineReq(slug, "render", "render"));
    expect(r.status).toBe("waiting-approval");
    const gates = r.events.filter((x) => x.type === "needs-approval").map((x) => x.type === "needs-approval" && x.gate);
    expect(gates).toEqual(["factcheck-ack", "person-ack", "recheck"]);
  });

  it("factcheck-ack: every blocking item, fix-only items, notes ≥ 10 characters, no identical notes", async () => {
    const project = await e.getProject(slug);
    const st = await factcheckGateState(store, project, "en");
    expect(st.stale).toBe(false);
    expect(st.gating.length).toBeGreaterThanOrEqual(3);
    const fix = st.gating.filter(fixOnly);
    expect(fix.map((i) => i.verdict)).toContain("quote_mismatch");
    const ackable = st.gating.filter((i) => !fixOnly(i));
    const notes = Object.fromEntries(ackable.map((i, k) => [i.id, `Reviewed with counsel, item ${k + 1}: wording kept.`]));
    // missing items
    await expect(e.approve(slug, "factcheck-ack", { ...base, by: "cli", items: ackable.slice(1).map((i) => i.id), itemNotes: notes })).rejects.toThrow(/missing/);
    // quote_mismatch cannot be acknowledged
    await expect(e.approve(slug, "factcheck-ack", { ...base, by: "cli", items: st.gating.map((i) => i.id), itemNotes: { ...notes, ...Object.fromEntries(fix.map((i) => [i.id, "acknowledged anyway, sorry"])) } })).rejects.toThrow(/can only be fixed/);
    // fix the quote: the clip text becomes the verbatim quote, then re-run the fact-check
    const facts = await store.readJson(P.factsheet, FactSheet);
    const sc = await e.readDoc(slug, P.script("en"), Script);
    const next = structuredClone(sc.value);
    for (const it of fix) {
      for (const ch of next.chapters) for (const s of ch.segments) {
        if (s.id === it.where && s.quoteId) s.displayText = facts.quotes.find((q) => q.id === s.quoteId)!.verbatim;
      }
    }
    await e.writeDoc(slug, P.script("en"), Script, next, sc.etag);
    // the edit made the fact-check stale: acknowledging is refused until it is re-run
    expect((await factcheckGateState(store, await e.getProject(slug), "en")).stale).toBe(true);
    await expect(e.approve(slug, "factcheck-ack", { ...base, by: "cli", items: ackable.map((i) => i.id), itemNotes: notes })).rejects.toThrow(/stale/);
    expect((await runToEnd(e, pipelineReq(slug, "beatslice", "factcheck"))).status).toBe("succeeded");
    // the recorded LLM item survives the re-run: the user marks it "rewritten" (allowed only once the flagged text is gone)
    let fcDoc = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    const stillFix = fcDoc.value.items.filter((i) => fixOnly(i) && i.resolution === "open");
    expect(stillFix.every((i) => i.origin === "llm")).toBe(true);
    await e.writeDoc(slug, P.factcheck("en"), FactCheck, { ...fcDoc.value, items: fcDoc.value.items.map((i) => (stillFix.some((x) => x.id === i.id) ? { ...i, resolution: "rewritten" as const } : i)) }, fcDoc.etag);
    fcDoc = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    const st2 = await factcheckGateState(store, await e.getProject(slug), "en");
    expect(st2.open.filter(fixOnly)).toEqual([]);
    const open2 = st2.gating.filter((i) => i.resolution !== "rewritten");
    const items = open2.map((i) => i.id);
    const notes2 = Object.fromEntries(open2.map((i, k) => [i.id, `Reviewed with counsel, item ${k + 1}: wording kept.`]));
    // short and identical notes are refused
    await expect(e.approve(slug, "factcheck-ack", { ...base, by: "cli", items, itemNotes: Object.fromEntries(items.map((id, k) => [id, `ok ${k}`])) })).rejects.toThrow(/at least 10/);
    if (items.length > 1) await expect(e.approve(slug, "factcheck-ack", { ...base, by: "cli", items, itemNotes: Object.fromEntries(items.map((id) => [id, "the same note everywhere"])) })).rejects.toThrow(/identical notes/);
    // …unless they are the approval's explicitly shared note (CLI --note, web "same note for all")
    if (items.length > 1) {
      const shared = "Reviewed with counsel: wording kept for every item.";
      await e.approve(slug, "factcheck-ack", { ...base, by: "cli", note: shared, items, itemNotes: Object.fromEntries(items.map((id) => [id, shared])) });
    }
    await e.approve(slug, "factcheck-ack", { ...base, by: "cli", items, itemNotes: notes2 });
    const after = await factcheckGateState(store, await e.getProject(slug), "en");
    expect(after.open).toEqual([]);
    const fc = await store.readJson(P.factcheck("en"), FactCheck);
    expect(fc.items.filter((i) => items.includes(i.id)).every((i) => i.resolution === "acknowledged" && i.note.length >= 10)).toBe(true);
    // the approval records the verdict and risk of each item; a changed verdict re-arms the gate as stale even though the
    // acknowledgement carried over by id
    const recorded = (await store.readJson(P.approvals, ApprovalsDoc)).approvals.at(-1)!;
    const target = fc.items.find((i) => i.id === items[0])!;
    expect(recorded.itemNotes[`sig:${target.id}`]).toBe(`${target.verdict}|${target.risk}`);
    const renderGate = async () => (await e.status(slug)).stages.find((s) => s.stage === "render" && s.lang === "en")!;
    expect((await renderGate()).blockedBy).not.toBe("factcheck-ack");
    // (users cannot edit verdicts; a fact-check re-run whose carry-over kept the acknowledgement is simulated here)
    const fcDoc2 = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    const otherVerdict: typeof target.verdict = target.verdict === "contradicted" ? "unsupported" : "contradicted";
    await store.writeJson(P.factcheck("en"), FactCheck, { ...fcDoc2.value, items: fcDoc2.value.items.map((i) => (i.id === target.id ? { ...i, verdict: otherVerdict } : i)) }, { writer: "stage", stage: "factcheck" });
    expect(await renderGate()).toMatchObject({ blockedBy: "factcheck-ack", blockedReason: "stale" });
    // a new review (existing notes kept) clears it
    await e.approve(slug, "factcheck-ack", { ...base, by: "cli", items, itemNotes: {} });
    expect((await renderGate()).blockedBy).not.toBe("factcheck-ack");
    // an edit after the acknowledgement re-arms the gate as stale
    const sc2 = await e.readDoc(slug, P.script("en"), Script);
    const edited = structuredClone(sc2.value);
    edited.chapters[0]!.segments[0]!.displayText += " Allegedly.";
    await e.writeDoc(slug, P.script("en"), Script, edited, sc2.etag);
    const st3 = await e.status(slug);
    expect(st3.stages.find((s) => s.stage === "render" && s.lang === "en")).toMatchObject({ blockedBy: "factcheck-ack", blockedReason: "stale" });
  });

  it("person-ack: a non-public person named on screen needs a per-person note; unknown ids are refused", async () => {
    const pending = await pendingPersons(store, await e.getProject(slug));
    expect(pending.map((p) => p.id)).toContain("P2");
    await expect(e.approve(slug, "person-ack", { ...base, stage: "assets", lang: null, by: "cli", items: ["P9"], note: "a long enough note" })).rejects.toThrow(/unknown person/);
    await expect(e.approve(slug, "person-ack", { ...base, stage: "assets", lang: null, by: "cli", items: ["P2"], note: "short" })).rejects.toThrow(/at least 10/);
    await e.approve(slug, "person-ack", { ...base, stage: "assets", lang: null, by: "cli", items: ["P2"], note: "Named in court filings; consent on file." });
    expect(await pendingPersons(store, await e.getProject(slug))).toEqual([]);
  });

  it("recheck: a pending claim older than 30 days blocks until acknowledged per claim", async () => {
    const pend = await pendingClaims(store, await e.getProject(slug));
    expect(pend.map((c) => c.id)).toContain("C1");
    await expect(e.approve(slug, "recheck", { ...base, by: "cli", items: [], note: "status unchanged" })).rejects.toThrow(/claim ids/);
    await e.approve(slug, "recheck", { ...base, by: "cli", items: pend.map((c) => c.id), note: "Docket checked on 2026-10-01: still pending." });
    expect(await pendingClaims(store, await e.getProject(slug))).toEqual([]);
  });

  it("cost approvals accept --yes (not an editorial gate)", async () => {
    await e.approve(slug, "cost", { ...base, stage: "assets", lang: null, planHash: "a".repeat(64), by: "flag", note: "--yes", items: ["a".repeat(64)] });
    await expect(e.approve(slug, "cost", { ...base, stage: "assets", lang: null, planHash: "nope", by: "flag", note: "--yes" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("documents stay in the project directory", () => {
    expect(store.dir).toBe(path.join(t.env.DOCMAKER_PROJECTS!, slug));
  });

  it("factcheck: \"rewritten\" holds only once the flagged text is gone from a location that can be resolved (title, thumbnail)", async () => {
    const setPublish = async (title: string, thumbnailText: string) => {
      const p = await e.readDoc(slug, P.project, Project);
      await e.writeDoc(slug, P.project, Project, { ...p.value, publish: { ...p.value.publish, en: { title, thumbnailText, description: "" } } }, p.etag);
    };
    const markRewritten = (fc: FactCheck, ids: readonly string[]): FactCheck => ({ ...fc, items: fc.items.map((i) => (ids.includes(i.id) ? { ...i, resolution: "rewritten" as const } : i)) });
    await setPublish("The banker who defrauded his clients", "FRAUDSTER");
    expect((await runToEnd(e, pipelineReq(slug, "factcheck", "factcheck"))).status).toBe("succeeded");
    let fc = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    const title = fc.value.items.find((i) => i.where === "title")!;
    const thumb = fc.value.items.find((i) => i.where === "thumbnail")!;
    expect(title).toMatchObject({ verdict: "needs_attribution", risk: "high", resolution: "open" });
    expect(thumb).toMatchObject({ risk: "high", resolution: "open" });
    // claiming a rewrite while the title still reads "…defrauded…" is refused (the publish surfaces are located)
    await expect(e.writeDoc(slug, P.factcheck("en"), FactCheck, markRewritten(fc.value, [title.id, thumb.id]), fc.etag)).rejects.toThrow(/rewrite it first/);
    let st = await factcheckGateState(store, await e.getProject(slug), "en");
    expect(st.stale).toBe(false);
    expect(st.open.map((i) => i.id)).toEqual(expect.arrayContaining([title.id, thumb.id]));
    // a "rewritten" written behind the editor's back does not survive a fact-check re-run while the text is still there
    await store.writeJson(P.factcheck("en"), FactCheck, markRewritten(fc.value, [title.id, thumb.id]), { writer: "stage", stage: "factcheck" });
    expect((await runToEnd(e, pipelineReq(slug, "factcheck", "factcheck", { force: true }))).status).toBe("succeeded");
    fc = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    expect(fc.value.items.filter((i) => i.id === title.id || i.id === thumb.id).map((i) => i.resolution)).toEqual(["open", "open"]);
    // once the title is rewritten, the title item may be marked rewritten; the thumbnail (unchanged) still may not
    await setPublish("The banker and his clients", "FRAUDSTER");
    fc = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    await expect(e.writeDoc(slug, P.factcheck("en"), FactCheck, markRewritten(fc.value, [thumb.id]), fc.etag)).rejects.toThrow(/rewrite it first/);
    await e.writeDoc(slug, P.factcheck("en"), FactCheck, markRewritten(fc.value, [title.id]), fc.etag);
    // the re-run drops the title item (its text is gone) and keeps the thumbnail item open
    expect((await runToEnd(e, pipelineReq(slug, "factcheck", "factcheck"))).status).toBe("succeeded");
    fc = await e.readDoc(slug, P.factcheck("en"), FactCheck);
    expect(fc.value.items.some((i) => i.id === title.id)).toBe(false);
    expect(fc.value.items.find((i) => i.id === thumb.id)?.resolution).toBe("open");
    await setPublish("The banker and his clients", "THE BANKER");
    expect((await runToEnd(e, pipelineReq(slug, "factcheck", "factcheck"))).status).toBe("succeeded");
    st = await factcheckGateState(store, await e.getProject(slug), "en");
    expect(st.stale).toBe(false);
  }, 300_000);

  it("rewrittenHolds: unresolvable locations and placeholder sentences never count as rewritten", () => {
    const src = { script: null, slices: null, plans: null, facts: null, publish: { title: "A calm title", thumbnailText: "", description: "" } };
    expect(flaggedTextAt(src, "title")).toBe("A calm title");
    expect(rewrittenHolds({ where: "title", sentence: "defrauded" }, src)).toBe(true);
    expect(rewrittenHolds({ where: "title", sentence: "calm" }, src)).toBe(false);
    expect(rewrittenHolds({ where: "CH1-S02-CLIP", sentence: "CH1-S02-CLIP" }, src)).toBe(false); // the placeholder sentence of a clip beat
    expect(rewrittenHolds({ where: "CH9-S99", sentence: "gone" }, src)).toBe(false); // segment not found
    expect(rewrittenHolds({ where: "somewhere", sentence: "gone" }, src)).toBe(false);
    expect(rewrittenHolds({ where: "title", sentence: "" }, src)).toBe(false);
  });

  it("factcheck-ack: a fact-sheet change makes the fact-check stale (claim status, sensitivity, quotes)", async () => {
    const project = await e.getProject(slug);
    expect((await factcheckGateState(store, project, "en")).stale).toBe(false);
    const fs = await e.readDoc(slug, P.factsheet, FactSheet);
    const claim = fs.value.claims[0]!;
    await e.writeDoc(slug, P.factsheet, FactSheet, { ...fs.value, claims: fs.value.claims.map((c) => (c.id === claim.id ? { ...c, sensitivity: "high" as const, summary: `${c.summary} (amended)` } : c)) }, fs.etag);
    const st = await factcheckGateState(store, project, "en");
    expect(st).toMatchObject({ stale: true, staleReasons: expect.arrayContaining([expect.stringMatching(/fact sheet changed/)]) });
    expect((await e.status(slug)).stages.find((s) => s.stage === "render" && s.lang === "en")).toMatchObject({ blockedBy: "factcheck-ack", blockedReason: "stale" });
    // re-running the fact-check against the new fact sheet clears the staleness
    expect((await runToEnd(e, pipelineReq(slug, "factcheck", "factcheck"))).status).toBe("succeeded");
    expect((await factcheckGateState(store, project, "en")).staleReasons.filter((r) => /fact sheet/.test(r))).toEqual([]);
  }, 300_000);

  it("recheck: claims missing from the re-check output stay pending (no \"status unchanged\" approval)", async () => {
    const ids = (await pendingClaims(store, await e.getProject(slug), new Date(8.64e15))).map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    // the model answers for every claim but the first (none when only one is pending)
    const deps: EngineDeps = { ...REAL_DEPS, llm: { ...REAL_DEPS.llm, recheck: async (_ctx, i) => ({ factSheet: i.factSheet, changed: [], checked: i.claimIds.slice(1) }) } };
    const e2 = await testEngine(t, { deps });
    try {
      const before = (await store.readJson(P.approvals, ApprovalsDoc)).approvals.length;
      const r = await e2.recheckClaims(slug);
      expect(r).toEqual({ changed: [], checked: ids.slice(1), omitted: ids.slice(0, 1) });
      const added = (await store.readJson(P.approvals, ApprovalsDoc)).approvals.slice(before);
      expect(added.flatMap((a) => a.items)).toEqual(ids.slice(1));
      expect(added.every((a) => a.gate === "recheck")).toBe(true);
    } finally {
      await e2.close();
    }
  });

  it("approvals.json and project.json updates do not lose concurrent writes", async () => {
    const mk = (gate: Approval["gate"], item: string): Approval => ({ gate, stage: "render", lang: null, planHash: "c".repeat(64), approvedAt: new Date().toISOString(), by: "cli", note: "concurrent write test", items: [item], itemNotes: {} });
    const before = (await store.readJson(P.approvals, ApprovalsDoc)).approvals.length;
    await Promise.all([addApproval(store, mk("person-ack", "PX1")), addApproval(store, mk("recheck", "CX1")), addApproval(store, mk("cost", "c".repeat(64)))]);
    const after = (await store.readJson(P.approvals, ApprovalsDoc)).approvals;
    expect(after).toHaveLength(before + 3);
    expect(after.slice(before).map((a) => a.gate).sort()).toEqual(["cost", "person-ack", "recheck"]);
    const p = await e.getProject(slug);
    await Promise.all([
      updateProjectDoc(store, { budget: { ...p.budget, maxUsdTotal: p.budget.maxUsdTotal + 1 } }),
      updateProjectDoc(store, { editorial: { ...p.editorial, asOf: "2026-09-30" } }),
    ]);
    const q = await e.getProject(slug);
    expect(q.budget.maxUsdTotal).toBe(p.budget.maxUsdTotal + 1);
    expect(q.editorial.asOf).toBe("2026-09-30");
  });
});
