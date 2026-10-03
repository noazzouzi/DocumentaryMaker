// CLI: parsing, exit codes (0/1/2/3/4), --yes/--max-cost never editorial, --ack all refused without a TTY,
// --ack-file (mocked engine), and one real run of `demo` on the walking-skeleton fakes.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Approval, FactCheck, GateId, JobEvent, JobRecord, JobRequest } from "@docmaker/core";
import type { EngineExt } from "@docmaker/engine";
import { runCli } from "../src/main";
import type { EngineFactory, Io } from "../src/context";

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

  it("builds the pipeline request from the flags", async () => {
    const m = mockEngine([{ status: "succeeded", events: [] }]);
    expect(await runCli(argv("run", "p", "--from", "layout", "--to", "render", "--lang", "fr", "--preset", "master", "--chapters", "ch1,CH2", "--force", "--new-request"), { io: memIo(), factory: m.factory })).toBe(0);
    expect(m.submitted[0]).toEqual({
      slug: "p", kind: "pipeline", stage: null, from: "layout", to: "render", langs: ["fr"], force: true, preset: "master",
      options: { onlyChapters: ["CH1", "CH2"], newRequest: true },
    });
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

describe("demo on the walking-skeleton fakes", () => {
  it("runs the whole pipeline and prints the outputs", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "docmaker-cli-demo-"));
    try {
      const { createEngineImpl } = await import("@docmaker/engine");
      const { loadRuntime } = await import("@docmaker/core/node");
      const fakes = await import("../../../packages/engine/test/fakes/index");
      const repo = path.resolve(__dirname, "..", "..", "..");
      const env = { ...process.env, DOCMAKER_HOME: path.join(root, "home"), DOCMAKER_PROJECTS: path.join(root, "projects"), DOCMAKER_OFFLINE: "1", DOCMAKER_REPO_ROOT: repo, DOCMAKER_LOG_LEVEL: "error" };
      const factory: EngineFactory = async ({ env: e, logger }) => createEngineImpl({ cwd: repo, env: e, logger, deps: fakes.skeletonDeps(), renderClient: new fakes.FakeRenderClient(loadRuntime({ cwd: repo, env: e }).config) });
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
