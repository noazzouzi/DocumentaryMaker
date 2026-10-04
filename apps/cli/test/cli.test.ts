// CLI: parsing, exit codes (0/1/2/3/4), --yes/--max-cost never editorial, --ack all refused without a TTY,
// --ack-file (mocked engine), and one real run of `demo` on the walking-skeleton fakes.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Approval, FactCheck, GateId, JobEvent, JobRecord, JobRequest } from "@docmaker/core";
import type { EngineExt } from "@docmaker/engine";
import { runCli } from "../src/main";
import type { EngineFactory, Io } from "../src/context";
import { shareTestCaches } from "../../../packages/engine/test/shared-home";

function memIo(tty = false): Io & { stdout: string; stderr: string; answers: string[] } {
  const io = {
    stdout: "", stderr: "", answers: [] as string[], isTTY: tty,
    out(s: string) { io.stdout += s; },
    err(s: string) { io.stderr += s; },
    async ask() { return io.answers.shift() ?? ""; },
  };
  return io;
}

const NOW = "2026-10-03T00:00:00.000Z";
type Script = { status: JobRecord["status"]; events: Omit<JobEvent, "jobId" | "seq" | "at">[] }[];

/** Mock engine: each submit/resume plays the next scripted job. */
function mockEngine(script: Script, extra: Partial<EngineExt> = {}) {
  const approvals: { slug: string; gate: GateId; a: Omit<Approval, "gate" | "approvedAt"> }[] = [];
  const submitted: JobRequest[] = [];
  const records = new Map<string, JobRecord>();
  let n = 0;
  const next = (req: JobRequest, resumeOf: string | null) => {
    const k = n++;
    const id = `job-20261003-00000${k}-aaaaa${k}`;
    const s = script[Math.min(k, script.length - 1)]!;
    records.set(id, { id, request: req, status: s.status, createdAt: NOW, startedAt: NOW, endedAt: NOW, error: s.status === "failed" ? { code: "INTERNAL", message: "boom" } : null, coalescedInto: null, resumeOf });
    return { id, s };
  };
  const plays = new Map<string, Script[number]>();
  const engine = {
    config: { projectsDir: "/tmp/none", repoRoot: "/tmp", paths: { envFile: "/tmp/.env" } },
    async submit(req: JobRequest) {
      submitted.push(req);
      const { id, s } = next(req, null);
      plays.set(id, s);
      return { jobId: id, coalesced: false };
    },
    async resume(jobId: string) {
      const rec = records.get(jobId)!;
      const { id, s } = next(rec.request, jobId);
      plays.set(id, s);
      return { jobId: id };
    },
    async cancel() {},
    async getJob(id: string) {
      return records.get(id) ?? null;
    },
    async *events(id: string) {
      const s = plays.get(id)!;
      let seq = 0;
      for (const e of [...s.events, { type: "job-end", status: s.status }]) yield { ...e, jobId: id, seq: seq++, at: NOW } as JobEvent;
    },
    async approve(slug: string, gate: GateId, a: Omit<Approval, "gate" | "approvedAt">) {
      if (["outline-approval", "factcheck-ack", "person-ack", "recheck", "fair-use"].includes(gate) && a.by === "flag") throw new Error("editorial");
      approvals.push({ slug, gate, a });
    },
    async close() {},
    ...extra,
  } as unknown as EngineExt;
  const factory: EngineFactory = async () => engine;
  return { engine, factory, approvals, submitted };
}

const argv = (...a: string[]) => ["node", "docmaker", ...a];
const need = (gate: GateId, planHash = "a".repeat(64)) => ({ type: "needs-approval", gate, stage: "render", lang: "en", planHash, reason: "unmet", summary: `${gate} needed` }) as const;
const estimate = (usd: number, planHash = "a".repeat(64)) => ({ type: "estimate", estimate: { schemaVersion: 1, id: "est-x", stage: "script", lang: "en", lines: [], totalUsd: usd, confidence: "estimate", planHash, createdAt: NOW } }) as const;

describe("parsing and exit codes", () => {
  it("prints the version without a command; unknown commands and bad options are usage errors (2)", async () => {
    const io = memIo();
    expect(await runCli(argv(), { io })).toBe(0);
    expect(io.stdout).toMatch(/docmaker \d+\.\d+\.\d+/);
    expect(await runCli(argv("--version"), { io: memIo() })).toBe(0);
    expect(await runCli(argv("bogus"), { io: memIo() })).toBe(2);
    const m = mockEngine([{ status: "succeeded", events: [] }]);
    expect(await runCli(argv("run", "p", "--from", "nope"), { io: memIo(), factory: m.factory })).toBe(2);
    expect(await runCli(argv("run", "p", "--max-cost", "-3"), { io: memIo(), factory: m.factory })).toBe(2);
    expect(await runCli(argv("run", "p", "--lang", "de"), { io: memIo(), factory: m.factory })).toBe(2);
    expect(await runCli(argv("approve", "p", "cost"), { io: memIo(), factory: m.factory })).toBe(2);
    expect(await runCli(argv("approve", "p", "nope-gate"), { io: memIo(), factory: m.factory })).toBe(2);
    expect(await runCli(argv("assets", "import", "p", "/tmp"), { io: memIo(), factory: m.factory })).toBe(2);
    expect(m.submitted).toHaveLength(0);
  });

  it("maps job outcomes: succeeded 0, failed 1, waiting 3, canceled 4", async () => {
    for (const [status, code] of [["succeeded", 0], ["failed", 1], ["canceled", 4]] as const) {
      const m = mockEngine([{ status, events: [] }]);
      expect(await runCli(argv("run", "p"), { io: memIo(), factory: m.factory })).toBe(code);
    }
    const m = mockEngine([{ status: "waiting-approval", events: [need("outline-approval")] }]);
    const io = memIo();
    expect(await runCli(argv("run", "p"), { io, factory: m.factory })).toBe(3);
    expect(io.stderr).toMatch(/docmaker outline p --confirm-thesis --approve/);
    expect(io.stderr).toMatch(/docmaker run p --resume job-/);
  });

  it("jobs --cancel: an ended job is reported (exit 1), a running one is canceled through the engine", async () => {
    const rec = (id: string, status: JobRecord["status"]): JobRecord => ({ id, request: { slug: "p", kind: "stage", stage: "render", from: null, to: null, langs: [], force: false, options: {}, preset: null }, status, createdAt: NOW, startedAt: NOW, endedAt: null, error: null, coalescedInto: null, resumeOf: null });
    const jobs = new Map([["job-20261003-000000-aaaaa0", rec("job-20261003-000000-aaaaa0", "failed")], ["job-20261003-000001-aaaaa1", rec("job-20261003-000001-aaaaa1", "running")]]);
    const canceled: string[] = [];
    const m = mockEngine([{ status: "succeeded", events: [] }], {
      getJob: (async (id: string) => jobs.get(id) ?? null) as EngineExt["getJob"],
      cancel: (async (id: string) => {
        canceled.push(id);
        jobs.set(id, { ...jobs.get(id)!, status: "canceled" });
      }) as EngineExt["cancel"],
    });
    let io = memIo();
    expect(await runCli(argv("jobs", "p", "--cancel", "job-20261003-000000-aaaaa0"), { io, factory: m.factory })).toBe(1);
    expect(io.stderr).toMatch(/already ended \(failed\)/);
    expect(io.stdout).toBe("");
    expect(canceled).toEqual([]);
    io = memIo();
    expect(await runCli(argv("jobs", "p", "--cancel", "job-20261003-000001-aaaaa1"), { io, factory: m.factory })).toBe(0);
    expect(io.stdout).toBe("canceled job-20261003-000001-aaaaa1\n");
    expect(canceled).toEqual(["job-20261003-000001-aaaaa1"]);
    expect(await runCli(argv("jobs", "p", "--cancel", "job-20261003-000009-aaaaa9"), { io: memIo(), factory: m.factory })).toBe(2);
  });

  it("builds the pipeline request from the flags", async () => {
    const m = mockEngine([{ status: "succeeded", events: [] }]);
    expect(await runCli(argv("run", "p", "--from", "layout", "--to", "render", "--lang", "fr", "--preset", "master", "--chapters", "ch1,CH2", "--force", "--new-request"), { io: memIo(), factory: m.factory })).toBe(0);
    expect(m.submitted[0]).toEqual({
      slug: "p", kind: "pipeline", stage: null, from: "layout", to: "render", langs: ["fr"], force: true, preset: "master",
      options: { onlyChapters: ["CH1", "CH2"], newRequest: true },
    });
  });
});

describe("chapter selection of stages downstream of layout", () => {
  const withLayout = (only: string[] | null) => mockEngine([{ status: "succeeded", events: [] }], {
    getProject: (async () => ({ languages: ["en"], render: {} })) as unknown as EngineExt["getProject"],
    readDoc: (async (_slug: string, rel: string) => {
      if (rel !== "layout/en.json") throw new Error("missing");
      return { value: { onlyChapters: only }, etag: "x" };
    }) as unknown as EngineExt["readDoc"],
  });
  it("direct/mix/render without --chapters reuse the layout's selection; layout itself defaults to all chapters", async () => {
    for (const cmd of ["direct", "mix", "render"]) {
      const m = withLayout(["CH1", "CH2"]);
      const io = memIo();
      expect(await runCli(argv(cmd, "p"), { io, factory: m.factory })).toBe(0);
      expect(m.submitted[0]!.options.onlyChapters, cmd).toEqual(["CH1", "CH2"]);
      expect(io.stderr).toMatch(/chapters CH1,CH2 as laid out/);
    }
    const lay = withLayout(["CH1", "CH2"]);
    expect(await runCli(argv("layout", "p"), { io: memIo(), factory: lay.factory })).toBe(0);
    expect(lay.submitted[0]!.options.onlyChapters).toBeUndefined();
    const all = withLayout(null);
    expect(await runCli(argv("direct", "p"), { io: memIo(), factory: all.factory })).toBe(0);
    expect(all.submitted[0]!.options.onlyChapters).toBeUndefined();
    const explicit = withLayout(["CH1", "CH2"]);
    expect(await runCli(argv("direct", "p", "--chapters", "CH3"), { io: memIo(), factory: explicit.factory })).toBe(0);
    expect(explicit.submitted[0]!.options.onlyChapters).toEqual(["CH3"]);
  });
});

describe("--yes and --max-cost", () => {
  it("--yes approves a cost gate (by flag) and resumes", async () => {
    const m = mockEngine([{ status: "waiting-approval", events: [estimate(2), need("cost")] }, { status: "succeeded", events: [] }]);
    expect(await runCli(argv("run", "p", "--yes"), { io: memIo(), factory: m.factory })).toBe(0);
    expect(m.approvals).toEqual([{ slug: "p", gate: "cost", a: expect.objectContaining({ by: "flag", planHash: "a".repeat(64) }) }]);
  });

  it("--yes never satisfies an editorial gate (exit 3, nothing approved)", async () => {
    for (const gate of ["outline-approval", "factcheck-ack", "person-ack", "recheck", "fair-use"] as const) {
      const m = mockEngine([{ status: "waiting-approval", events: [need(gate)] }]);
      const io = memIo();
      expect(await runCli(argv("run", "p", "--yes", "--max-cost", "1000"), { io, factory: m.factory })).toBe(3);
      expect(m.approvals).toEqual([]);
      expect(io.stderr).toMatch(/never satisfy editorial gates/);
    }
  });

  it("--max-cost approves only when the estimate fits", async () => {
    const over = mockEngine([{ status: "waiting-approval", events: [estimate(2), need("cost")] }]);
    expect(await runCli(argv("run", "p", "--max-cost", "1.5"), { io: memIo(), factory: over.factory })).toBe(3);
    expect(over.approvals).toEqual([]);
    const fits = mockEngine([{ status: "waiting-approval", events: [estimate(2), need("cost")] }, { status: "succeeded", events: [] }]);
    expect(await runCli(argv("run", "p", "--max-cost", "2.5"), { io: memIo(), factory: fits.factory })).toBe(0);
    expect(fits.approvals[0]).toMatchObject({ gate: "cost", a: { by: "flag" } });
  });

  it("--yes confirms the style gate", async () => {
    const m = mockEngine([{ status: "waiting-approval", events: [need("style-confirm")] }, { status: "succeeded", events: [] }]);
    expect(await runCli(argv("run", "p", "-y"), { io: memIo(), factory: m.factory })).toBe(0);
    expect(m.approvals[0]).toMatchObject({ gate: "style-confirm", a: { by: "flag" } });
  });
});

describe("research", () => {
  const withInfo = (info: { saved: number; matches: boolean; complete: boolean }) => ({
    async researchResume() {
      return info;
    },
    async readDoc() {
      throw new Error("missing");
    },
  }) as unknown as Partial<EngineExt>;

  it("runs the research stage behind the cost gate (--yes approves it)", async () => {
    const m = mockEngine([{ status: "waiting-approval", events: [estimate(3.2), need("cost")] }, { status: "succeeded", events: [] }], withInfo({ saved: 0, matches: false, complete: false }));
    expect(await runCli(argv("research", "p", "--yes"), { io: memIo(), factory: m.factory })).toBe(0);
    expect(m.submitted[0]).toEqual({ slug: "p", kind: "stage", stage: "research", from: null, to: null, langs: [], force: false, preset: null, options: {} });
    expect(m.approvals).toEqual([{ slug: "p", gate: "cost", a: expect.objectContaining({ by: "flag" }) }]);
    const capped = mockEngine([{ status: "waiting-approval", events: [estimate(3.2), need("cost")] }], withInfo({ saved: 0, matches: false, complete: false }));
    expect(await runCli(argv("research", "p", "--max-cost", "2"), { io: memIo(), factory: capped.factory })).toBe(3);
    expect(capped.approvals).toEqual([]);
  });

  it("--resume continues saved turns of the same request, and never starts a new research", async () => {
    const m = mockEngine([{ status: "succeeded", events: [] }], withInfo({ saved: 4, matches: true, complete: false }));
    const io = memIo();
    expect(await runCli(argv("research", "p", "--resume"), { io, factory: m.factory })).toBe(0);
    expect(io.stdout).toMatch(/continuing the interrupted research from 4 saved turn\(s\)/);
    expect(m.submitted[0]).toMatchObject({ kind: "stage", stage: "research", force: false, options: {} });
    for (const info of [{ saved: 0, matches: false, complete: false }, { saved: 3, matches: false, complete: false }]) {
      const none = mockEngine([{ status: "succeeded", events: [] }], withInfo(info));
      const eio = memIo();
      expect(await runCli(argv("research", "p", "--resume"), { io: eio, factory: none.factory })).toBe(1);
      expect(eio.stderr).toMatch(/nothing to resume/);
      expect(none.submitted).toEqual([]);
    }
    expect(await runCli(argv("research", "p", "--resume", "--new-request"), { io: memIo(), factory: m.factory })).toBe(2);
  });

  it("--new-request starts over (forced, receipts bypassed) and says the saved turns are discarded", async () => {
    const m = mockEngine([{ status: "succeeded", events: [] }], withInfo({ saved: 2, matches: true, complete: true }));
    const io = memIo();
    expect(await runCli(argv("research", "p", "--new-request"), { io, factory: m.factory })).toBe(0);
    expect(io.stdout).toMatch(/2 saved research turn\(s\) will be discarded \(--new-request\)/);
    expect(m.submitted[0]).toMatchObject({ kind: "stage", stage: "research", force: true, options: { newRequest: true } });
  });
});

describe("script --transcreate", () => {
  const tcEngine = () => {
    const calls: string[] = [];
    const extra = {
      async estimateTranscreate() {
        return { planHash: "b".repeat(64), totalUsd: 0.02, lines: [], approved: false };
      },
      async transcreate(_slug: string, _lang: string, id: string) {
        calls.push(id);
        return { displayText: "Texte.", issues: [] };
      },
    } as unknown as Partial<EngineExt>;
    return { m: mockEngine([{ status: "succeeded", events: [] }], extra), calls };
  };

  it("is cost-gated per segment: exit 3 without approval; --yes / a fitting --max-cost approve it", async () => {
    const a = tcEngine();
    const io = memIo();
    expect(await runCli(argv("script", "p", "--lang", "fr", "--transcreate", "ch1-s02"), { io, factory: a.m.factory })).toBe(3);
    expect(io.stderr).toContain(`docmaker approve p cost --stage script --lang fr --plan ${"b".repeat(64)}`);
    expect(a.calls).toEqual([]);
    const capped = tcEngine();
    expect(await runCli(argv("script", "p", "--lang", "fr", "--transcreate", "CH1-S02", "--max-cost", "0.01"), { io: memIo(), factory: capped.m.factory })).toBe(3);
    expect(capped.calls).toEqual([]);
    const y = tcEngine();
    expect(await runCli(argv("script", "p", "--lang", "fr", "--transcreate", "CH1-S02", "--yes"), { io: memIo(), factory: y.m.factory })).toBe(0);
    expect(y.m.approvals).toEqual([{ slug: "p", gate: "cost", a: expect.objectContaining({ by: "flag", stage: "script", lang: "fr", planHash: "b".repeat(64) }) }]);
    expect(y.calls).toEqual(["CH1-S02"]);
  });
});

describe("factcheck acknowledgements", () => {
  const fc: FactCheck = {
    schemaVersion: 1, lang: "en", scriptHash: "a".repeat(64), slicesHash: "b".repeat(64), publishHash: "c".repeat(64), needsMoreResearch: [], titleThumbnailIssues: [], createdAt: NOW,
    items: [
      { id: "FC-00000001", where: "CH1-S01", surface: "narration", sentence: "He stole it.", claimKind: "allegation", verdict: "needs_attribution", risk: "high", factIds: [], problem: "attribute", suggestedRewrite: "", origin: "llm", rule: null, resolution: "open", note: "" },
      { id: "FC-00000002", where: "CH1-S02", surface: "narration", sentence: "It cost 5.", claimKind: "number", verdict: "unsupported", risk: "high", factIds: [], problem: "number", suggestedRewrite: "", origin: "deterministic", rule: "b", resolution: "open", note: "" },
    ],
  } as FactCheck;
  const extra = {
    async getProject() {
      return { primaryLang: "en", languages: ["en"] };
    },
    async readDoc(_slug: string, rel: string) {
      if (rel.includes("factcheck")) return { value: fc, etag: "e" };
      if (rel.includes("suggestion")) return { value: { riskFlags: ["none"] }, etag: "e" };
      throw new Error("missing");
    },
  } as unknown as Partial<EngineExt>;

  it("refuses --ack (including 'all') without an interactive terminal", async () => {
    const m = mockEngine([{ status: "succeeded", events: [] }], extra);
    const io = memIo(false);
    expect(await runCli(argv("factcheck", "p", "--ack", "all"), { io, factory: m.factory })).toBe(2);
    expect(io.stderr).toMatch(/--ack-file/);
    expect(m.approvals).toEqual([]);
  });

  it("--ack-file approves with a note per item (non-interactive)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "docmaker-cli-"));
    try {
      const f = path.join(dir, "ack.json");
      writeFileSync(f, JSON.stringify({ "FC-00000001": "Attributed to the court record.", "FC-00000002": "Figure from the 1637 notary deed." }));
      const m = mockEngine([{ status: "succeeded", events: [] }], extra);
      expect(await runCli(argv("factcheck", "p", "--ack-file", f), { io: memIo(false), factory: m.factory })).toBe(0);
      expect(m.approvals).toEqual([{ slug: "p", gate: "factcheck-ack", a: expect.objectContaining({ by: "cli", lang: "en", items: ["FC-00000001", "FC-00000002"], itemNotes: { "FC-00000001": "Attributed to the court record.", "FC-00000002": "Figure from the 1637 notary deed." } }) }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--ack all on a terminal asks per item", async () => {
    const m = mockEngine([{ status: "succeeded", events: [] }], extra);
    const io = memIo(true);
    io.answers.push("y", "Attributed to the court record.", "n");
    expect(await runCli(argv("factcheck", "p", "--ack", "all"), { io, factory: m.factory })).toBe(0);
    expect(m.approvals[0]!.a.items).toEqual(["FC-00000001"]);
  });
});

describe("factcheck on a real engine (gate-test)", () => {
  // the gate-test fixture through the factcheck stage, with its fix-only quote fixed: ackable blocking items remain
  async function setup(root: string) {
    const { createEngineImpl, REAL_DEPS } = await import("@docmaker/engine");
    const { loadRuntime } = await import("@docmaker/core/node");
    const core = await import("@docmaker/core");
    const fakes = await import("../../../packages/engine/test/fakes/index");
    const repo = path.resolve(__dirname, "..", "..", "..");
    const env = { ...process.env, DOCMAKER_HOME: shareTestCaches(path.join(root, "home")), DOCMAKER_PROJECTS: path.join(root, "projects"), DOCMAKER_OFFLINE: "1", DOCMAKER_REPO_ROOT: repo, DOCMAKER_LOG_LEVEL: "error" };
    const factory: EngineFactory = async ({ env: e, logger }) => createEngineImpl({ cwd: repo, env: e, logger, deps: REAL_DEPS, renderClient: new fakes.FakeRenderClient(loadRuntime({ cwd: repo, env: e }).config) });
    const e = await factory({ env, cwd: repo, logger: silent });
    try {
      const fx = (await e.rt.fixture("gate-test"))!;
      const slug = (await e.createProject({ idea: fx.idea, slug: "fc", languages: ["en"], primaryLang: fx.primaryLang, targetMinutes: fx.targetMinutes, styleId: fx.styleId, llm: "fixture", fixtureId: fx.id, seed: fx.seed })).slug;
      const req = (from: JobRequest["from"]): JobRequest => ({ slug, kind: "pipeline", stage: null, from, to: "factcheck", langs: [], force: false, options: {}, preset: null });
      const first = await e.waitForJob((await e.submit(req("research"))).jobId);
      expect(first.status).toBe("waiting-approval");
      const o = await e.readDoc(slug, core.P.outline, core.Outline);
      await e.writeDoc(slug, core.P.outline, core.Outline, { ...o.value, thesisConfirmed: true }, o.etag);
      await e.approve(slug, "outline-approval", { stage: "outline", lang: null, planHash: core.docHash((await e.readDoc(slug, core.P.outline, core.Outline)).value), by: "cli", note: "", items: [], itemNotes: {} });
      expect((await e.waitForJob((await e.resume(first.id)).jobId)).status).toBe("succeeded");
      // fix-only quote items: put the verbatim quote in the script, re-run, mark what the LLM still flags as rewritten
      const facts = (await e.readDoc(slug, core.P.factsheet, core.FactSheet)).value;
      const sc = await e.readDoc(slug, core.P.script("en"), core.Script);
      const next = structuredClone(sc.value);
      for (const ch of next.chapters) for (const sg of ch.segments) if (sg.quoteId) sg.displayText = facts.quotes.find((q) => q.id === sg.quoteId)!.verbatim;
      await e.writeDoc(slug, core.P.script("en"), core.Script, next, sc.etag);
      expect((await e.waitForJob((await e.submit(req("beatslice"))).jobId)).status).toBe("succeeded");
      const fc = await e.readDoc(slug, core.P.factcheck("en"), core.FactCheck);
      const { fixOnly, gatingItems } = await import("@docmaker/engine");
      await e.writeDoc(slug, core.P.factcheck("en"), core.FactCheck, { ...fc.value, items: fc.value.items.map((i) => (fixOnly(i) && i.resolution === "open" ? { ...i, resolution: "rewritten" as const } : i)) }, fc.etag);
      const after = (await e.readDoc(slug, core.P.factcheck("en"), core.FactCheck)).value;
      const ackable = gatingItems(after, (await e.readDoc(slug, core.P.styleSuggestion, core.StyleSuggestion)).value.riskFlags).filter((i) => i.resolution === "open").map((i) => i.id);
      return { slug, env, factory, repo, ackable, approvals: async () => (await e.readDoc(slug, core.P.approvals, core.ApprovalsDoc)).value.approvals };
    } finally {
      await e.close();
    }
  }
  const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } } as unknown as Parameters<EngineFactory>[0]["logger"];

  it("a shared --note acknowledges several items; items dismissed earlier with one note keep it", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "docmaker-cli-fc-"));
    try {
      const s = await setup(root);
      expect(s.ackable.length).toBeGreaterThanOrEqual(3);
      const [d1, d2, ...rest] = s.ackable as [string, string, ...string[]];
      const run = (io: ReturnType<typeof memIo>, ...a: string[]) => runCli(argv(...a), { io, factory: s.factory, baseEnv: s.env, cwd: s.repo });
      // unknown ids are refused (usage error), nothing is dismissed
      const bad = memIo(false);
      expect(await run(bad, "factcheck", s.slug, "--dismiss", `${d1},FC-00000000`, "--note", "Background only, never asserted.")).toBe(2);
      expect(bad.stderr).toMatch(/unknown fact-check item\(s\): FC-00000000/);
      // two items dismissed with one (shared) note
      const dio = memIo(false);
      expect(await run(dio, "factcheck", s.slug, "--dismiss", `${d1},${d2}`, "--note", "Background only, never asserted.")).toBe(0);
      expect(dio.stdout).toMatch(/record the acknowledgement|blocking item\(s\) open/);
      // the rest acknowledged on a terminal with one shared --note
      const io = memIo(true);
      io.answers.push(...rest.map(() => "y"));
      const shared = "Reviewed with counsel: wording kept.";
      expect(await run(io, "factcheck", s.slug, "--ack", "all", "--note", shared)).toBe(0);
      expect(io.stderr).toBe("");
      expect(io.stdout).toContain(`acknowledged ${s.ackable.length} item(s) for en`);
      const last = (await s.approvals()).at(-1)!;
      expect(last).toMatchObject({ gate: "factcheck-ack", by: "cli", note: shared });
      expect(last.items).toEqual(expect.arrayContaining(s.ackable)); // (+ rewritten items: the approval lists every blocking id)
      expect(last.itemNotes[d1]).toBe("Background only, never asserted.");
      for (const id of rest) expect(last.itemNotes[id]).toBe(shared);
      // the gate is satisfied: status shows no factcheck-ack block on render
      const st = memIo();
      expect(await run(st, "status", s.slug)).toBe(0);
      expect(st.stdout).not.toMatch(/render\.en\S*\s+\S+\s+.*blocked: factcheck-ack/);
      // identical per-item notes typed separately are still refused (no shared --note)
      const dup = memIo(true);
      dup.answers.push(...s.ackable.flatMap(() => ["y", "the same note everywhere"]));
      expect(await run(dup, "factcheck", s.slug, "--ack", s.ackable.join(","))).toBe(1);
      expect(dup.stderr).toMatch(/identical notes/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("demo pruning", () => {
  it("removes only untouched earlier demo projects of the same fixture", async () => {
    const { makeProject } = await import("@docmaker/core/testing");
    const { pruneDemoProjects } = await import("../src/commands/core");
    const root = mkdtempSync(path.join(os.tmpdir(), "docmaker-cli-prune-"));
    try {
      const mk = (slug: string, fixtureId = "tulip-mania", files: Record<string, unknown> = {}) => {
        mkdirSync(path.join(root, slug), { recursive: true });
        writeFileSync(path.join(root, slug, "project.json"), JSON.stringify(makeProject({ slug, llm: { ...makeProject().llm, fixtureId } })));
        for (const [rel, v] of Object.entries(files)) {
          mkdirSync(path.dirname(path.join(root, slug, rel)), { recursive: true });
          writeFileSync(path.join(root, slug, rel), typeof v === "string" ? v : JSON.stringify(v));
        }
      };
      const job = (id: string, kind: JobRequest["kind"], status: JobRecord["status"]): JobRecord => ({
        id, request: { slug: "x", kind, stage: null, from: "research", to: "qa", langs: [], force: false, options: {}, preset: null },
        status, createdAt: NOW, startedAt: NOW, endedAt: NOW, error: null, coalescedInto: null, resumeOf: null,
      });
      const approval = (by: Approval["by"]): Approval => ({ gate: "outline-approval", stage: "outline", lang: null, planHash: "a".repeat(64), approvedAt: NOW, by, note: "", items: [], itemNotes: {} });
      mk("demo-tulip-mania-20261001-101010", "tulip-mania", { "jobs/index.json": { schemaVersion: 1, jobs: [job("job-20261001-101010-aaaaaa", "demo", "succeeded")] }, "approvals.json": { schemaVersion: 1, approvals: [approval("fixture")] } });
      mk("demo-tulip-mania-20261001-111111", "tulip-mania", { ".history/script/en/script.json/2026-10-01T11-11-11.000Z.json": "{}" });
      mk("demo-tulip-mania-20261001-121212", "tulip-mania", { "approvals.json": { schemaVersion: 1, approvals: [approval("fixture"), approval("cli")] } });
      mk("demo-tulip-mania-20261001-131313", "tulip-mania", { "jobs/index.json": { schemaVersion: 1, jobs: [job("job-20261001-131313-aaaaaa", "demo", "succeeded"), job("job-20261001-131314-bbbbbb", "stage", "succeeded")] } });
      mk("demo-tulip-mania-20261001-141414", "tulip-mania", { "jobs/index.json": { schemaVersion: 1, jobs: [job("job-20261001-141414-aaaaaa", "demo", "running")] } });
      mk("demo-tulip-mania-20261001-151515", "gate-test");
      // every fresh demo snapshots the outline's history (the fixture's outline approval): that is the run's own write …
      const OUTLINE_HISTORY = ".history/outline/outline.json/2026-10-02T23-59-59.000Z-aaaaaaaa.json";
      const at = (slug: string, rel: string, iso: string) => utimesSync(path.join(root, slug, rel), new Date(iso), new Date(iso));
      const demoJobs = (id: string) => ({ "jobs/index.json": { schemaVersion: 1, jobs: [job(id, "demo", "succeeded")] }, "approvals.json": { schemaVersion: 1, approvals: [approval("fixture")] }, [OUTLINE_HISTORY]: "{}" });
      mk("demo-tulip-mania-20261001-161616", "tulip-mania", demoJobs("job-20261001-161616-aaaaaa"));
      at("demo-tulip-mania-20261001-161616", OUTLINE_HISTORY, "2026-10-02T23:59:59.000Z");
      // … while a history entry written after the demo job ended is a person's edit
      mk("demo-tulip-mania-20261001-171717", "tulip-mania", demoJobs("job-20261001-171717-aaaaaa"));
      at("demo-tulip-mania-20261001-171717", OUTLINE_HISTORY, "2026-10-03T01:00:00.000Z");
      mk("demo-tulip-mania-mine");
      mk("demo-tulip-mania-20261003-090000");
      const r = pruneDemoProjects(root, "tulip-mania", "demo-tulip-mania-20261003-090000");
      expect(r.removed).toEqual(["demo-tulip-mania-20261001-101010", "demo-tulip-mania-20261001-161616"]);
      expect(r.kept).toEqual([
        { slug: "demo-tulip-mania-20261001-111111", why: "it has user edits" },
        { slug: "demo-tulip-mania-20261001-121212", why: "it has approvals by a person" },
        { slug: "demo-tulip-mania-20261001-131313", why: "it was used beyond the demo run" },
        { slug: "demo-tulip-mania-20261001-141414", why: "a job is queued or running" },
        { slug: "demo-tulip-mania-20261001-171717", why: "it has user edits" },
      ]);
      expect(readdirSync(root).sort()).toEqual([
        "demo-tulip-mania-20261001-111111", "demo-tulip-mania-20261001-121212", "demo-tulip-mania-20261001-131313", "demo-tulip-mania-20261001-141414",
        "demo-tulip-mania-20261001-151515", "demo-tulip-mania-20261001-171717", "demo-tulip-mania-20261003-090000", "demo-tulip-mania-mine",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("demo on the walking-skeleton fakes", () => {
  it("runs the whole pipeline and prints the outputs", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "docmaker-cli-demo-"));
    try {
      const { createEngineImpl, REAL_DEPS } = await import("@docmaker/engine");
      const { loadRuntime } = await import("@docmaker/core/node");
      const fakes = await import("../../../packages/engine/test/fakes/index");
      const repo = path.resolve(__dirname, "..", "..", "..");
      const env = { ...process.env, DOCMAKER_HOME: shareTestCaches(path.join(root, "home")), DOCMAKER_PROJECTS: path.join(root, "projects"), DOCMAKER_OFFLINE: "1", DOCMAKER_REPO_ROOT: repo, DOCMAKER_LOG_LEVEL: "error" };
      const factory: EngineFactory = async ({ env: e, logger }) => createEngineImpl({ cwd: repo, env: e, logger, deps: REAL_DEPS, renderClient: new fakes.FakeRenderClient(loadRuntime({ cwd: repo, env: e }).config) });
      const io = memIo(false);
      const code = await runCli(argv("demo", "--only-chapters", "CH1", "--slug", "cli-demo", "--tts", "synthetic"), { io, factory, baseEnv: env, cwd: repo });
      expect(io.stderr).toBe("");
      expect(code).toBe(0);
      expect(io.stdout).toMatch(/\[ok\] qa \(en\)/);
      expect(io.stdout).toContain(path.join(root, "projects", "cli-demo", "render/en/draft/final.mp4"));
      expect(io.stdout).toMatch(/QA: \d+\/\d+ checks ok/);
      const st = memIo();
      expect(await runCli(argv("status", "cli-demo"), { io: st, factory, baseEnv: env, cwd: repo })).toBe(0);
      expect(st.stdout).toMatch(/qa\.en@draft\s+done/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});
