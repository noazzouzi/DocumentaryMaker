// Remaining Engine methods: project CRUD (LOCKED_AFTER_START, style confirmation), impact, history/revert, styles,
// secrets (0600, refresh), testKey offline, home config, upload declarations, listProjects/active job.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Outline, P } from "@docmaker/core";
import { fixtureProject, pipelineReq, runToEnd, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

describe("engine methods", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;

  beforeAll(async () => {
    t = testEnv("methods");
    e = await testEngine(t);
    slug = (await fixtureProject(e, "tulip-mania", "m1")).slug;
    expect((await runToEnd(e, pipelineReq(slug, "research", "beatslice"))).status).toBe("succeeded");
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("createProject: unique slugs from the idea, unknown styles refused, fixture asOf applied", async () => {
    const a = await e.createProject({ idea: "The fall of a tulip trader", llm: "fixture", fixtureId: "tulip-mania" });
    const b = await e.createProject({ idea: "The fall of a tulip trader", llm: "fixture", fixtureId: "tulip-mania" });
    expect(a.slug).toBe("the-fall-of-a-tulip-trader");
    expect(b.slug).toBe("the-fall-of-a-tulip-trader-2");
    expect(a.editorial.asOf).toBe("2026-10-02");
    expect(a.styleConfirmed).toBe(false);
    await expect(e.createProject({ idea: "Another idea entirely", styleId: "no-such-style" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.createProject({ idea: "Fixture without id", llm: "fixture", fixtureId: "nope" })).rejects.toMatchObject({ code: "FIXTURE_MISSING" });
    await expect(e.createProject({ idea: "dupe slug", slug: a.slug })).rejects.toMatchObject({ code: "VALIDATION" });
    const list = await e.listProjects();
    expect(list.map((p) => p.slug)).toEqual(expect.arrayContaining([slug, a.slug, b.slug]));
  });

  it("updateProject: locked fields after start, style change unconfirms, history kept", async () => {
    await expect(e.updateProject(slug, { seed: 12 })).rejects.toThrow(/cannot change once/);
    await expect(e.updateProject(slug, { languages: ["en", "fr"] })).rejects.toThrow(/cannot change once/);
    const p = await e.updateProject(slug, { targetMinutes: 2 });
    expect(p.targetMinutes).toBe(2);
    expect(p.styleConfirmed).toBe(true);
    const q = await e.updateProject(slug, { styleId: "cinematic-essay" });
    expect(q).toMatchObject({ styleId: "cinematic-essay", styleConfirmed: false });
    expect((await e.history(slug, P.project)).length).toBeGreaterThanOrEqual(2);
    await e.updateProject(slug, { styleId: "drama-commentary", styleConfirmed: true, targetMinutes: 1.5 });
  });

  it("impact lists stale stages before a change is saved", async () => {
    const r = await e.impact(slug, { targetMinutes: 3 });
    expect(r.staleStages.map((s) => s.stage)).toEqual(expect.arrayContaining(["outline", "script"]));
    expect(r.staleStages.some((s) => s.stage === "research")).toBe(true); // targetMinutes is a research input (§5.1)
    expect(r.estimatedRerunUsd).toBe(0); // fixture LLM
    const d = await e.impact(slug, { doc: P.outline });
    expect(d.staleStages.map((s) => s.stage)).toEqual(expect.arrayContaining(["script", "beats", "beatslice"]));
    expect(d.staleStages.some((s) => s.stage === "outline" || s.stage === "research")).toBe(false);
    // nothing was saved
    expect((await e.getProject(slug)).targetMinutes).toBe(1.5);
  });

  it("history and revert of a user-editable document", async () => {
    const o = await e.readDoc(slug, P.outline, Outline);
    await e.writeDoc(slug, P.outline, Outline, { ...o.value, thesis: `${o.value.thesis} (edited)` }, o.etag);
    const edited = await e.readDoc(slug, P.outline, Outline);
    expect(edited.value.thesisConfirmed).toBe(true); // editing the thesis confirms it
    await expect(e.writeDoc(slug, P.outline, Outline, edited.value, o.etag)).rejects.toMatchObject({ code: "CONFLICT" });
    const h = await e.history(slug, P.outline); // newest first (the fixture auto-approval wrote the first version)
    expect(h.length).toBeGreaterThanOrEqual(1);
    await e.revert(slug, P.outline, h[0]!.file);
    expect((await e.readDoc(slug, P.outline, Outline)).value.thesis).toBe(o.value.thesis);
  });

  it("styles: list, get, offline suggestion", async () => {
    const list = await e.listStyles();
    expect(list.map((s) => s.id)).toContain("drama-commentary");
    expect((await e.getStyle("drama-commentary")).data.manifest.id).toBe("drama-commentary");
    const s = await e.suggestStyleForIdea("The fall of FTX", { useLlm: true }); // no key → offline
    expect(s.recommendedStyleId).toBe("drama-commentary");
    expect(s.stage).toBe("idea");
  });

  it("secrets: <home>/.env with mode 0600, picked up without a restart; testKey offline", async () => {
    await e.setSecret("pexels", "test-key-123456789");
    const envFile = path.join(t.env.DOCMAKER_HOME!, ".env");
    expect(readFileSync(envFile, "utf8")).toContain("PEXELS_API_KEY=test-key-123456789");
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    expect(e.rt.secrets.pexels).toBe("test-key-123456789");
    expect(await e.testKey("PEXELS_API_KEY")).toMatchObject({ ok: false, message: "offline: not tested" });
    expect(await e.testKey("anthropic")).toMatchObject({ ok: false, message: expect.stringMatching(/not set/) });
    await expect(e.setSecret("nope", "x")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("voices, takes and key status for the web", async () => {
    expect((await e.listVoices("synthetic", "en")).map((v) => v.id)).toEqual(["synthetic-m1", "synthetic-f1"]);
    expect(await e.listVoices("elevenlabs", "en")).toEqual([]); // no key / offline
    expect(await e.listTakes(slug, "fr")).toEqual([]);
    const st = await e.secretStatus();
    expect(st.find((x) => x.name === "anthropic")).toMatchObject({ set: false, masked: "(unset)" });
    expect(JSON.stringify(st)).not.toContain("test-key-123456789");
  });

  it("home config round trip", async () => {
    const hc = await e.setHomeConfig({ contact: "https://example.org/contact", uiLang: "fr" });
    expect(hc).toMatchObject({ contact: "https://example.org/contact", uiLang: "fr" });
    expect((await e.homeConfig()).uiLang).toBe("fr");
  });

  it("uploads need a licence declaration; recordings land in voice/<lang>/recordings", async () => {
    const wav = path.join(t.root, "rec.wav");
    const { writeWav } = await import("@docmaker/core/node");
    await writeWav(wav, { sampleRate: 48000, channels: 1, data: [new Float32Array(4800)] }, "s16");
    await expect(e.upload(slug, { tmpPath: wav, kind: "asset", lang: null, declaration: null, segmentId: null })).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await e.upload(slug, { tmpPath: wav, kind: "recording", lang: "en", declaration: null, segmentId: "CH1-S01" });
    expect(r).toEqual({ rel: "voice/en/recordings/CH1-S01.wav", asset: null });
  });

  it("doctor reports and estimate returns zero for the fixture", async () => {
    const rep = await e.doctor();
    expect(rep.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["node", "ffmpeg", "ffmpeg-features", "chrome", "disk:home"]));
    const est = await e.estimate(slug, "script", "en");
    expect(est?.totalUsd).toBe(0); // fixture LLM: nothing to pay
    await expect(e.estimate(slug, "script", null)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
