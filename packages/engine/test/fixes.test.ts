// Regression tests of review findings that need no full pipeline: library music under the licence policy, the QA SFX
// density verdict (the director's definition), and the worker host's crash reconciliation scope after a resume.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FrozenAsset, type LicenseInfo, type LintIssue } from "@docmaker/core";
import { ProjectStore } from "@docmaker/core/node";
import type { LibraryTrack } from "@docmaker/audio";
import { REAL_DEPS, type EngineDeps } from "../src/deps";
import { buildCtx, updateProjectDoc } from "../src/runner";
import { prepareMusic } from "../src/stages/assets";
import { sfxDensityCheck } from "../src/stages/qa";
import { WorkerHost } from "../src/worker";
import type { EngineExt } from "../src/engine";
import { fixtureProject, pipelineReq, testEngine, testEnv, type TestEnv } from "./helpers";

const lic = (code: LicenseInfo["code"], restrictions: LicenseInfo["restrictions"] = []): LicenseInfo => ({
  code, version: "4.0", url: null, commercialOk: !restrictions.includes("nc"), derivativesOk: !restrictions.includes("nd"), attributionRequired: true, attributionText: null, restrictions,
});
const track = (title: string, license: LicenseInfo): LibraryTrack => ({
  file: `/library/${title}.wav`, title, moods: ["tense"], license, bpm: 90, beatsMs: [], downbeatsMs: [], durationMs: 60_000, sourceFile: `/library/${title}.wav`, sourceSha256: "0".repeat(64), licenseDeclared: true,
});

describe("library music and the licence policy", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  const frozen: string[] = [];
  beforeAll(async () => {
    t = testEnv("music-policy");
    const deps: EngineDeps = {
      ...REAL_DEPS,
      audio: {
        ...REAL_DEPS.audio,
        scanMusicLibrary: async () => [
          track("by", lic("CC-BY")), track("nc", lic("CC-BY-NC", ["nc"])), track("nd", lic("CC-BY-ND", ["nd"])), track("sa", lic("CC-BY-SA", ["sa"])),
          track("undeclared", { ...lic("UNKNOWN", ["unknown-rights"]), version: null }),
        ],
      },
      assets: {
        ...REAL_DEPS.assets,
        freezeFile: async (i) => {
          frozen.push(i.file);
          return { id: `a${frozen.length}`.padEnd(16, "0"), durationMs: 60_000 } as unknown as FrozenAsset;
        },
      },
    };
    e = await testEngine(t, { deps });
    slug = (await fixtureProject(e, "tulip-mania", "music")).slug;
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("NC, ND and SA library tracks are refused on a monetized project; undeclared ones as before", async () => {
    const store = await ProjectStore.open(t.env.DOCMAKER_PROJECTS!, slug);
    const p = await e.getProject(slug);
    await updateProjectDoc(store, {
      audio: { ...p.audio, music: "library", musicLibraryDir: t.root },
      editorial: { ...p.editorial, monetized: true },
      assets: { ...p.assets, licensePolicy: { ...p.assets.licensePolicy, allowNonCommercial: false, allowShareAlike: false, allowNoDerivatives: false } },
    });
    const inv = { stage: "assets" as const, lang: null, variant: null, options: {}, force: false };
    const ctx = await buildCtx(e.rt, store, inv, null, null);
    const r = await prepareMusic(ctx, []);
    expect(r.tracks.map((x) => x.title)).toEqual(["by"]);
    expect(frozen).toEqual(["/library/by.wav"]);
    // a non-monetized project with share-alike allowed keeps NC and SA (ND stays refused: we edit the music)
    const q = await e.getProject(slug);
    await updateProjectDoc(store, {
      editorial: { ...q.editorial, monetized: false },
      assets: { ...q.assets, licensePolicy: { ...q.assets.licensePolicy, mode: "personal", allowShareAlike: true } },
    });
    const r2 = await prepareMusic(await buildCtx(e.rt, store, inv, null, null), []);
    expect(r2.tracks.map((x) => x.title).sort()).toEqual(["by", "nc", "sa"]);
  });
});

describe("QA sfx-density", () => {
  const sfxOver: LintIssue = { level: "warn", rule: "DENSITY_MAX", where: "60s", msg: "19 SFX in 60 s (cap 15/min)" };
  const impacts: LintIssue = { level: "warn", rule: "DENSITY_MAX", where: "0s", msg: "7 impacts in 60 s (cap 4/min)" };
  it("follows the director's sliding-window, act-intensity verdict, not the fixed calendar-minute bins", () => {
    // drama: 17 events in a window under act intensity 1.15 (cap floor(15 × 1.15) = 17), and an extrapolated short tail
    expect(sfxDensityCheck([], [17, 10.61], 15)).toMatchObject({ id: "sfx-density", level: "warn", ok: true });
    expect(sfxDensityCheck([impacts], [5, 8.84], 5)).toMatchObject({ ok: true });
    expect(sfxDensityCheck([sfxOver], [19, 3], 15)).toMatchObject({ ok: false, level: "warn", message: expect.stringMatching(/19 SFX in 60 s/) });
    expect(sfxDensityCheck(null, [40], 15)).toMatchObject({ ok: true, level: "info" });
  });
});

describe("worker host", () => {
  it("a resumed (or canceled) job's project is reconciled when the worker exits, like a submitted one", async () => {
    const t = testEnv("worker-track");
    const e = await testEngine(t);
    try {
      const slug = (await fixtureProject(e, "gate-test", "wt")).slug;
      const { jobId } = await e.submit(pipelineReq(slug, "research", "research"));
      await e.waitForJob(jobId);
      const host = new WorkerHost(e.rt, { workerPath: "no/such/worker.ts", jobs: e.jobs });
      // the fork itself fails here (no worker file): the slug is tracked before the call
      await expect(host.resume(jobId)).rejects.toMatchObject({ code: "TOOL_MISSING" });
      expect(host.trackedSlugs()).toEqual([slug]);
      await host.close();
    } finally {
      await e.close();
      t.cleanup();
    }
  }, 120_000);
});
