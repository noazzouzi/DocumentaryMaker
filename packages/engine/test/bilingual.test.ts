// EN + FR on the tulip-mania fixture: the secondary script follows the primary skeleton (parity), each language gets its
// own slices, take, layout and timeline; a pipeline for FR alone also runs the primary script/beatslice.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalsDoc, P, Script, Timeline, hashJson, validateLangParity } from "@docmaker/core";
import { fixtureProject, pipelineReq, runToEnd, testEngine, testEnv, type TestEnv } from "./helpers";
import { REAL_DEPS } from "../src/deps";
import type { EngineExt } from "../src/engine";

describe("bilingual project", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  let dir: string;
  let order: string[] = [];
  const tc = { fake: false, calls: 0 };

  beforeAll(async () => {
    t = testEnv("bilingual");
    const base = REAL_DEPS;
    e = await testEngine(t, {
      deps: {
        ...base,
        llm: {
          ...base.llm,
          transcreateSegment: async (ctx, i) => {
            if (!tc.fake) return base.llm.transcreateSegment(ctx, i);
            tc.calls++;
            return { displayText: "Au printemps 1637, le marché des tulipes s’effondre.", subtitleTranslation: "" };
          },
        },
      },
    });
    slug = (await fixtureProject(e, "tulip-mania", "bi", ["en", "fr"])).slug;
    dir = path.join(t.env.DOCMAKER_PROJECTS!, slug);
    const r = await runToEnd(e, pipelineReq(slug, "research", "mix", { langs: ["fr"], options: { onlyChapters: ["CH1"] } }));
    expect(r.status).toBe("succeeded");
    order = r.events.filter((x) => x.type === "stage-done").map((x) => (x.type === "stage-done" ? `${x.stage}${x.lang ? "." + x.lang : ""}` : ""));
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("runs the primary script and slices for a FR-only request, then FR downstream only", () => {
    expect(order).toEqual(["research", "style", "outline", "script.en", "script.fr", "beats", "beatslice.en", "beatslice.fr", "factcheck.fr", "assets", "voice.fr", "layout.fr", "direct.fr", "mix.fr"]);
  });

  it("keeps the segment skeleton identical across languages", () => {
    const en = Script.parse(JSON.parse(readFileSync(path.join(dir, P.script("en")), "utf8")));
    const fr = Script.parse(JSON.parse(readFileSync(path.join(dir, P.script("fr")), "utf8")));
    expect(validateLangParity(en, fr)).toEqual([]);
    expect(fr.chapters[0]!.segments.filter((s) => s.type === "narration").every((s) => s.primaryHash !== null)).toBe(true);
  });

  it("builds a French timeline from the French take", () => {
    const tl = Timeline.parse(JSON.parse(readFileSync(path.join(dir, P.timeline("fr")), "utf8")));
    const active = JSON.parse(readFileSync(path.join(dir, P.activeTake("fr")), "utf8")) as { takeId: string };
    expect(tl.lang).toBe("fr");
    expect(tl.takeId).toBe(active.takeId);
    expect(tl.chapters.map((c) => c.id)).toEqual(["CH1"]);
  });

  it("transcreate validates its target and needs the LLM (no recorded fixture → FIXTURE_MISSING)", async () => {
    await expect(e.transcreate(slug, "en", "CH1-S01")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.transcreate(slug, "fr", "CH9-S01")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.transcreate(slug, "fr", "CH1-S01")).rejects.toMatchObject({ code: "FIXTURE_MISSING" });
  });

  it("transcreate is cost-gated per segment: an approval binds to the segment's texts; the threshold auto-approves", async () => {
    // fixture projects cost nothing
    expect(await e.estimateTranscreate(slug, "fr", "CH1-S01")).toMatchObject({ totalUsd: 0, approved: true });
    const p = await e.getProject(slug);
    await e.updateProject(slug, { llm: { ...p.llm, provider: "anthropic" } });
    try {
      const est = await e.estimateTranscreate(slug, "fr", "CH1-S01");
      expect(est.totalUsd).toBeGreaterThan(0);
      expect(est.approved).toBe(false);
      tc.fake = true;
      await expect(e.transcreate(slug, "fr", "CH1-S01")).rejects.toMatchObject({ code: "GATE_REQUIRED", details: { gate: "cost", planHash: est.planHash } });
      expect(tc.calls).toBe(0);
      await e.approve(slug, "cost", { stage: "script", lang: "fr", planHash: est.planHash, by: "flag", note: "--yes", items: [est.planHash], itemNotes: {} });
      expect((await e.estimateTranscreate(slug, "fr", "CH1-S01")).approved).toBe(true);
      const r = await e.transcreate(slug, "fr", "CH1-S01");
      expect(tc.calls).toBe(1);
      expect(r.displayText).toContain("1637");
      const fr = (await e.readDoc(slug, P.script("fr"), Script)).value;
      const en = (await e.readDoc(slug, P.script("en"), Script)).value;
      const seg = fr.chapters[0]!.segments.find((x) => x.id === "CH1-S01")!;
      expect(seg.primaryHash).toBe(hashJson(en.chapters[0]!.segments.find((x) => x.id === "CH1-S01")!.displayText));
      // the secondary text changed: the old approval does not cover a new transcreation
      const again = await e.estimateTranscreate(slug, "fr", "CH1-S01");
      expect(again.planHash).not.toBe(est.planHash);
      expect(again.approved).toBe(false);
      // under the project's auto-approve threshold: recorded as an auto-threshold approval
      await e.updateProject(slug, { budget: { ...p.budget, autoApproveUnderUsd: 5 } });
      await e.transcreate(slug, "fr", "CH1-S01");
      expect(tc.calls).toBe(2);
      const approvals = (await e.readDoc(slug, P.approvals, ApprovalsDoc)).value.approvals.filter((a) => a.gate === "cost" && a.lang === "fr");
      expect(approvals.map((a) => a.by)).toEqual(["flag", "auto-threshold"]);
      expect(approvals[1]!.planHash).toBe(again.planHash);
    } finally {
      tc.fake = false;
      await e.updateProject(slug, { llm: p.llm, budget: p.budget });
    }
  });
});
