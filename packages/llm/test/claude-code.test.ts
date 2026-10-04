// ClaudeCodeLlm against a fake `claude` CLI (test/data/fake-claude.mjs, the event shapes the real CLI prints): command
// line and environment (subscription only, no API key), structured calls with receipts and reuse, error mapping, and
// research (registry rebuilt only from URLs a search or fetch returned, resume from the saved run).
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocmakerError, isDocmakerError, type Logger } from "@docmaker/core";
import {
  ClaudeCodeLlm, buildResearchFromClaudeCode, claudeCodeEnv, claudeCodeFailure, createLlmClient, isClaudeCodeTurn, urlKey, type ClaudeCodeTurn,
  type StructuredRequest,
} from "../src/index";
import { FakeCosts, silentLogger } from "./helpers";

const FAKE = join(__dirname, "data", "fake-claude.mjs");
const Wire = z.object({ title: z.string(), n: z.number().int() }).strict();
const OUTPUT = { title: "ok", n: 3 };

function setup(scenario: string, extra: Record<string, string> = {}, logger: Logger = silentLogger) {
  const dir = mkdtempSync(join(tmpdir(), "cc-test-"));
  const log = join(dir, "calls.jsonl");
  const env = {
    ...process.env, FAKE_SCENARIO: scenario, FAKE_LOG: log, FAKE_OUTPUT: JSON.stringify(OUTPUT), ANTHROPIC_API_KEY: "sk-ant-must-not-leak",
    ANTHROPIC_AUTH_TOKEN: "tok-must-not-leak", ...extra,
  };
  const llm = new ClaudeCodeLlm({ bin: process.execPath, binArgs: [FAKE], workDir: join(dir, "work"), rawDir: join(dir, "raw"), logger, env });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);
  return { dir, llm, calls };
}
const req = (over: Partial<StructuredRequest<typeof Wire>> = {}): StructuredRequest<typeof Wire> => ({
  step: "outline", key: "", schema: Wire, system: [{ text: "SYSTEM A", cache: true }, { text: "SYSTEM B", cache: false }], user: "write it",
  effort: "high", maxTokens: 8000, stage: "outline", lang: null, ...over,
});
const h = (costs = new FakeCosts(), newRequest = false, signal = new AbortController().signal) => ({ signal, costs, newRequest });
async function rejects(p: Promise<unknown>): Promise<DocmakerError> {
  try {
    await p;
  } catch (e) {
    if (isDocmakerError(e)) return e as DocmakerError;
    throw e;
  }
  throw new Error("expected a rejection");
}

describe("ClaudeCodeLlm.structured", () => {
  it("runs the CLI isolated, without API credentials, and validates the structured output", async () => {
    const { llm, calls, dir } = setup("ok");
    const costs = new FakeCosts();
    expect(llm.kind).toBe("claude-code");
    await expect(llm.structured(req(), h(costs))).resolves.toEqual(OUTPUT);
    const [c] = calls();
    const args = c!.args as string[];
    for (const f of ["-p", "--safe-mode", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config"]) expect(args).toContain(f);
    const after = (f: string) => args[args.indexOf(f) + 1];
    expect([after("--input-format"), after("--output-format"), after("--model"), after("--effort"), after("--tools"), after("--permission-mode")])
      .toEqual(["stream-json", "stream-json", "claude-opus-5-5", "high", "", "dontAsk"]);
    expect(args).not.toContain("--allowedTools");
    expect(JSON.parse(after("--json-schema")!)).toMatchObject({ type: "object", additionalProperties: false, required: ["title", "n"] });
    expect(c).toMatchObject({ apiKey: null, authToken: null, maxOutput: "64000", system: "SYSTEM A\n\nSYSTEM B", content: "write it" });
    expect(c!.cwd).toBe(join(dir, "work"));
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]).toMatchObject({
      provider: "claude-code", endpoint: "claude-code.structured", model: "claude-opus-5-5", stage: "outline", costUsd: 0,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, web_search_requests: 0 },
    });
    expect(existsSync(join(dir, "raw", `${costs.receipts[0]!.fingerprint}.json`))).toBe(true);
    expect(costs.budgetChecks).toBe(1);
  });

  it("reuses a stored answer (no second CLI run) unless a new request is asked for", async () => {
    const { llm, calls } = setup("ok");
    const costs = new FakeCosts();
    await llm.structured(req(), h(costs));
    await expect(llm.structured(req(), h(costs))).resolves.toEqual(OUTPUT);
    expect(calls()).toHaveLength(1);
    await llm.structured(req(), h(costs, true));
    expect(calls()).toHaveLength(2);
  });

  it("passes image blocks through, retries an off-schema answer once, accepts a JSON text answer", async () => {
    const img = setup("bad-then-ok");
    const counter = join(img.dir, "n");
    const llm = new ClaudeCodeLlm({
      bin: process.execPath, binArgs: [FAKE], workDir: join(img.dir, "w"), rawDir: join(img.dir, "r"), logger: silentLogger,
      env: { ...process.env, FAKE_SCENARIO: "bad-then-ok", FAKE_LOG: join(img.dir, "calls.jsonl"), FAKE_OUTPUT: JSON.stringify(OUTPUT), FAKE_COUNTER: counter },
    });
    const user = [{ type: "text" as const, text: "Image 1:" }, { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "iVBORw0KGgo=" } }];
    const costs = new FakeCosts();
    await expect(llm.structured(req({ step: "rerank", user }), h(costs))).resolves.toEqual(OUTPUT);
    expect(img.calls()).toHaveLength(2);
    expect((img.calls()[0]!.content as { type: string }[]).map((b) => b.type)).toEqual(["text", "image"]);
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]!.usage.output_tokens).toBe(40); // both attempts counted

    const text = setup("text-json");
    await expect(text.llm.structured(req(), h())).resolves.toEqual(OUTPUT);
  });

  it("off-schema twice → LLM_SCHEMA (the spent attempts are recorded)", async () => {
    const { llm, calls } = setup("bad");
    const costs = new FakeCosts();
    expect((await rejects(llm.structured(req(), h(costs)))).code).toBe("LLM_SCHEMA");
    expect(calls()).toHaveLength(2);
    expect(costs.receipts[0]).toMatchObject({ outputRef: null, costUsd: 0 });
  });

  it("maps failures: not signed in, subscription limit, refusal, no result, missing CLI, canceled", async () => {
    const auth = await rejects(setup("auth").llm.structured(req(), h()));
    expect(auth.code).toBe("CONFIG_MISSING_KEY");
    expect(auth.hint).toMatch(/claude auth login/);
    const limit = await rejects(setup("limit").llm.structured(req(), h()));
    expect(limit).toMatchObject({ code: "LLM_API", retryable: true });
    expect(limit.message).toMatch(/subscription limit/);
    const refusal = await rejects(setup("refusal").llm.structured(req(), h()));
    expect(refusal.code).toBe("LLM_REFUSAL");
    expect(refusal.message).toMatch(/cyber/);
    const none = await rejects(setup("noresult").llm.structured(req(), h()));
    expect(none).toMatchObject({ code: "LLM_API", retryable: true });
    expect(none.message).toMatch(/boom/);
    const dir = mkdtempSync(join(tmpdir(), "cc-missing-"));
    const missing = new ClaudeCodeLlm({ bin: join(dir, "no-such-claude"), workDir: join(dir, "w"), rawDir: join(dir, "r"), logger: silentLogger });
    const m = await rejects(missing.structured(req(), h()));
    expect(m.code).toBe("TOOL_MISSING");
    expect(m.hint).toMatch(/claude\.ai\/install\.sh/);
    const ac = new AbortController();
    ac.abort();
    expect((await rejects(setup("ok").llm.structured(req(), h(new FakeCosts(), false, ac.signal)))).code).toBe("CANCELED");
  });

  it("warns once when a subscription window passes 90 %", async () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (m: string) => void warnings.push(m), child: () => logger };
    const { llm } = setup("ok", { FAKE_UTILIZATION: "0.93" }, logger);
    await llm.structured(req(), h());
    await llm.structured(req({ key: "b" }), h());
    expect(warnings).toEqual(["Claude subscription: 93% of the five-hour limit used"]);
  });
});

describe("claude-code helpers", () => {
  it("claudeCodeEnv strips every variable that would bypass the subscription", () => {
    const env = claudeCodeEnv({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://x" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000", DISABLE_AUTOUPDATER: "1" });
  });
  it("claudeCodeFailure: success → null; error_max_turns and unknown errors → LLM_API", () => {
    expect(claudeCodeFailure({ type: "result", subtype: "success", is_error: false }, [])).toBeNull();
    expect(claudeCodeFailure({ subtype: "error_max_turns", is_error: true, num_turns: 9 }, [])).toMatchObject({ code: "LLM_API", retryable: true });
    expect(claudeCodeFailure({ subtype: "success", is_error: true, result: "Overloaded" }, [{ type: "assistant", error: "overloaded" }])).toMatchObject({ code: "LLM_API", retryable: true });
    expect(claudeCodeFailure({ subtype: "error_during_execution", is_error: true }, [])?.message).toMatch(/error_during_execution/);
  });
  it("urlKey ignores scheme, www, default port, fragment and trailing slashes", () => {
    expect(urlKey("https://www.Example.org:443/a/b/#x")).toBe(urlKey("http://example.org/a/b"));
    expect(urlKey("https://example.org/a?q=1")).not.toBe(urlKey("https://example.org/a?q=2"));
    expect(urlKey("mailto:x@y.z")).toBeNull();
  });
  it("createLlmClient builds the claude-code client", () => {
    const llm = createLlmClient({ provider: "claude-code", fixtureDir: null, rawDir: "/tmp/r", refusalFallback: false, logger: silentLogger, apiKey: null, claudeCode: { bin: "claude", workDir: "/tmp/w" } });
    expect(llm.kind).toBe("claude-code");
  });
});

describe("ClaudeCodeLlm.research", () => {
  const rreq = (onTurn: (n: number, m: unknown) => Promise<void>, resumeTurns: unknown[] = []) => ({
    topic: "Eiffel Tower", langs: ["en" as const], minutes: 10, asOf: "2026-10-04", maxSearches: 25, maxFetches: 30,
    system: [{ text: "RESEARCHER", cache: true }], user: "<topic>Eiffel Tower</topic>", resumeTurns, onTurn,
  });

  it("rebuilds the registry from the URLs the tools returned only, saves the run, and resumes from it without a CLI run", async () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (m: string) => void warnings.push(m), child: () => logger };
    const { llm, calls } = setup("research", {}, logger);
    const saved: unknown[] = [];
    const progress: string[] = [];
    const costs = new FakeCosts();
    const r = await llm.research(rreq(async (n, m) => void (saved[n - 1] = m)), { ...h(costs), progress: (_p, msg) => void progress.push(msg) });

    const c = calls()[0]!;
    const args = c.args as string[];
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(args).not.toContain("--json-schema");
    expect(c.content).toMatch(/square brackets/);
    expect(c.content).toMatch(/at most 25 web searches and 30 page fetches/);

    expect(r.registry.map((s) => [s.id, s.url, s.title, s.fetched, s.cited])).toEqual([
      ["S1", "https://www.history.example/eiffel", "Eiffel Tower opens", true, 1],
      ["S2", "https://bio.example/eiffel/", "Gustave Eiffel", false, 1],
      ["S3", "https://facts.example/height", 'Height "facts"', false, 1],
    ]);
    expect(r.dossierMarkdown).toBe([
      "- Opened on 31 March 1889. [S1]",
      "- Designed by Gustave Eiffel's company. [S2]",
      "- 300 m tall at opening, see Height facts [S3].",
      "- A claim from memory.",
    ].join("\n"));
    expect(r).toMatchObject({ searchesUsed: 2, fetchesUsed: 2, turns: 1 });
    expect(warnings).toContain("research: removed 2 citation(s) of URLs no search or fetch returned");
    expect(warnings.some((w) => w.startsWith("research: tool error web_fetch: 404"))).toBe(true);
    expect(progress.some((p) => p.startsWith("research: search 1: eiffel tower opening"))).toBe(true);
    expect(costs.receipts[0]).toMatchObject({ endpoint: "claude-code.research", costUsd: 0, outputRef: "research/raw/turn-1.json", usage: { web_search_requests: 2, web_fetch_requests: 2 } });

    expect(isClaudeCodeTurn(saved[0])).toBe(true);
    const again = await llm.research(rreq(async () => {}, JSON.parse(JSON.stringify(saved)) as unknown[]), { ...h(), progress: () => {} });
    expect(again).toEqual(r);
    expect(calls()).toHaveLength(1);
  });

  it("an empty dossier is an error and is not saved", async () => {
    const { llm } = setup("empty-research");
    const saved: unknown[] = [];
    const e = await rejects(llm.research(rreq(async (_n, m) => void saved.push(m)), { ...h(), progress: () => {} }));
    expect(e).toMatchObject({ code: "LLM_API", retryable: true });
    expect(saved).toEqual([]);
  });

  it("buildResearchFromClaudeCode keeps fetched sources even when uncited", () => {
    const turn: ClaudeCodeTurn = {
      provider: "claude-code", stop_reason: "end_turn", result: { result: "Nothing cited." },
      events: [
        { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "WebFetch", input: { url: "https://x.example/p" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "ok" }] }, tool_use_result: { code: 200, url: "https://x.example/p" } },
      ],
    };
    const b = buildResearchFromClaudeCode(turn);
    expect(b.registry).toMatchObject([{ id: "S1", url: "https://x.example/p", fetched: true, cited: 0, snippets: [] }]);
    expect(b.droppedCitations).toBe(0);
  });
});
