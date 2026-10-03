// Safety suite (§16.6) on the gate-test fixture (autoApproveGates:false), through the CLI and the engine: editorial gates
// never satisfied by --yes/--max-cost, confirmed thesis, fix-only quote_mismatch, stale re-arming, person-ack, recheck,
// POLICY_DENIED user picks, NC replaceSource overrides, upload declarations, fal denylist, private persons, User-Agent,
// freeze without client licence fields. Real packages throughout; only the render client is fake (no Chrome).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApprovalsDoc, BeatPlansDoc, EntitiesDoc, FactCheck, FactSheet, OverridesDoc, P, Project, Script, StyleSuggestion, Timeline, TimelineLintDoc, UserPicksDoc, type AssetPick,
} from "@docmaker/core";
import { loadRuntime, run, userAgentFor } from "@docmaker/core/node";
import { REAL_DEPS, createEngineImpl, fixOnly, gatingItems, type EngineDeps, type EngineExt } from "@docmaker/engine";
import { runCli } from "../../apps/cli/src/main";
import type { EngineFactory, Io } from "../../apps/cli/src/context";
import { FakeRenderClient } from "../../packages/engine/test/fakes/index";
import { buildAiDenylist, checkFalPrompt } from "../../packages/assets/src/index";
import { offlineEnv, REPO_ROOT, type OfflineEnv } from "./helpers";

const NEVER = new AbortController().signal;
const SLUG = "safety";

function memIo(): Io & { stdout: string; stderr: string } {
  const io = { stdout: "", stderr: "", isTTY: false, out(s: string) { io.stdout += s; }, err(s: string) { io.stderr += s; }, async ask() { return ""; } };
  return io;
}

describe("safety suite (gate-test)", () => {
  let env: OfflineEnv;
  let engine: EngineExt;
  let factory: EngineFactory;
  let dir: string;
  const spies = { liveSearch: 0, freezeArgs: [] as unknown[] };
  const cli = async (...args: string[]) => {
    const io = memIo();
    const code = await runCli(["node", "docmaker", ...args], { io, factory, baseEnv: process.env, cwd: REPO_ROOT });
    return { code, out: io.stdout, err: io.stderr };
  };
  const read = <T>(rel: string, schema: { parse(v: unknown): T }) => schema.parse(JSON.parse(readFileSync(path.join(dir, rel), "utf8")));
  const riskFlags = () => read(P.styleSuggestion, StyleSuggestion).riskFlags;

  beforeAll(async () => {
    env = await offlineEnv("safety");
    const deps: EngineDeps = {
      ...REAL_DEPS,
      assets: {
        ...REAL_DEPS.assets,
        liveSearch: (async (...a: Parameters<typeof REAL_DEPS.assets.liveSearch>) => {
          spies.liveSearch++;
          return REAL_DEPS.assets.liveSearch(...a);
        }) as typeof REAL_DEPS.assets.liveSearch,
        freezeCandidate: (async (i: Parameters<typeof REAL_DEPS.assets.freezeCandidate>[0], ctx: Parameters<typeof REAL_DEPS.assets.freezeCandidate>[1]) => {
          spies.freezeArgs.push(i);
          return REAL_DEPS.assets.freezeCandidate(i, ctx);
        }) as typeof REAL_DEPS.assets.freezeCandidate,
      },
    };
    factory = async ({ env: e, logger }) => createEngineImpl({ cwd: REPO_ROOT, env: e, logger, deps, renderClient: new FakeRenderClient(loadRuntime({ cwd: REPO_ROOT, env: e }).config) });
    engine = await factory({ env: process.env, cwd: REPO_ROOT, logger: (await import("@docmaker/core/node")).createLogger({ level: "error" }) });
    const fx = (await engine.rt.fixture("gate-test"))!;
    await engine.createProject({ idea: fx.idea, slug: SLUG, languages: ["en"], targetMinutes: fx.targetMinutes, styleId: fx.styleId, llm: "fixture", fixtureId: fx.id, seed: fx.seed });
    dir = path.join(env.projects, SLUG);
  }, 120_000);

  afterAll(async () => {
    await engine?.close();
    await env?.restore();
  });

  let firstJob = "";
  it("--yes / --max-cost never satisfy outline-approval; the thesis must be confirmed first", async () => {
    const r = await cli("run", SLUG, "--to", "render", "--yes", "--max-cost", "1000");
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/outline-approval/);
    firstJob = /--resume (job-[\w-]+)/.exec(r.err)![1]!;
    const ap = existsSync(path.join(dir, P.approvals)) ? read(P.approvals, ApprovalsDoc).approvals : [];
    expect(ap.filter((a) => a.gate === "outline-approval")).toEqual([]);
    { const rr = await cli("approve", SLUG, "outline-approval", "--note", "fine by me"); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(1); }
    { const rr = await cli("outline", SLUG, "--approve"); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(2); }
    { const rr = await cli("outline", SLUG, "--confirm-thesis", "--approve", "--note", "thesis reviewed"); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
  }, 300_000);

  it("render is blocked by factcheck-ack, person-ack and recheck; --yes does not help", async () => {
    const r = await cli("run", SLUG, "--resume", firstJob, "--yes", "--max-cost", "1000");
    expect(r.code).toBe(3);
    for (const g of ["factcheck-ack", "person-ack", "recheck"]) expect(r.err).toContain(g);
    expect(r.err).toMatch(/never satisfy editorial gates/);
  }, 300_000);

  it("a private person named in narration is a high rule-h item and never gets a lower third", async () => {
    const fc = read(P.factcheck("en"), FactCheck);
    expect(fc.items.some((i) => i.verdict === "private_person_named" && i.risk === "high")).toBe(true);
    const facts = read(P.factsheet, FactSheet);
    const priv = facts.people.find((p) => !p.publicFigure)!;
    const t = read(P.timeline("en"), Timeline);
    const lowerThirds = t.overlays.filter((o) => o.component === "LowerThird").map((o) => JSON.stringify(o.props));
    expect(lowerThirds.some((s) => s.includes(priv.name))).toBe(false);
    // never searched: identity search refused before any provider is called
    await expect(engine.liveSearch(SLUG, { beatId: "CH1-B001", query: { text: priv.name, personIds: [priv.id] }, providers: ["wikimedia"], allowPaid: false })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(spies.liveSearch).toBe(0);
  });

  it("--ack needs a terminal; quote_mismatch can only be fixed", async () => {
    { const rr = await cli("factcheck", SLUG, "--ack", "all"); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(2); }
    const fc = read(P.factcheck("en"), FactCheck);
    const gating = gatingItems(fc, riskFlags());
    const file = path.join(env.home, "ack-all.json");
    mkdirSync(env.home, { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries(gating.map((i, k) => [i.id, `Reviewed by the editor, item ${k + 1}.`]))));
    const r = await cli("factcheck", SLUG, "--ack-file", file);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/can only be fixed/);
  });

  it("fix, acknowledge, then an edit re-arms the gate as stale", async () => {
    // fix the clip quote, re-run the fact-check, mark the recorded LLM quote item as rewritten
    const facts = read(P.factsheet, FactSheet);
    const sc = await engine.readDoc(SLUG, P.script("en"), Script);
    const fixed = structuredClone(sc.value);
    for (const ch of fixed.chapters) for (const s of ch.segments) if (s.type === "clip" && s.quoteId) s.displayText = facts.quotes.find((q) => q.id === s.quoteId)!.verbatim;
    await engine.writeDoc(SLUG, P.script("en"), Script, fixed, sc.etag);
    { const rr = await cli("factcheck", SLUG); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    let fc = await engine.readDoc(SLUG, P.factcheck("en"), FactCheck);
    const stuck = fc.value.items.filter((i) => fixOnly(i) && i.resolution === "open");
    await engine.writeDoc(SLUG, P.factcheck("en"), FactCheck, { ...fc.value, items: fc.value.items.map((i) => (stuck.some((x) => x.id === i.id) ? { ...i, resolution: "rewritten" as const } : i)) }, fc.etag);
    fc = await engine.readDoc(SLUG, P.factcheck("en"), FactCheck);
    const open = gatingItems(fc.value, riskFlags()).filter((i) => i.resolution === "open");
    const file = path.join(env.home, "ack.json");
    writeFileSync(file, JSON.stringify(Object.fromEntries(open.map((i, k) => [i.id, `Checked against the filing, item ${k + 1}.`]))));
    { const rr = await cli("factcheck", SLUG, "--ack-file", file); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    // person-ack and recheck
    const priv = facts.people.find((p) => !p.publicFigure)!;
    { const rr = await cli("persons", SLUG, "--ack", priv.id, "--note", "Named in the public court filing."); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    const re = await cli("factcheck", SLUG, "--recheck");
    expect(re.code).toBe(0);
    expect(re.out).toMatch(/rechecked C1/);
    // an edit after the acknowledgement: render blocked as stale
    const sc2 = await engine.readDoc(SLUG, P.script("en"), Script);
    const edited = structuredClone(sc2.value);
    edited.chapters[0]!.segments[0]!.displayText += " Reportedly.";
    await engine.writeDoc(SLUG, P.script("en"), Script, edited, sc2.etag);
    const blocked = await cli("render", SLUG);
    expect(blocked.code).toBe(3);
    expect(blocked.err).toMatch(/factcheck-ack/);
    const st = await engine.status(SLUG);
    expect(st.stages.find((s) => s.stage === "render")).toMatchObject({ blockedBy: "factcheck-ack", blockedReason: "stale" });
    // re-run the fact-check: resolutions carry over by stable id → the render proceeds
    { const rr = await cli("factcheck", SLUG); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    const fc3 = await engine.readDoc(SLUG, P.factcheck("en"), FactCheck);
    const open3 = gatingItems(fc3.value, riskFlags()).filter((i) => i.resolution === "open");
    if (open3.length) {
      writeFileSync(file, JSON.stringify(Object.fromEntries(open3.map((i, k) => [i.id, `Re-checked after the edit, item ${k + 1}.`]))));
      { const rr = await cli("factcheck", SLUG, "--ack-file", file); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    }
    const ok = await cli("run", SLUG, "--from", "beatslice", "--to", "render");
    expect(ok.code, ok.err + ok.out).toBe(0);
    expect(ok.err).toBe("");
  }, 600_000);

  it("user picks: an AI-generated image on a person beat is refused (POLICY_DENIED); uploads need a declaration", async () => {
    const png = path.join(env.home, "ai.png");
    await run(loadRuntime({ cwd: REPO_ROOT, env: process.env }).config.ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x445566:s=1920x1080", "-frames:v", "1", png], { signal: NEVER });
    await expect(engine.upload(SLUG, { tmpPath: png, kind: "asset", lang: null, declaration: null, segmentId: null })).rejects.toMatchObject({ code: "VALIDATION" });
    const up = await engine.upload(SLUG, { tmpPath: png, kind: "asset", lang: null, declaration: { kind: "ai-generated", license: "AI-GENERATED", author: "", url: "", note: "" }, segmentId: null });
    const plans = read(P.beatPlans, BeatPlansDoc);
    const beat = plans.plans.find((p) => p.personIds.length > 0)!;
    const pick: AssetPick = { beatId: beat.id, slot: 0, assetId: up.asset!.id, role: "primary", focal: { x: 0.5, y: 0.45 }, crop: null, sourceInMs: null, sourceOutMs: null, score: { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "" }, pickedBy: "user", planKey: beat.planKey };
    await expect(engine.writeDoc(SLUG, P.userPicks, UserPicksDoc, { schemaVersion: 1, picks: [pick], portraits: [], clips: [] }, null)).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("a replaceSource override with a non-commercial asset under monetized is rejected with a POLICY lint", async () => {
    const png = path.join(env.home, "nc.png");
    await run(loadRuntime({ cwd: REPO_ROOT, env: process.env }).config.ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x665544:s=1920x1080", "-frames:v", "1", png], { signal: NEVER });
    const up = await engine.upload(SLUG, { tmpPath: png, kind: "asset", lang: null, declaration: { kind: "licensed", license: "CC-BY-NC", author: "A. Photographer", url: "https://example.org/photo", note: "" }, segmentId: null });
    const t = read(P.timeline("en"), Timeline);
    const clip = t.video.find((c) => c.source.kind === "image")!;
    const ov: OverridesDoc = {
      schemaVersion: 1, lang: "en",
      overrides: [{ id: "ov-nc", createdAt: "2026-10-03T00:00:00.000Z", target: { itemId: clip.id, component: null, beatId: null, planKey: null, assetId: clip.source.kind === "image" ? clip.source.assetId : null, wordNorm: null }, override: { op: "replaceSource", clipId: clip.id, source: { kind: "image", assetId: up.asset!.id, crop: null, focal: { x: 0.5, y: 0.5 } } } }],
    };
    await engine.writeDoc(SLUG, P.overrides("en"), OverridesDoc, ov, null);
    { const rr = await cli("direct", SLUG); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    const lint = read(P.timelineLint("en"), TimelineLintDoc);
    const rejected = lint.rejectedOverrides.find((r) => r.id === "ov-nc");
    expect(rejected?.reason).toMatch(/policy|licen[cs]e/i);
    // the director reports the refused override as a POLICY lint error with the policy reason (§16.6)
    expect(lint.issues.some((i) => i.rule === "POLICY" && i.level === "error" && /policy|licen[cs]e/i.test(i.msg))).toBe(true);
    const t2 = read(P.timeline("en"), Timeline);
    expect(t2.video.some((c) => c.source.kind === "image" && c.source.assetId === up.asset!.id)).toBe(false);
  }, 300_000);

  it("an accusatory title cannot be marked \"rewritten\" while it still reads the same; the export stays blocked", async () => {
    const p = await engine.readDoc(SLUG, P.project, Project);
    await engine.writeDoc(SLUG, P.project, Project, { ...p.value, publish: { ...p.value.publish, en: { title: "The banker who defrauded his clients", thumbnailText: "FRAUDSTER", description: "" } } }, p.etag);
    { const rr = await cli("factcheck", SLUG); expect(rr.code, rr.err + rr.out.slice(-600)).toBe(0); }
    const fc = await engine.readDoc(SLUG, P.factcheck("en"), FactCheck);
    const surfaces = fc.value.items.filter((i) => (i.where === "title" || i.where === "thumbnail") && i.risk === "high");
    expect(surfaces.map((i) => i.where).sort()).toEqual(["thumbnail", "title"]);
    await expect(engine.writeDoc(SLUG, P.factcheck("en"), FactCheck, { ...fc.value, items: fc.value.items.map((i) => (surfaces.some((x) => x.id === i.id) ? { ...i, resolution: "rewritten" as const } : i)) }, fc.etag))
      .rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/rewrite it first/) });
    // the title reaches the publish kit through export (the rendered picture does not carry it: render stays up to date)
    const blocked = await cli("export", SLUG);
    expect(blocked.code, blocked.err + blocked.out.slice(-600)).toBe(3);
    expect(blocked.err).toMatch(/factcheck-ack/);
    for (const i of surfaces) expect(blocked.out + blocked.err).toContain(i.id);
  }, 600_000);

  it("fal prompts naming a person (surname or alias) are refused", () => {
    const facts = read(P.factsheet, FactSheet);
    const entities = read(P.entities, EntitiesDoc);
    const deny = buildAiDenylist(facts, entities);
    const pub = facts.people.find((p) => p.publicFigure)!;
    const surname = pub.name.split(/\s+/).at(-1)!;
    expect(checkFalPrompt(`an office building at night where ${surname} worked`, deny).ok).toBe(false);
    expect(checkFalPrompt("photorealistic portrait of a CEO", deny).ok).toBe(false);
    expect(checkFalPrompt("an empty office at night, rain on the windows", deny).ok).toBe(true);
  });

  it("the User-Agent carries the contact only for allowlisted hosts", () => {
    const { config } = loadRuntime({ cwd: REPO_ROOT, env: process.env });
    const c = { ...config, contact: "https://example.org/contact" };
    expect(userAgentFor("https://api.pexels.com/v1/search", c)).not.toMatch(/contact/);
    expect(userAgentFor("https://example.com/x", c)).toBe(c.userAgentBase);
    expect(userAgentFor("https://commons.wikimedia.org/w/api.php", c)).toMatch(/contact: https:\/\/example\.org\/contact/);
  });

  it("freeze never forwards client licence fields", async () => {
    await engine.freeze(SLUG, { beatId: "CH1-B001", slot: 0, provider: "wikimedia", providerAssetId: "File:X.jpg", license: { code: "CC0" } } as never).catch(() => undefined);
    expect(spies.freezeArgs.length).toBe(1);
    expect(Object.keys(spies.freezeArgs[0] as object).sort()).toEqual(["beatId", "projectDir", "provider", "providerAssetId"]);
  });

  it("never reached the network", () => {
    expect(env.proxyConnections()).toBe(0);
  });
});
