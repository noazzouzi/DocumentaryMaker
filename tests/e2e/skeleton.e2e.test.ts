// Walking skeleton (§16.5): the engine runs every stage of the offline demo on the REAL packages (styles, llm fixture,
// assets offline, voice synthetic, audio, director, export); only the render client is fake (ffmpeg-written MP4 with the
// timeline's frame count, no Chrome). Equals the demo e2e minus the Remotion rendering (§16.4 assertions adapted).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { P, QaReport, Timeline, TimelineLintDoc, type JobEvent } from "@docmaker/core";
import { ffprobeJson, loadRuntime, sha256File } from "@docmaker/core/node";
import { createEngineImpl, REAL_DEPS } from "@docmaker/engine";
import { FakeRenderClient } from "../../packages/engine/test/fakes/index";
import { offlineEnv, REPO_ROOT, type OfflineEnv } from "./helpers";

type E = Awaited<ReturnType<typeof createEngineImpl>>;

describe("walking skeleton (real packages, fake render client)", () => {
  let env: OfflineEnv;
  let engine: E;
  let render: FakeRenderClient;
  let result: { slug: string; jobId: string; mp4: string; exportDir: string };
  let projectDir: string;
  const events: JobEvent[] = [];

  beforeAll(async () => {
    env = await offlineEnv("skeleton");
    const { config } = loadRuntime({ cwd: REPO_ROOT, env: process.env });
    render = new FakeRenderClient(config);
    engine = await createEngineImpl({ cwd: REPO_ROOT, env: process.env, renderClient: render, deps: REAL_DEPS });
    result = await engine.runDemo({ fixture: "tulip-mania", langs: ["en"], offline: true, tts: "synthetic", preset: "draft", onlyChapters: ["CH1", "CH2"], slug: "skeleton-demo" });
    projectDir = path.join(env.projects, result.slug);
    for await (const ev of engine.events(result.jobId)) events.push(ev);
  }, 600_000);

  afterAll(async () => {
    await engine?.close();
    await env?.restore();
  });

  it("runs every stage once, in order, and succeeds", async () => {
    const job = await engine.getJob(result.jobId);
    expect(job?.status).toBe("succeeded");
    const done = events.filter((e) => e.type === "stage-done").map((e) => (e.type === "stage-done" ? `${e.stage}${e.lang ? "." + e.lang : ""}` : ""));
    expect(done).toEqual([
      "research", "style", "outline", "script.en", "beats", "beatslice.en", "factcheck.en", "assets", "voice.en",
      "layout.en", "direct.en", "mix.en", "render.en", "export.en", "qa.en",
    ]);
    // seq is gap-free and the log ends with job-end
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events.at(-1)).toMatchObject({ type: "job-end", status: "succeeded" });
    // fixture gates were auto-approved with by:"fixture"
    const approvals = JSON.parse(readFileSync(path.join(projectDir, P.approvals), "utf8")) as { approvals: { gate: string; by: string }[] };
    expect(approvals.approvals.some((a) => a.gate === "outline-approval" && a.by === "fixture")).toBe(true);
  });

  it("writes an MP4 with the timeline's frame count, 960×540 h264 + aac 48 kHz stereo", async () => {
    const t = Timeline.parse(JSON.parse(readFileSync(path.join(projectDir, P.timeline("en")), "utf8")));
    expect(t.onlyChapters).toEqual(["CH1", "CH2"]);
    expect(t.chapters.map((c) => c.id)).toEqual(["CH1", "CH2"]);
    expect(existsSync(result.mp4)).toBe(true);
    const { config } = loadRuntime({ cwd: REPO_ROOT, env: process.env });
    const pr = await ffprobeJson(result.mp4, { config, signal: new AbortController().signal, countFrames: true });
    const v = pr.streams.filter((s) => s.codecType === "video");
    const a = pr.streams.filter((s) => s.codecType === "audio");
    expect(v).toHaveLength(1);
    expect(a).toHaveLength(1);
    expect(v[0]).toMatchObject({ codecName: "h264", pixFmt: "yuv420p", width: 960, height: 540 });
    expect(v[0]!.fps).toBeCloseTo(30, 3);
    expect(v[0]!.nbFrames).toBe(t.durationInFrames);
    expect(Math.abs(pr.durationSec - t.durationInFrames / 30)).toBeLessThanOrEqual(1 / 30 + 1e-3);
    expect(a[0]).toMatchObject({ codecName: "aac", sampleRate: 48000, channels: 2 });
  });

  it("produces the export bundle and a QA report", () => {
    const files = readdirSync(result.exportDir);
    for (const suffix of [".fcpxml", ".premiere.xml", ".otio", ".markers.edl", ".srt"]) expect(files.some((f) => f.endsWith(suffix))).toBe(true);
    for (const f of ["README.md", "credits.md", "reference.mp4"]) expect(files).toContain(f);
    expect(readdirSync(path.join(result.exportDir, "stems")).sort()).toEqual(["clip.wav", "music.wav", "sfx.wav", "vo.wav"]);
    const srt = readFileSync(path.join(result.exportDir, files.find((f) => f.endsWith(".srt"))!), "utf8");
    expect(srt).toMatch(/^1\r?\n\d\d:\d\d:\d\d,\d{3} --> /); // the real SRT writer uses CRLF
    const otio = JSON.parse(readFileSync(path.join(result.exportDir, files.find((f) => f.endsWith(".otio"))!), "utf8")) as { OTIO_SCHEMA: string };
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    const qa = QaReport.parse(JSON.parse(readFileSync(path.join(projectDir, P.qaReport("en", "draft")), "utf8")));
    const failed = qa.checks.filter((c) => !c.ok && c.level === "error").map((c) => `${c.id}: ${c.message}`);
    expect(failed).toEqual([]);
    const lint = TimelineLintDoc.parse(JSON.parse(readFileSync(path.join(projectDir, P.timelineLint("en")), "utf8")));
    expect(lint.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("a forced re-run of direct writes a byte-identical timeline", async () => {
    const before = await sha256File(path.join(projectDir, P.timeline("en")));
    const { jobId } = await engine.submit({ slug: result.slug, kind: "stage", stage: "direct", from: null, to: null, langs: ["en"], force: true, options: { onlyChapters: ["CH1", "CH2"] }, preset: null });
    expect((await engine.waitForJob(jobId)).status).toBe("succeeded");
    expect(await sha256File(path.join(projectDir, P.timeline("en")))).toBe(before);
  });

  it("a forced re-run of beatslice changes no file and stales nothing", async () => {
    const rel = P.beatSlices("en");
    const before = await sha256File(path.join(projectDir, rel));
    const { jobId } = await engine.submit({ slug: result.slug, kind: "stage", stage: "beatslice", from: null, to: null, langs: ["en"], force: true, options: {}, preset: null });
    expect((await engine.waitForJob(jobId)).status).toBe("succeeded");
    expect(await sha256File(path.join(projectDir, rel))).toBe(before);
    const st = await engine.status(result.slug);
    expect(st.stages.filter((s) => s.stale).map((s) => `${s.stage}.${s.lang ?? "-"}`)).toEqual([]);
    expect(st.stages.filter((s) => s.lang === "en" || s.lang === null).every((s) => s.status === "done")).toBe(true);
  });

  it("a pipeline re-run skips every stage (up to date)", async () => {
    const { jobId } = await engine.submit({ slug: result.slug, kind: "pipeline", stage: null, from: "research", to: "qa", langs: ["en"], force: false, options: { onlyChapters: ["CH1", "CH2"] }, preset: "draft" });
    const evs: JobEvent[] = [];
    for await (const ev of engine.events(jobId)) evs.push(ev);
    expect(evs.filter((e) => e.type === "stage-done")).toEqual([]);
    expect(evs.filter((e) => e.type === "stage-skip")).toHaveLength(15);
  });

  it("never reached the network", () => {
    expect(env.proxyConnections()).toBe(0);
  });
});
