// Pure helpers: pipeline planning, QA parsers, doctor parsers, worker env, render tokens, music planning, utilities.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_KEYS, type Approval, type ApprovalsDoc, type BeatPlan, type FactCheck, type FactCheckItem, type JobRequest, type StylePlugin } from "@docmaker/core";
import { TEST_STYLE, makeProject } from "@docmaker/core/testing";
import { planInvocations, stageRange } from "../src/pipeline";
import { blackViolations, parseBlackdetect, parseFreezedetect, sheetFrames } from "../src/stages/qa";
import { contactCheck, nodeVersionCheck, parseFfmpegList, parseFfmpegVersion, rateLimitedContactHosts, versionAtLeast } from "../src/doctor";
import { workerEnv, workerForkOptions } from "../src/worker";
import { buildRenderTokens, filterPlans, filterScript } from "../src/stages/common";
import { musicOptionsFor, usedMoods } from "../src/stages/assets";
import { clipNarratedOf, finalTakeGated } from "../src/stages/voice";
import { newRefErrors } from "../src/runner";
import { JOB_ID_RE, newJobId, orderLangs, pickOptions } from "../src/util";
import { demoSlug } from "../src/demo";
import { ACK_SIG_PREFIX, ackCoverage, ackSignature, changedSinceAck, reopenChanged } from "../src/gates";
import { makeScript } from "@docmaker/core/testing";

const req = (o: Partial<JobRequest>): JobRequest => ({ slug: "p", kind: "pipeline", stage: null, from: null, to: null, langs: [], force: false, options: {}, preset: null, ...o });
const style = { data: TEST_STYLE, fonts: [], dir: "/x", source: "builtin", dataHash: "h", promptPack: {} } as unknown as StylePlugin;

describe("planInvocations", () => {
  const p = makeProject({ languages: ["en", "fr"], primaryLang: "en" });
  it("orders stage-major, primary language first, variants for render/qa", () => {
    const plan = planInvocations(p, req({ from: "beatslice", to: "qa", langs: ["fr", "en"], preset: "master" }));
    expect(plan.map((i) => `${i.stage}${i.lang ? "." + i.lang : ""}${i.variant ? "@" + i.variant : ""}`)).toEqual([
      "beatslice.en", "beatslice.fr", "factcheck.en", "factcheck.fr", "assets", "voice.en", "voice.fr", "layout.en", "layout.fr", "direct.en", "direct.fr",
      "mix.en", "mix.fr", "render.en@master", "render.fr@master", "export.en", "export.fr", "qa.en@master", "qa.fr@master",
    ]);
  });
  it("runs the primary script/beatslice whenever a secondary language is requested (pipelines only)", () => {
    const plan = planInvocations(p, req({ from: "script", to: "beatslice", langs: ["fr"] }));
    expect(plan.map((i) => `${i.stage}${i.lang ? "." + i.lang : ""}`)).toEqual(["script.en", "script.fr", "beats", "beatslice.en", "beatslice.fr"]);
    expect(planInvocations(p, req({ kind: "stage", stage: "script", langs: ["fr"] })).map((i) => i.lang)).toEqual(["fr"]);
  });
  it("defaults: research → qa, the project's default preset", () => {
    const plan = planInvocations(makeProject(), req({}));
    expect(plan[0]!.stage).toBe("research");
    expect(plan.at(-1)).toMatchObject({ stage: "qa", variant: "draft" });
  });
  it("rejects reversed ranges and foreign languages", () => {
    expect(() => stageRange("qa", "research")).toThrow(/comes after/);
    expect(() => planInvocations(makeProject({ languages: ["en"], primaryLang: "en" }), req({ langs: ["fr"] }))).toThrow(/not project languages/);
  });
});

describe("QA parsers", () => {
  it("parses blackdetect and enforces one dip ≤ 1.4 s", () => {
    const s = "[blackdetect @ 0x1] black_start:10.5 black_end:11.6 black_duration:1.1\n[blackdetect @ 0x1] black_start:30 black_end:31.2 black_duration:1.2\n";
    const runs = parseBlackdetect(s);
    expect(runs).toEqual([{ start: 10.5, end: 11.6, duration: 1.1 }, { start: 30, end: 31.2, duration: 1.2 }]);
    expect(blackViolations(runs.slice(0, 1))).toEqual([]);
    expect(blackViolations(runs)).toEqual([runs[1]]);
    expect(blackViolations([{ start: 0, end: 2, duration: 2 }])).toHaveLength(1);
  });
  it("parses freezedetect metadata", () => {
    const s = "[Parsed_metadata_2 @ 0x] lavfi.freezedetect.freeze_start: 4.2\n[Parsed_metadata_2 @ 0x] lavfi.freezedetect.freeze_duration: 3.8\n[Parsed_metadata_2 @ 0x] lavfi.freezedetect.freeze_end: 8\n";
    expect(parseFreezedetect(s)).toEqual([{ start: 4.2, end: 8, duration: 3.8 }]);
  });
  it("picks first/middle/last frames of each shot, capped", () => {
    const video = [{ from: 0, dur: 30 }, { from: 30, dur: 31 }] as never;
    expect(sheetFrames({ video, durationInFrames: 61 })).toEqual([0, 14, 29, 30, 45, 60]);
    const many = Array.from({ length: 100 }, (_, i) => ({ from: i * 10, dur: 10 })) as never;
    expect(sheetFrames({ video: many, durationInFrames: 1000 }, 60)).toHaveLength(60);
  });
});

describe("doctor parsers", () => {
  it("reads ffmpeg versions and feature lists", () => {
    expect(parseFfmpegVersion("ffmpeg version 6.1.1-3ubuntu5 Copyright")).toEqual([6, 1]);
    expect(parseFfmpegVersion("ffmpeg version n7.0.2")).toEqual([7, 0]);
    expect(versionAtLeast([6, 0], [6, 1])).toBe(false);
    expect(versionAtLeast([7, 0], [6, 1])).toBe(true);
    const list = parseFfmpegList(" T.. loudnorm          A->A       EBU R128 loudness normalization\n ... blackdetect       V->V       Detect\n V....D libx264              libx264 H.264\n");
    expect([...list].sort()).toEqual(["blackdetect", "libx264", "loudnorm"]);
  });
  it("node 22.12+ < 23", () => {
    expect(nodeVersionCheck("22.22.0").ok).toBe(true);
    expect(nodeVersionCheck("22.11.0")).toMatchObject({ ok: false, level: "error" });
    expect(nodeVersionCheck("24.1.0")).toMatchObject({ ok: false, level: "warn" });
  });
});

describe("doctor contact check", () => {
  it("unset contact → one hint naming DOCMAKER_CONTACT (never an invented address), with recent Wikimedia 429s named", async () => {
    expect(contactCheck("https://example.org/c", ["commons.wikimedia.org"])).toEqual({ id: "contact", ok: true, level: "warn", value: "set", hint: null });
    const plain = contactCheck(null, []);
    expect(plain).toMatchObject({ ok: false, level: "warn", value: "unset" });
    expect(plain.hint).toMatch(/^set DOCMAKER_CONTACT to an e-mail address or URL of your choice/);
    expect(plain.hint).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    const dir = mkdtempSync(path.join(os.tmpdir(), "docmaker-doctor-"));
    try {
      expect(await rateLimitedContactHosts(dir)).toEqual([]); // no file
      writeFileSync(path.join(dir, "host-cooldown.json"), JSON.stringify({ "upload.wikimedia.org": 1, "commons.wikimedia.org": 2, "api.pexels.com": 3 }));
      const hosts = await rateLimitedContactHosts(dir);
      expect(hosts).toEqual(["commons.wikimedia.org", "upload.wikimedia.org"]);
      expect(contactCheck(null, hosts).value).toBe("unset; rate-limited recently by commons.wikimedia.org, upload.wikimedia.org");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("worker fork", () => {
  it("passes only what the worker needs, and NODE_USE_ENV_PROXY with a proxy", () => {
    const env = workerEnv({ PATH: "/bin", HOME: "/h", HTTPS_PROXY: "http://p:1", [ENV_KEYS.anthropic]: "sk", DOCMAKER_HOME: "/d", SECRET_THING: "x", npm_config_foo: "y" });
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h", HTTPS_PROXY: "http://p:1", ANTHROPIC_API_KEY: "sk", DOCMAKER_HOME: "/d", NODE_USE_ENV_PROXY: "1" });
    expect(env.SECRET_THING).toBeUndefined();
    expect(env.npm_config_foo).toBeUndefined();
    const o = workerForkOptions("/repo", {});
    expect(o.cwd).toBe("/repo");
    expect(o.execArgv).toEqual(["--import", "/repo/node_modules/tsx/dist/esm/index.mjs"]);
    expect(o.env.DOCMAKER_REPO_ROOT).toBe("/repo");
    expect((o.env as NodeJS.ProcessEnv).NODE_USE_ENV_PROXY).toBeUndefined();
  });
});

describe("render tokens and filters", () => {
  it("merges the theme override and resolves the caption variant without mutating the style", () => {
    const before = JSON.stringify(TEST_STYLE.tokens);
    const t = buildRenderTokens(style, { themeOverride: { accent: "#FF0000", backdropRecipe: "paper", texture: null, fontHeadline: "Not A Font" }, captionsVariant: "pop" }, []);
    expect(t.tokens.palette.accent).toBe("#FF0000");
    expect(t.tokens.backdrop).toBe("paper");
    expect(t.captionDNA.variant).toBe("pop");
    expect(t.tokens.fonts.headline).toBe(TEST_STYLE.tokens.fonts.headline); // unknown font ignored
    expect(t.theme?.fontHeadline).toBeNull();
    expect(JSON.stringify(TEST_STYLE.tokens)).toBe(before);
    expect(buildRenderTokens(style, { themeOverride: null, captionsVariant: null }, []).captionDNA.variant).toBe(TEST_STYLE.captionDNA.variant);
  });
  it("onlyChapters filters script and plans; an empty selection is refused", () => {
    const s = makeScript({ chapters: 3 });
    expect(filterScript(s, ["CH2"]).chapters.map((c) => c.chapterId)).toEqual(["CH2"]);
    expect(filterScript(s, null)).toBe(s);
    expect(() => filterScript(s, ["CH9"])).toThrow(/selects no chapter/);
    const plans = [{ id: "CH1-B001", chapterId: "CH1" }, { id: "CH2-B001", chapterId: "CH2" }] as BeatPlan[];
    expect(filterPlans(plans, ["CH2"]).map((p) => p.id)).toEqual(["CH2-B001"]);
  });
});

describe("music and voice planning", () => {
  it("one procedural track per used mood, deterministic options", () => {
    const plans = [{ musicMood: "tense", energy: 4 }, { musicMood: "tense", energy: 4 }, { musicMood: "sad", energy: 1 }, { musicMood: "none", energy: 3 }] as BeatPlan[];
    expect(usedMoods(plans)).toEqual([{ mood: "sad", energy: "low" }, { mood: "tense", energy: "high" }]);
    expect(usedMoods([])).toEqual([{ mood: "mysterious", energy: "mid" }]);
    const a = musicOptionsFor({ seed: 7, targetMinutes: 1.5 }, style, "tense", "high");
    expect(a).toEqual(musicOptionsFor({ seed: 7, targetMinutes: 1.5 }, style, "tense", "high"));
    expect(a.bpm).toBe(TEST_STYLE.musicPolicy.moodBpm.tense);
    expect(a.bars * 240 / a.bpm).toBeGreaterThanOrEqual(120 - 1e-6);
    expect(musicOptionsFor({ seed: 8, targetMinutes: 1.5 }, style, "tense", "high").seed).not.toBe(a.seed);
  });
  it("final takes are gated unless synthetic; narrated clip fallbacks follow the clip status", () => {
    const p = makeProject();
    expect(finalTakeGated(p, "en", "final")).toBe(p.voice.en?.provider !== "synthetic");
    expect(finalTakeGated({ ...p, voice: { en: { ...p.voice.en!, provider: "elevenlabs" } } }, "en", "scratch")).toBe(false);
    expect(finalTakeGated({ ...p, voice: { en: { ...p.voice.en!, provider: "elevenlabs" } } }, "en", "final")).toBe(true);
    const s = makeScript({ withClip: true });
    const clip = s.chapters.flatMap((c) => c.segments).find((x) => x.type === "clip")!;
    expect(clipNarratedOf({ ...p, assets: { ...p.assets, clipFallback: "narrated" } }, s, null)).toEqual([clip.id]);
    expect(clipNarratedOf({ ...p, assets: { ...p.assets, clipFallback: "card" } }, s, null)).toEqual([]);
    const found = { schemaVersion: 1, plansHash: "0".repeat(64), picks: [], portraits: [], orphans: [], updatedAt: "2026-10-02T00:00:00.000Z", clips: [{ segmentId: clip.id, quoteId: clip.quoteId!, assetId: "a".repeat(64), status: "found", source: "auto", youtube: null, passageInMs: 0, passageOutMs: 1000, reason: "" }] } as never;
    expect(clipNarratedOf({ ...p, assets: { ...p.assets, clipFallback: "narrated" } }, s, found)).toEqual([]);
  });
});

describe("utilities", () => {
  it("job ids, language order, option picking, new reference errors, demo slugs", () => {
    expect(newJobId(new Date("2026-10-03T04:05:06Z"))).toMatch(/^job-20261003-040506-[a-f0-9]{6}$/);
    expect(JOB_ID_RE.test(newJobId())).toBe(true);
    expect(orderLangs({ languages: ["fr", "en"], primaryLang: "en" }, null)).toEqual(["en", "fr"]);
    expect(orderLangs({ languages: ["en", "fr"], primaryLang: "fr" }, ["en", "fr", "fr"])).toEqual(["fr", "en"]);
    expect(pickOptions({ onlyChapters: ["CH1"], newRequest: true, segments: undefined }, ["segments", "onlyChapters"])).toEqual({ onlyChapters: ["CH1"] });
    const a = { level: "error" as const, rule: "REF_PICK", where: "x", msg: "m" };
    const b = { level: "error" as const, rule: "REF_CLIP", where: "y", msg: "n" };
    expect(newRefErrors([a], [a, b, { ...b, level: "warn" as const }])).toEqual([b]);
    expect(demoSlug("tulip-mania", new Date("2026-10-03T04:05:06Z"))).toBe("demo-tulip-mania-20261003-040506");
  });
});

describe("factcheck-ack coverage", () => {
  const item = (id: string, verdict: FactCheckItem["verdict"], risk: FactCheckItem["risk"], resolution: FactCheckItem["resolution"] = "acknowledged"): FactCheckItem => ({
    id, where: "CH1-S01", surface: "narration", sentence: `sentence ${id}`, claimKind: "number", verdict, risk, factIds: [], problem: "p", suggestedRewrite: "",
    origin: "llm", rule: null, resolution, note: resolution === "open" ? "" : "Checked against the 1637 notary deed.",
  });
  const approval = (lang: "en" | "fr" | null, ids: string[], sigs: Record<string, string>): Approval => ({
    gate: "factcheck-ack", stage: "factcheck", lang, planHash: "a".repeat(64), approvedAt: "2026-10-01T00:00:00.000Z", by: "cli", note: "", items: ids,
    itemNotes: Object.fromEntries(Object.entries(sigs).map(([id, s]) => [ACK_SIG_PREFIX + id, s])),
  });

  it("covers an item only for the verdict and risk it was approved with", () => {
    const doc: ApprovalsDoc = { schemaVersion: 1, approvals: [approval("en", ["FC-1", "FC-2"], { "FC-1": "unsupported|high", "FC-2": "needs_attribution|high" }), approval("fr", ["FC-3"], { "FC-3": "unsupported|high" })] };
    const cov = ackCoverage(doc, "en");
    expect([...cov.keys()].sort()).toEqual(["FC-1", "FC-2"]);
    const gating = [item("FC-1", "contradicted", "high"), item("FC-2", "needs_attribution", "high"), item("FC-4", "unsupported", "high", "dismissed")];
    expect(changedSinceAck(gating, cov).map((i) => i.id)).toEqual(["FC-1"]);
    expect(ackSignature(gating[0]!)).toBe("contradicted|high");
    // an approval without recorded signatures (legacy) covers nothing: the item needs a new review
    const legacy: ApprovalsDoc = { schemaVersion: 1, approvals: [approval(null, ["FC-2"], {})] };
    expect(changedSinceAck(gating, ackCoverage(legacy, "en")).map((i) => i.id)).toEqual(["FC-2"]);
  });

  it("re-opens carried-over resolutions whose verdict or risk changed", () => {
    const prev = { items: [item("FC-1", "unsupported", "high"), item("FC-2", "needs_attribution", "medium", "dismissed"), item("FC-3", "unsupported", "high")] } as FactCheck;
    const next = [item("FC-1", "contradicted", "high"), item("FC-2", "needs_attribution", "high", "dismissed"), item("FC-3", "unsupported", "high"), item("FC-5", "unsupported", "high", "open")];
    const out = reopenChanged(next, prev);
    expect(out.map((i) => i.resolution)).toEqual(["open", "open", "acknowledged", "open"]);
    expect(out[0]!.note).toBe("Checked against the 1637 notary deed."); // the reviewer's text stays as a draft
    expect(reopenChanged(next, null)).toEqual(next);
  });
});
