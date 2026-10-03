// Stage hashing, staleness, option keys, variants, ownership, writeDoc issues, render snapshot lock release, new-take
// cascade — on the tulip-mania fixture with every real package and a fake render client (no Chrome).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { P, Script, StyleSuggestion, Timeline, type GeneratedStillsRequest, type RenderClient, type RenderRequest, type RenderResult } from "@docmaker/core";
import { ProjectStore, loadRuntime, sha256File } from "@docmaker/core/node";
import { mixMatches } from "../src/stages/render";
import { upToDateRender } from "../src/stages/export";
import { FakeRenderClient } from "./fakes";
import { REPO_ROOT, collect, deferred, fixtureProject, pipelineReq, runToEnd, stageReq, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

const staleOf = async (e: EngineExt, slug: string) => (await e.status(slug)).stages.filter((s) => s.stale).map((s) => `${s.stage}${s.lang ? "." + s.lang : ""}${s.variant ? "@" + s.variant : ""}`).sort();

describe("pipeline on a fixture project", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  let dir: string;

  beforeAll(async () => {
    t = testEnv("pipeline");
    e = await testEngine(t);
    slug = (await fixtureProject(e)).slug;
    dir = path.join(t.env.DOCMAKER_PROJECTS!, slug);
    const r = await runToEnd(e, pipelineReq(slug, "research", "mix"));
    expect(r.status).toBe("succeeded");
  }, 240_000);

  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("a fresh run leaves every stage done and nothing stale", async () => {
    const st = await e.status(slug);
    const ran = st.stages.filter((s) => ["research", "style", "outline", "script", "beats", "beatslice", "factcheck", "assets", "voice", "layout", "direct", "mix"].includes(s.stage));
    expect(ran.every((s) => s.status === "done")).toBe(true);
    expect(await staleOf(e, slug)).toEqual([]);
  });

  it("a forced no-op re-run writes identical bytes and stales nothing", async () => {
    const before = await sha256File(path.join(dir, P.beatSlices("en")));
    const r = await runToEnd(e, stageReq(slug, "beatslice", { force: true }));
    expect(r.status).toBe("succeeded");
    expect(r.events.some((x) => x.type === "stage-done")).toBe(true);
    expect(await sha256File(path.join(dir, P.beatSlices("en")))).toBe(before);
    expect(await staleOf(e, slug)).toEqual([]);
  });

  it("an up-to-date stage is skipped unless forced", async () => {
    const r = await runToEnd(e, stageReq(slug, "outline"));
    expect(r.events.filter((x) => x.type === "stage-skip")).toHaveLength(1);
    expect(r.events.filter((x) => x.type === "stage-done")).toHaveLength(0);
  });

  it("onlyChapters is a hashed option key of layout, direct and mix", async () => {
    const one = await runToEnd(e, pipelineReq(slug, "layout", "mix", { options: { onlyChapters: ["CH1"] } }));
    expect(one.events.filter((x) => x.type === "stage-done").map((x) => x.type === "stage-done" && x.stage)).toEqual(["layout", "direct", "mix"]);
    const again = await runToEnd(e, pipelineReq(slug, "layout", "mix", { options: { onlyChapters: ["CH1"] } }));
    expect(again.events.filter((x) => x.type === "stage-skip")).toHaveLength(3);
    const layout = JSON.parse(readFileSync(path.join(dir, P.layout("en")), "utf8")) as { onlyChapters: string[] | null; chapters: { chapterId: string }[] };
    expect(layout.onlyChapters).toEqual(["CH1"]);
    expect(layout.chapters.map((c) => c.chapterId)).toEqual(["CH1"]);
    // back to the whole programme
    const all = await runToEnd(e, pipelineReq(slug, "layout", "mix"));
    expect(all.status).toBe("succeeded");
    expect(all.events.filter((x) => x.type === "stage-done").map((x) => x.type === "stage-done" && x.stage)).toEqual(["layout", "direct", "mix"]);
    expect(await staleOf(e, slug)).toEqual([]);
  });

  it("render and qa keep one state per preset (variant)", async () => {
    for (const preset of ["draft", "master"] as const) {
      const r = await runToEnd(e, pipelineReq(slug, "render", "render", { preset }));
      expect(r.status).toBe("succeeded");
    }
    const st = await e.status(slug);
    const renders = st.stages.filter((s) => s.stage === "render").map((s) => `${s.variant}:${s.status}`).sort();
    expect(renders).toEqual(["draft:done", "master:done"]);
    const again = await runToEnd(e, pipelineReq(slug, "render", "render", { preset: "draft" }));
    expect(again.events.filter((x) => x.type === "stage-skip")).toHaveLength(1);
  });

  it("a user edit of the primary script stales exactly its dependants and returns fact-check issues", async () => {
    const { value, etag } = await e.readDoc(slug, P.script("en"), Script);
    const seg = value.chapters[0]!.segments[0]!;
    const next = structuredClone(value);
    next.chapters[0]!.segments[0] = { ...seg, displayText: `${seg.displayText} Some 4,321 traders were ruined.` };
    const w = await e.writeDoc(slug, P.script("en"), Script, next, etag);
    expect(w.issues.some((i) => i.rule.startsWith("FACTCHECK_"))).toBe(true);
    const saved = (await e.readDoc(slug, P.script("en"), Script)).value;
    expect(saved.chapters[0]!.userEdited).toBe(true);
    expect(saved.chapters[0]!.segments[0]!.ttsText).not.toBe(seg.ttsText);
    expect(saved.chapters[0]!.segments[0]!.ttsText).not.toContain("4,321"); // the synthetic voice gets expanded numbers
    expect(await e.history(slug, P.script("en"))).toHaveLength(1);
    // beats (skeleton only), assets (clip segments only), mix (timeline audio) and render (timeline + mix) are not stale
    expect(await staleOf(e, slug)).toEqual(["beatslice.en", "direct.en", "factcheck.en", "layout.en", "voice.en"]);
    // the user edit survives a script re-run (protected chapter)
    const r = await runToEnd(e, stageReq(slug, "script", { force: true }));
    expect(r.status).toBe("succeeded");
    expect((await e.readDoc(slug, P.script("en"), Script)).value.chapters[0]!.segments[0]!.displayText).toContain("4,321");
  });

  it("ownership: a stage cannot write another stage's document; generated documents are not user-editable", async () => {
    const store = await (await import("@docmaker/core/node")).ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
    const sug = await store.readJson(P.styleSuggestion, StyleSuggestion);
    await expect(store.writeJson(P.styleSuggestion, StyleSuggestion, sug, { writer: "stage", stage: "outline" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.writeDoc(slug, P.styleSuggestion, StyleSuggestion, sug, null)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("render refuses a mix that was not built from the current timeline (direct re-ran after the mix)", async () => {
    const store = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
    const project = await e.getProject(slug);
    const timeline = async () => store.readJson(P.timeline("en"), Timeline);
    expect(await mixMatches({ store, project }, "en", await timeline())).toBe(true);
    // `docmaker layout` + `docmaker direct` on one chapter, no mix: the mix still holds the whole programme
    const one = await runToEnd(e, pipelineReq(slug, "layout", "direct", { options: { onlyChapters: ["CH1"] } }));
    expect(one.status, JSON.stringify(one.events.filter((x) => x.type === "error"))).toBe("succeeded");
    expect(await mixMatches({ store, project }, "en", await timeline())).toBe(false);
    const r = await runToEnd(e, stageReq(slug, "render", { preset: "draft" }));
    expect(r.status).toBe("failed");
    expect(r.events.find((x) => x.type === "error")).toMatchObject({ code: "UPSTREAM_MISSING", message: expect.stringMatching(/mix was not built from the current timeline/) });
    expect(await upToDateRender({ store, project }, "en", await timeline())).toBeNull();
    // layout → mix (the whole programme) makes the pair consistent again
    expect((await runToEnd(e, pipelineReq(slug, "layout", "mix"))).status).toBe("succeeded");
    expect(await mixMatches({ store, project }, "en", await timeline())).toBe(true);
  }, 240_000);

  it("the new-take cascade: a new active take stales layout, and layout → mix brings everything up to date", async () => {
    const notRender = (xs: string[]) => xs.filter((x) => !x.startsWith("render"));
    expect((await runToEnd(e, pipelineReq(slug, "beatslice", "mix"))).status).toBe("succeeded");
    expect(notRender(await staleOf(e, slug))).toEqual([]);
    const before = JSON.parse(readFileSync(path.join(dir, P.activeTake("en")), "utf8")) as { takeId: string };
    const v = await runToEnd(e, stageReq(slug, "voice", { options: { takeKind: "scratch" } }));
    expect(v.status).toBe("succeeded");
    const after = JSON.parse(readFileSync(path.join(dir, P.activeTake("en")), "utf8")) as { takeId: string };
    expect(after.takeId).not.toBe(before.takeId);
    expect(after.takeId.startsWith("scratch-")).toBe(true);
    expect(await staleOf(e, slug)).toContain("layout.en");
    const r = await runToEnd(e, pipelineReq(slug, "layout", "mix"));
    expect(r.events.filter((x) => x.type === "stage-done").map((x) => x.type === "stage-done" && x.stage)).toEqual(["layout", "direct", "mix"]);
    expect(notRender(await staleOf(e, slug))).toEqual([]);
  });
});

/** A RenderClient whose render() blocks until released (snapshot / lock-release test). */
class BlockingRender implements RenderClient {
  readonly started = deferred();
  readonly release = deferred();
  constructor(private readonly inner: FakeRenderClient) {}
  async render(req: RenderRequest, h: Parameters<RenderClient["render"]>[1]): Promise<RenderResult> {
    this.started.resolve();
    await this.release.promise;
    return this.inner.render(req, h);
  }
  renderStills = (...a: Parameters<RenderClient["renderStills"]>) => this.inner.renderStills(...a);
  renderOverlays = () => this.inner.renderOverlays();
  renderGeneratedStills = (req: GeneratedStillsRequest, h: Parameters<RenderClient["renderGeneratedStills"]>[1]) => this.inner.renderGeneratedStills(req, h);
  probeGl = () => this.inner.probeGl();
  close = () => this.inner.close();
}

describe("render snapshot", () => {
  let t: TestEnv;
  let e: EngineExt;

  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("copies the timeline + mix into snapshot/ and releases the project lock while rendering", async () => {
    t = testEnv("snapshot");
    const { config } = loadRuntime({ cwd: REPO_ROOT, env: t.env });
    const blocking = new BlockingRender(new FakeRenderClient(config));
    e = await testEngine(t, { renderClient: blocking });
    const slug = (await fixtureProject(e, "tulip-mania", "snap")).slug;
    expect((await runToEnd(e, pipelineReq(slug, "research", "mix"))).status).toBe("succeeded");
    const renderJob = await e.submit(pipelineReq(slug, "render", "render", { preset: "draft" }));
    await blocking.started.promise;
    const dir = path.join(t.env.DOCMAKER_PROJECTS!, slug);
    expect(await sha256File(path.join(dir, P.renderSnapshot("en", "draft"), "timeline.json"))).toBe(await sha256File(path.join(dir, P.timeline("en"))));
    // another job of the project runs to completion while the render is still in flight
    const direct = await runToEnd(e, stageReq(slug, "direct", { force: true }));
    expect(direct.status).toBe("succeeded");
    expect((await e.getJob(renderJob.jobId))?.status).toBe("running");
    blocking.release.resolve();
    expect((await e.waitForJob(renderJob.jobId)).status).toBe("succeeded");
    const evs = await collect(e, renderJob.jobId);
    expect(evs.at(-1)).toMatchObject({ type: "job-end", status: "succeeded" });
  }, 240_000);
});
