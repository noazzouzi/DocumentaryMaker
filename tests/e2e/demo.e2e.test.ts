// E2E offline demo (§16.4; owned by W10, made green by I in P2): REAL packages end to end, Chrome render (shared Chrome,
// render lock, concurrency 2), every provider key deleted, DOCMAKER_OFFLINE=1, dead proxy, no network.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { P, QaReport, RenderDoc, Timeline, TimelineLintDoc } from "@docmaker/core";
import { ffprobeJson, loadRuntime, measureEbur128, run, sha256File } from "@docmaker/core/node";
import { blackViolations, createEngineImpl, parseBlackdetect, parseFreezedetect, REAL_DEPS, type EngineDeps, type EngineExt } from "@docmaker/engine";
import { InProcessRenderClient } from "@docmaker/render";
import { offlineEnv, REPO_ROOT, type OfflineEnv } from "./helpers";

const NEVER = new AbortController().signal;

/** Real assets package with a counting HttpClient (every attempted request is counted, offline or not). */
function countingDeps(counter: { n: number }): EngineDeps {
  const base = REAL_DEPS.assets;
  return {
    ...REAL_DEPS,
    assets: {
      ...base,
      createHttpClient: ((o: Parameters<typeof base.createHttpClient>[0]) => {
        const c = base.createHttpClient(o);
        const wrap = <K extends keyof typeof c>(k: K) => ((...a: unknown[]) => {
          counter.n++;
          return (c[k] as (...x: unknown[]) => unknown)(...a);
        }) as (typeof c)[K];
        return { getJson: wrap("getJson"), getText: wrap("getText"), postForm: wrap("postForm"), postJson: wrap("postJson"), download: wrap("download") };
      }) as typeof base.createHttpClient,
    },
  };
}

describe("offline demo (tulip-mania, EN, CH1–CH2, draft)", () => {
  let env: OfflineEnv;
  let engine: EngineExt;
  let r: { slug: string; jobId: string; mp4: string; exportDir: string };
  let projectDir: string;
  let timeline: Timeline;
  const http = { n: 0 };
  const config = () => loadRuntime({ cwd: REPO_ROOT, env: process.env }).config;

  beforeAll(async () => {
    env = await offlineEnv("demo");
    const { config: cfg } = loadRuntime({ cwd: REPO_ROOT, env: process.env });
    const logger = (await import("@docmaker/core/node")).createLogger({ level: "warn" });
    engine = await createEngineImpl({ cwd: REPO_ROOT, env: process.env, renderClient: new InProcessRenderClient({ config: cfg, logger }), deps: countingDeps(http), logger });
    r = await engine.runDemo({ fixture: "tulip-mania", langs: ["en"], offline: true, tts: "synthetic", preset: "draft", onlyChapters: ["CH1", "CH2"], concurrency: 2 });
    projectDir = path.join(env.projects, r.slug);
    timeline = Timeline.parse(JSON.parse(readFileSync(path.join(projectDir, P.timeline("en")), "utf8")));
  }, 1_800_000);

  afterAll(async () => {
    await engine?.close();
    await env?.restore();
  });

  it("1–2. one h264 yuv420p 960×540 30 fps video stream with the timeline's frame count and one aac 48 kHz stereo stream", async () => {
    expect(existsSync(r.mp4)).toBe(true);
    const pr = await ffprobeJson(r.mp4, { config: config(), signal: NEVER, countFrames: true });
    const v = pr.streams.filter((s) => s.codecType === "video");
    const a = pr.streams.filter((s) => s.codecType === "audio");
    expect(v).toHaveLength(1);
    expect(a).toHaveLength(1);
    expect(v[0]).toMatchObject({ codecName: "h264", pixFmt: "yuv420p", width: 960, height: 540 });
    expect(v[0]!.fps).toBeCloseTo(30, 3);
    expect(a[0]).toMatchObject({ codecName: "aac", sampleRate: 48000, channels: 2 });
    expect(v[0]!.nbFrames).toBe(timeline.durationInFrames);
    expect(Math.abs(pr.durationSec - timeline.durationInFrames / 30)).toBeLessThanOrEqual(1 / 30 + 1e-3);
  });

  it("3. loudness: integrated −15…−13 LUFS, true peak ≤ −1.0 dBTP", async () => {
    const m = await measureEbur128(r.mp4, { config: config(), signal: NEVER, stream: "a:0" });
    expect(m.integratedLufs).toBeGreaterThanOrEqual(-15);
    expect(m.integratedLufs).toBeLessThanOrEqual(-13);
    expect(m.truePeakDbtp).toBeLessThanOrEqual(-1.0);
  });

  it("4–5. no black run > 1 s except one dip ≤ 1.4 s; freezes are warnings only", async () => {
    const res = await run(config().ffmpeg, ["-hide_banner", "-nostdin", "-i", r.mp4, "-an", "-vf", "blackdetect=d=1:pix_th=0.03:pic_th=0.99,freezedetect=n=0.003:d=3.5,metadata=mode=print", "-f", "null", "-"], { signal: NEVER });
    expect(res.code).toBe(0);
    expect(blackViolations(parseBlackdetect(res.stderr))).toEqual([]);
    const freezes = parseFreezedetect(res.stderr);
    if (freezes.length) console.warn(`freezedetect: ${freezes.map((f) => `${f.start.toFixed(1)}s+${f.duration.toFixed(1)}s`).join(", ")}`);
  });

  it("6. export bundle: NLE files, SRT cues, 4 stems, README, credits, reference.mp4; XML valid against the DTDs; OTIO parses", async () => {
    const files = readdirSync(r.exportDir);
    const find = (suffix: string) => files.find((f) => f.endsWith(suffix));
    for (const s of [".fcpxml", ".premiere.xml", ".otio", ".markers.edl", ".srt"]) expect(find(s), s).toBeDefined();
    for (const f of ["README.md", "credits.md", "reference.mp4"]) expect(files).toContain(f);
    expect(readdirSync(path.join(r.exportDir, "stems")).filter((f) => f.endsWith(".wav")).sort()).toEqual(["clip.wav", "music.wav", "sfx.wav", "vo.wav"]);
    expect(readFileSync(path.join(r.exportDir, find(".srt")!), "utf8")).toMatch(/\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}/);
    const otio = JSON.parse(readFileSync(path.join(r.exportDir, find(".otio")!), "utf8")) as { OTIO_SCHEMA: string };
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    const xmllint = await run("xmllint", ["--version"], { signal: NEVER }).catch(() => null);
    if (xmllint && xmllint.code === 0) {
      const dtd = path.join(REPO_ROOT, "packages/export/test/dtd");
      for (const [file, d] of [[find(".fcpxml")!, "fcpxml-1.10.dtd"], [find(".premiere.xml")!, "xmeml_dtd_4_premiere.dtd"]] as const) {
        const v = await run("xmllint", ["--noout", "--dtdvalid", path.join(dtd, d), path.join(r.exportDir, file)], { signal: NEVER });
        expect(v.code, `${file}: ${v.stderr.slice(0, 600)}`).toBe(0);
      }
    }
  });

  it("7. the QA report has no error check; the timeline lint has no error", () => {
    const qa = QaReport.parse(JSON.parse(readFileSync(path.join(projectDir, P.qaReport("en", "draft")), "utf8")));
    expect(qa.checks.filter((c) => !c.ok && c.level === "error").map((c) => `${c.id}: ${c.message}`)).toEqual([]);
    const lint = TimelineLintDoc.parse(JSON.parse(readFileSync(path.join(projectDir, P.timelineLint("en")), "utf8")));
    expect(lint.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("8a. re-running direct writes a byte-identical timeline", async () => {
    const before = await sha256File(path.join(projectDir, P.timeline("en")));
    const { jobId } = await engine.submit({ slug: r.slug, kind: "stage", stage: "direct", from: null, to: null, langs: ["en"], force: true, options: { onlyChapters: ["CH1", "CH2"] }, preset: null });
    expect((await engine.waitForJob(jobId)).status).toBe("succeeded");
    expect(await sha256File(path.join(projectDir, P.timeline("en")))).toBe(before);
  });

  it("8b. a forced re-run of beatslice changes no file and stales nothing", async () => {
    const before = await sha256File(path.join(projectDir, P.beatSlices("en")));
    const { jobId } = await engine.submit({ slug: r.slug, kind: "stage", stage: "beatslice", from: null, to: null, langs: ["en"], force: true, options: {}, preset: null });
    expect((await engine.waitForJob(jobId)).status).toBe("succeeded");
    expect(await sha256File(path.join(projectDir, P.beatSlices("en")))).toBe(before);
    const st = await engine.status(r.slug);
    expect(st.stages.filter((s) => s.stale).map((s) => `${s.stage}.${s.lang}`)).toEqual([]);
  });

  it("8c. re-running render reuses every chunk", async () => {
    const { jobId } = await engine.submit({ slug: r.slug, kind: "stage", stage: "render", from: null, to: null, langs: ["en"], force: true, options: { onlyChapters: ["CH1", "CH2"] }, preset: "draft" });
    expect((await engine.waitForJob(jobId)).status).toBe("succeeded");
    const doc = RenderDoc.parse(JSON.parse(readFileSync(path.join(projectDir, P.renderDoc("en", "draft")), "utf8")));
    expect(doc.chunks.length).toBeGreaterThan(0);
    expect(doc.chunks.every((c) => c.cached)).toBe(true);
  }, 600_000);

  it("9. no request reached the network", () => {
    expect(env.proxyConnections()).toBe(0);
    expect(http.n).toBe(0);
  });
});
