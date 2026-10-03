// FixtureLlm resolution, the Anthropic structured-call wrapper against a mocked SDK, and the research harness on
// recorded turns (incl. resume from saved turns).
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import AnthropicSdk from "@anthropic-ai/sdk";
import { z } from "zod";
import { isDocmakerError } from "@docmaker/core";
import {
  AnthropicLlm, FALLBACK_BETA, FixtureLlm, REFUSAL_HINT, buildResearchFromTurns, createLlmClient, estimateStepCost, mapSdkError, systemParam,
  type AnthropicLike, type StructuredRequest,
} from "../src/index";
import { FakeCosts, fixtureDir, silentLogger } from "./helpers";

const turn = (n: number) => JSON.parse(readFileSync(join(__dirname, "data", `research-turn-${n}.json`), "utf8")) as Record<string, unknown>;
const h = (costs = new FakeCosts(), newRequest = false) => ({ signal: new AbortController().signal, costs, newRequest });
async function rejects(p: Promise<unknown>): Promise<{ code: string; hint: string | null; retryable: boolean }> {
  try {
    await p;
  } catch (e) {
    if (isDocmakerError(e)) return e;
    throw e;
  }
  throw new Error("expected a rejection");
}

describe("FixtureLlm", () => {
  const Wire = z.object({ topic_type: z.string(), recommended_style_id: z.string() }).passthrough();
  const req = (step: StructuredRequest<typeof Wire>["step"], key: string): StructuredRequest<typeof Wire> => ({
    step, key, schema: Wire, system: [], user: "", effort: "low", maxTokens: 100, stage: "style", lang: null,
  });
  it("resolves <step>[.<key>].json from the fixture dir or its llm/ dir and validates with the request schema", async () => {
    for (const dir of [fixtureDir("tulip-mania"), join(fixtureDir("tulip-mania"), "llm")]) {
      const llm = new FixtureLlm(dir);
      expect(llm.kind).toBe("fixture");
      expect(llm.stubArgs).toEqual([dir]);
      await expect(llm.structured(req("style", ""), h())).resolves.toMatchObject({ recommended_style_id: "drama-commentary" });
    }
    const llm = new FixtureLlm(fixtureDir("tulip-mania"));
    expect(llm.pathFor("chapter", "fr.CH2")).toMatch(/llm\/chapter\.fr\.CH2\.json$/);
    expect(llm.has("beats", "CH3")).toBe(true);
    expect(llm.has("beats", "CH9")).toBe(false);
  });
  it("missing → FIXTURE_MISSING; wrong shape → LLM_SCHEMA; aborted → CANCELED", async () => {
    const llm = new FixtureLlm(fixtureDir("tulip-mania"));
    expect((await rejects(llm.structured(req("revise", "en.CH1"), h()))).code).toBe("FIXTURE_MISSING");
    const strict = { ...req("outline", ""), schema: z.object({ nope: z.string() }) } as unknown as StructuredRequest<typeof Wire>;
    expect((await rejects(llm.structured(strict, h()))).code).toBe("LLM_SCHEMA");
    const ac = new AbortController();
    ac.abort();
    expect((await rejects(llm.structured(req("style", ""), { ...h(), signal: ac.signal }))).code).toBe("CANCELED");
  });
  it("research(): registry ids in order, receipts never recorded", async () => {
    const costs = new FakeCosts();
    const llm = new FixtureLlm(fixtureDir("tulip-mania"));
    const r = await llm.research(
      { topic: "t", langs: ["en"], minutes: 1, asOf: "2026-10-02", maxSearches: 1, maxFetches: 1, system: [], user: "", resumeTurns: [], onTurn: async () => {} },
      { ...h(costs), progress: () => {} },
    );
    expect(r.registry.map((e) => e.id)).toEqual(["S1", "S2", "S3"]);
    expect(r.turns).toBe(0);
    expect(costs.receipts).toEqual([]);
  });
  it("createLlmClient picks the provider", () => {
    expect(createLlmClient({ provider: "fixture", fixtureDir: fixtureDir("tulip-mania"), rawDir: "/tmp/x", refusalFallback: true, logger: silentLogger, apiKey: null }).kind).toBe("fixture");
    expect(() => createLlmClient({ provider: "fixture", fixtureDir: null, rawDir: "/tmp/x", refusalFallback: true, logger: silentLogger, apiKey: null })).toThrow(/fixture/);
    expect(createLlmClient({ provider: "anthropic", fixtureDir: null, rawDir: "/tmp/x", refusalFallback: true, logger: silentLogger, apiKey: "sk-test" }).kind).toBe("anthropic");
  });
});

// ---------------------------------------------------------------- mocked SDK
type Call = { kind: "create" | "betaCreate" | "stream"; params: Record<string, unknown>; options: Record<string, unknown> | undefined };
function mockSdk(queue: { create?: unknown[]; betaCreate?: unknown[]; stream?: unknown[] }) {
  const calls: Call[] = [];
  const take = (k: "create" | "betaCreate" | "stream") => {
    const q = queue[k] ?? [];
    if (q.length === 0) throw new Error(`unexpected ${k} call`);
    const next = q.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const sdk = {
    messages: {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ kind: "create", params, options });
        return take("create");
      },
    },
    beta: {
      messages: {
        create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.push({ kind: "betaCreate", params, options });
          return take("betaCreate");
        },
        stream: (params: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.push({ kind: "stream", params: JSON.parse(JSON.stringify(params)) as Record<string, unknown>, options });
          return { finalMessage: async () => take("stream") };
        },
      },
    },
  };
  return { sdk: sdk as unknown as AnthropicLike, calls };
}
const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, server_tool_use: null };
const Out = z.object({ answer: z.string(), n: z.number() });
const ok = (parsed: unknown) => ({ content: [{ type: "text", text: JSON.stringify(parsed) }], stop_reason: "end_turn", usage });
const sreq = (o?: Partial<StructuredRequest<typeof Out>>): StructuredRequest<typeof Out> => ({
  step: "outline", key: "", schema: Out, system: [{ text: "rules", cache: false }, { text: "facts", cache: true }], user: "go", effort: "high",
  maxTokens: 16000, stage: "outline", lang: "en", ...o,
});
const client = (sdk: AnthropicLike, refusalFallback = true) =>
  new AnthropicLlm({ sdk, rawDir: mkdtempSync(join(tmpdir(), "llm-raw-")), refusalFallback, logger: silentLogger });

describe("AnthropicLlm.structured (mocked SDK)", () => {
  it("beta.messages.create with refusal-fallback betas, explicit effort, cached last stable block, no thinking/tool_choice", async () => {
    const { sdk, calls } = mockSdk({ betaCreate: [ok({ answer: "yes", n: 1 })] });
    const costs = new FakeCosts();
    await expect(client(sdk).structured(sreq(), h(costs))).resolves.toEqual({ answer: "yes", n: 1 });
    expect(calls).toHaveLength(1);
    const p = calls[0]!.params;
    expect(p.betas).toEqual([FALLBACK_BETA]);
    expect(p.fallbacks).toBe("default");
    expect(p.model).toBe("claude-opus-5-5");
    expect((p.output_config as { effort: string; format: unknown }).effort).toBe("high");
    expect((p.output_config as { format: unknown }).format).toBeTruthy();
    expect(p).not.toHaveProperty("thinking");
    expect(p).not.toHaveProperty("tool_choice");
    expect(p.system).toEqual([{ type: "text", text: "rules" }, { type: "text", text: "facts", cache_control: { type: "ephemeral" } }]);
    expect(calls[0]!.options?.timeout).toBe(30 * 60_000);
    expect(costs.receipts).toHaveLength(1);
    const r = costs.receipts[0]!;
    expect(r.outputRef).toBe(`costs/llm/${r.fingerprint}.json`);
    // 1000·4 + 2000·20 + 500·0.2 + 100·5 per MTok
    expect(r.costUsd).toBeCloseTo((1000 * 4 + 2000 * 20 + 500 * 0.2 + 100 * 5) / 1e6, 9);
    expect(costs.budgetChecks).toBe(1);
  });

  it("refusalFallback off → messages.create without betas", async () => {
    const { sdk, calls } = mockSdk({ create: [ok({ answer: "a", n: 2 })] });
    await client(sdk, false).structured(sreq(), h());
    expect(calls[0]!.kind).toBe("create");
    expect(calls[0]!.params).not.toHaveProperty("betas");
    expect(calls[0]!.params).not.toHaveProperty("fallbacks");
  });

  it("refusal → LLM_REFUSAL with the reframe hint (paid usage recorded)", async () => {
    const { sdk } = mockSdk({ betaCreate: [{ content: [{ type: "text", text: '{"answer":"par' }], stop_reason: "refusal", usage, stop_details: { category: "cyber" } }] });
    const costs = new FakeCosts();
    const e = await rejects(client(sdk).structured(sreq(), h(costs)));
    expect(e.code).toBe("LLM_REFUSAL");
    expect(e.hint).toBe(REFUSAL_HINT);
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]!.outputRef).toBeNull();
  });

  it("max_tokens → one retry with max_tokens·1.5 (cap 64000)", async () => {
    const { sdk, calls } = mockSdk({ betaCreate: [{ content: [{ type: "text", text: '{"answer":"abc' }], stop_reason: "max_tokens", usage }, ok({ answer: "b", n: 3 })] });
    const costs = new FakeCosts();
    await expect(client(sdk).structured(sreq(), h(costs))).resolves.toEqual({ answer: "b", n: 3 });
    expect(calls.map((c) => c.params.max_tokens)).toEqual([16000, 24000]);
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]!.usage.input_tokens).toBe(2000); // both attempts billed on one receipt
  });

  it("off-schema output → one identical retry, then LLM_SCHEMA (both attempts billed)", async () => {
    const bad = { content: [{ type: "text", text: '{"answer":5}' }], stop_reason: "end_turn", usage };
    const a = mockSdk({ betaCreate: [bad, ok({ answer: "c", n: 4 })] });
    await expect(client(a.sdk).structured(sreq(), h())).resolves.toEqual({ answer: "c", n: 4 });
    expect(a.calls).toHaveLength(2);
    expect(a.calls[1]!.params.max_tokens).toBe(16000);
    const b = mockSdk({ betaCreate: [bad, bad] });
    const costs = new FakeCosts();
    expect((await rejects(client(b.sdk).structured(sreq(), h(costs)))).code).toBe("LLM_SCHEMA");
    expect(b.calls).toHaveLength(2);
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]!.usage.input_tokens).toBe(2000);
  });

  it("max_tokens > 32000 → beta.messages.stream().finalMessage() and client-side JSON parse", async () => {
    const msg = { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: '{"answer":"d",' }, { type: "text", text: '"n":5}' }], stop_reason: "end_turn", usage };
    const { sdk, calls } = mockSdk({ stream: [msg] });
    await expect(client(sdk).structured(sreq({ maxTokens: 32001 }), h())).resolves.toEqual({ answer: "d", n: 5 });
    expect(calls[0]!.kind).toBe("stream");
    expect(calls[0]!.params.betas).toEqual([FALLBACK_BETA]);
  });

  it("receipts: an identical paid call is never made twice; newRequest forces a new one", async () => {
    const { sdk, calls } = mockSdk({ betaCreate: [ok({ answer: "e", n: 6 }), ok({ answer: "f", n: 7 })] });
    const c = client(sdk);
    const costs = new FakeCosts();
    const seen: string[] = [];
    await c.structured(sreq(), { ...h(costs), onReceipt: (r) => seen.push(r.fingerprint) });
    const raw = join((c as unknown as { rawDir: string }).rawDir, `${costs.receipts[0]!.fingerprint}.json`);
    expect(existsSync(raw)).toBe(true);
    await expect(c.structured(sreq(), { ...h(costs), onReceipt: (r) => seen.push(r.fingerprint) })).resolves.toEqual({ answer: "e", n: 6 });
    expect(calls).toHaveLength(1);
    expect(seen).toHaveLength(2);
    await expect(c.structured(sreq(), h(costs, true))).resolves.toEqual({ answer: "f", n: 7 });
    expect(calls).toHaveLength(2);
    // a different request is a different fingerprint
    const other = mockSdk({ betaCreate: [ok({ answer: "g", n: 8 })] });
    const c2 = new AnthropicLlm({ sdk: other.sdk, rawDir: (c as unknown as { rawDir: string }).rawDir, refusalFallback: true, logger: silentLogger });
    await c2.structured(sreq({ key: "other" }), h(costs));
    expect(other.calls).toHaveLength(1);
  });

  it("budget overrun stops after the call is recorded", async () => {
    const { sdk } = mockSdk({ betaCreate: [ok({ answer: "h", n: 9 })] });
    const costs = new FakeCosts();
    costs.failBudget = true;
    expect((await rejects(client(sdk).structured(sreq(), h(costs)))).code).toBe("BUDGET_EXCEEDED");
    expect(costs.receipts).toHaveLength(1);
  });

  it("SDK errors map to DocmakerError codes", async () => {
    const sig = new AbortController().signal;
    expect(mapSdkError(Object.assign(new Error("bad key"), { status: 401 }), sig).code).toBe("CONFIG_MISSING_KEY");
    const overloaded = mapSdkError(Object.assign(new Error("overloaded"), { status: 529 }), sig);
    expect([overloaded.code, overloaded.retryable]).toEqual(["LLM_API", true]);
    expect(mapSdkError(Object.assign(new Error("x"), { status: 400 }), sig).retryable).toBe(false);
    const ac = new AbortController();
    ac.abort();
    expect(mapSdkError(new Error("aborted"), ac.signal).code).toBe("CANCELED");
    const { sdk } = mockSdk({ betaCreate: [Object.assign(new Error("rate"), { status: 429 })] });
    expect((await rejects(client(sdk).structured(sreq(), h()))).code).toBe("LLM_API");
  });

  it("a failure after a paid attempt still records that attempt's usage", async () => {
    const trunc = { content: [{ type: "text", text: '{"answer":"x' }], stop_reason: "max_tokens", usage };
    const { sdk } = mockSdk({ betaCreate: [trunc, Object.assign(new Error("overloaded"), { status: 529 })] });
    const costs = new FakeCosts();
    expect((await rejects(client(sdk).structured(sreq(), h(costs)))).code).toBe("LLM_API");
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]!.usage.input_tokens).toBe(1000);
  });

  it("output_config.format is a plain json_schema that keeps enum/const (no SDK parse hook)", async () => {
    const Enum = z.object({ verdict: z.enum(["supported", "unsupported"]), kind: z.literal("x"), list: z.array(z.object({ d: z.enum(["a", "b"]) })) });
    const { sdk, calls } = mockSdk({ create: [{ content: [{ type: "text", text: '{"verdict":"supported","kind":"x","list":[{"d":"b"}]}' }], stop_reason: "end_turn", usage }] });
    await client(sdk, false).structured({ ...sreq(), schema: Enum } as unknown as StructuredRequest<typeof Out>, h());
    const format = (calls[0]!.params.output_config as { format: Record<string, unknown> }).format;
    expect(format).not.toHaveProperty("parse");
    expect(format.type).toBe("json_schema");
    const schema = format.schema as { properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.verdict!.enum).toEqual(["supported", "unsupported"]);
    expect(schema.properties.kind!.const).toBe("x");
    expect(((schema.properties.list!.items as { properties: Record<string, { enum: string[] }> }).properties.d!).enum).toEqual(["a", "b"]);
    expect(JSON.stringify(schema)).not.toContain("{enum:");
  });

  it("systemParam keeps at most 4 cache breakpoints (the last ones)", () => {
    const blocks = Array.from({ length: 6 }, (_, i) => ({ text: `b${i}`, cache: true }));
    const out = systemParam(blocks);
    expect(out.filter((b) => b.cache_control).map((b) => b.text)).toEqual(["b2", "b3", "b4", "b5"]);
  });
});

// ---------------------------------------------------------------- research harness
describe("research registry and harness (recorded turns)", () => {
  it("builds the registry from cited/fetched URLs only, rewrites [url] → [S#], counts server-tool errors", () => {
    const r = buildResearchFromTurns([turn(1), turn(2)]);
    expect(r.registry.map((e) => [e.id, e.url, e.fetched, e.cited])).toEqual([
      ["S1", "https://en.wikipedia.org/wiki/Tulip_mania", false, 3],
      ["S2", "https://www.gutenberg.org/ebooks/24518", true, 1],
    ]);
    expect(r.registry[0]!.pageAge).toBe("2 weeks ago");
    expect(r.registry[0]!.snippets).toHaveLength(2); // duplicate snippet kept once
    expect(r.dossierMarkdown).toContain("collapsed abruptly in February 1637. [S1]");
    expect(r.dossierMarkdown).toContain("chimney-sweeps traded tulips. [S2]");
    expect(r.dossierMarkdown).not.toMatch(/https?:\/\//);
    expect(r.dossierMarkdown).not.toContain("blog.example.org");
    expect(r.searchesUsed).toBe(2);
    expect(r.fetchesUsed).toBe(1);
    expect(r.serverErrors).toEqual(["web_search: too_many_requests"]);
  });

  const rreq = (resumeTurns: unknown[], saved: [number, unknown][]) => ({
    topic: "Tulip mania", langs: ["en" as const], minutes: 10, asOf: "2026-10-02", maxSearches: 25, maxFetches: 30,
    system: [{ text: "researcher", cache: true }], user: "<topic>Tulip mania</topic>", resumeTurns,
    onTurn: async (n: number, m: unknown) => { saved.push([n, m]); },
  });

  it("pause_turn loop: streams every turn, persists each turn, appends assistant content unchanged", async () => {
    const { sdk, calls } = mockSdk({ stream: [turn(1), turn(2)] });
    const saved: [number, unknown][] = [];
    const costs = new FakeCosts();
    const r = await client(sdk).research(rreq([], saved), { ...h(costs), progress: () => {} });
    expect(calls.map((c) => c.kind)).toEqual(["stream", "stream"]);
    const tools = calls[0]!.params.tools as { type: string; max_uses: number }[];
    expect(tools.map((t) => [t.type, t.max_uses])).toEqual([["web_search_20260209", 25], ["web_fetch_20260209", 30]]);
    expect((calls[0]!.params.output_config as { effort: string }).effort).toBe("high");
    expect(calls[0]!.params.max_tokens).toBe(64000);
    expect(calls[0]!.params).not.toHaveProperty("thinking");
    const msgs2 = calls[1]!.params.messages as { role: string; content: unknown }[];
    expect(msgs2.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs2[1]!.content).toEqual(turn(1).content); // thinking + encrypted_content untouched
    expect(saved.map(([n]) => n)).toEqual([1, 2]);
    expect(r.turns).toBe(2);
    expect(r.registry.map((e) => e.id)).toEqual(["S1", "S2"]);
    expect(costs.receipts).toHaveLength(2);
    expect(costs.receipts.reduce((a, x) => a + (x.usage.web_search_requests ?? 0), 0)).toBe(2);
  });

  it("resumes from saved turns (only the missing turn is requested); a complete run makes no call", async () => {
    const a = mockSdk({ stream: [turn(2)] });
    const saved: [number, unknown][] = [];
    const r = await client(a.sdk).research(rreq([turn(1)], saved), { ...h(), progress: () => {} });
    expect(a.calls).toHaveLength(1);
    expect((a.calls[0]!.params.messages as unknown[]).length).toBe(2);
    expect(saved.map(([n]) => n)).toEqual([2]);
    expect(r.registry).toHaveLength(2);
    const b = mockSdk({});
    const r2 = await client(b.sdk).research(rreq([turn(1), turn(2)], []), { ...h(), progress: () => {} });
    expect(b.calls).toHaveLength(0);
    expect(r2.dossierMarkdown).toBe(r.dossierMarkdown);
  });

  it("refusal during research → LLM_REFUSAL", async () => {
    const { sdk } = mockSdk({ stream: [{ content: [], stop_reason: "refusal", usage }] });
    expect((await rejects(client(sdk).research(rreq([], []), { ...h(), progress: () => {} }))).code).toBe("LLM_REFUSAL");
  });
});

describe("estimateStepCost", () => {
  it("prices input, cached input, output with thinking overhead and web searches", () => {
    const lines = estimateStepCost("research", { inputChars: 40000, outputChars: 8000, cachedChars: 20000, webSearches: 25, lang: "en" });
    expect(lines.map((l) => l.unit)).toEqual(["input_tokens", "cache_read_tokens", "output_tokens", "web_searches"]);
    expect(lines[0]!.quantity).toBe(5000);
    expect(lines[2]!.quantity).toBe(5000); // 2000 tokens × 2.5 (high effort thinking)
    expect(lines[3]!.totalUsd).toBeCloseTo(0.25, 6);
    const total = lines.reduce((a, l) => a + l.totalUsd, 0);
    expect(total).toBeCloseTo(5000 * 4e-6 + 5000 * 0.2e-6 + 5000 * 20e-6 + 0.25, 6);
    expect(estimateStepCost("passage", { inputChars: 0, outputChars: 0, cachedChars: 0, lang: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------- real SDK, fake fetch (the SDK's own request/response path)
describe("AnthropicLlm.structured with the real SDK and a fake fetch", () => {
  const Anthropic = AnthropicSdk;
  function realSdk(responses: { text: string; stop_reason: string }[]) {
    const bodies: Record<string, unknown>[] = [];
    const fetch = async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      const r = responses.shift();
      if (!r) throw new Error("unexpected request");
      const body = {
        id: `msg_${bodies.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: r.text }],
        stop_reason: r.stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    const sdk = new Anthropic({ apiKey: "test-key", maxRetries: 0, fetch: fetch as never }) as unknown as AnthropicLike;
    return { sdk, bodies };
  }
  const A = z.object({ answer: z.string() });
  const areq = { ...sreq(), schema: A } as unknown as StructuredRequest<typeof A>;
  for (const fallback of [true, false]) {
    it(`truncated JSON at max_tokens → retry with a larger budget, usage of both calls recorded (fallback ${fallback})`, async () => {
      const { sdk, bodies } = realSdk([{ text: '{"answer":"abc', stop_reason: "max_tokens" }, { text: '{"answer":"abc"}', stop_reason: "end_turn" }]);
      const costs = new FakeCosts();
      await expect(client(sdk, fallback).structured(areq, h(costs))).resolves.toEqual({ answer: "abc" });
      expect(bodies.map((b) => b.max_tokens)).toEqual([16000, 24000]);
      expect(costs.receipts).toHaveLength(1);
      expect(costs.receipts[0]!.usage.input_tokens).toBe(20);
    });
  }
  it("refusal with partial JSON → LLM_REFUSAL with the reframe hint, usage recorded", async () => {
    const { sdk } = realSdk([{ text: '{"answer":"pa', stop_reason: "refusal" }]);
    const costs = new FakeCosts();
    const e = await rejects(client(sdk).structured(areq, h(costs)));
    expect([e.code, e.hint]).toEqual(["LLM_REFUSAL", REFUSAL_HINT]);
    expect(costs.receipts).toHaveLength(1);
  });
  it("off-schema output → one reparse retry, then LLM_SCHEMA with usage recorded", async () => {
    const { sdk, bodies } = realSdk([{ text: '{"answer":5}', stop_reason: "end_turn" }, { text: '{"answer":6}', stop_reason: "end_turn" }]);
    const costs = new FakeCosts();
    expect((await rejects(client(sdk).structured(areq, h(costs)))).code).toBe("LLM_SCHEMA");
    expect(bodies).toHaveLength(2);
    expect(costs.receipts).toHaveLength(1);
    expect(costs.receipts[0]!.usage.output_tokens).toBe(40);
  });
});
