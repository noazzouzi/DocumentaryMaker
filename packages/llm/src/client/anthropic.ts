// Live Claude client (§6.1): structured outputs, refusal fallback, streaming above 32k tokens, stop_reason handling,
// prompt caching, receipts by fingerprint (a paid call is never made twice), raw responses in rawDir, research harness.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DocmakerError, canonicalJson, isDocmakerError, type Logger, type Progress, type Receipt, type StageId, type Lang } from "@docmaker/core";
import { sha256Bytes } from "@docmaker/core/node";
import { MODEL, usageCostUsd } from "../estimate";
import { buildResearchFromTurns, type TurnLike } from "../steps/research";
import type { LlmCallCtx, LlmClient, ResearchRequest, ResearchResult, StructuredRequest, SystemBlock } from "../types";
import { wireOutputFormat } from "../wire/jsonschema";
import { hashableUser, persistRaw, reuseParsed } from "./raw";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const REFUSAL_HINT = "the topic triggered a safety classifier; reframe the idea or write this step manually";
const STREAM_ABOVE = 32000;
const MAX_TOKENS_CAP = 64000;
const PARSE_TIMEOUT_MS = 30 * 60_000;
const MAX_RESEARCH_TURNS = 8;

/**
 * The subset of the SDK this client uses (lets tests inject a mock). Structured calls use `create` / `stream` with a
 * plain json_schema format (no SDK `parse` hook): the SDK parse helpers throw on truncated, refused or off-schema
 * output before stop_reason and usage can be read, and they drop `enum`/`const` from the schema.
 */
export interface AnthropicLike {
  messages: { create(params: never, options?: never): PromiseLike<unknown> };
  beta: {
    messages: {
      create(params: never, options?: never): PromiseLike<unknown>;
      stream(params: never, options?: never): { finalMessage(): Promise<unknown> };
    };
  };
}

interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number; webFetches: number }
const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, webFetches: 0 };
interface MessageLike {
  content?: unknown; stop_reason?: unknown; parsed_output?: unknown; model?: unknown; id?: unknown;
  stop_details?: { category?: unknown } | null;
  usage?: {
    input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
    server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
  } | null;
}

function addUsage(a: Usage, m: MessageLike): Usage {
  const u = m.usage ?? {};
  return {
    input: a.input + (u.input_tokens ?? 0), output: a.output + (u.output_tokens ?? 0), cacheRead: a.cacheRead + (u.cache_read_input_tokens ?? 0),
    cacheWrite: a.cacheWrite + (u.cache_creation_input_tokens ?? 0), webSearches: a.webSearches + (u.server_tool_use?.web_search_requests ?? 0),
    webFetches: a.webFetches + (u.server_tool_use?.web_fetch_requests ?? 0),
  };
}

/** text blocks; cache_control on the cacheable blocks (≤ 4 breakpoints, the last ones win). */
export function systemParam(blocks: readonly SystemBlock[]): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const cacheIdx = blocks.map((b, i) => (b.cache ? i : -1)).filter((i) => i >= 0).slice(-4);
  return blocks.map((b, i) => (cacheIdx.includes(i) ? { type: "text" as const, text: b.text, cache_control: { type: "ephemeral" as const } } : { type: "text" as const, text: b.text }));
}

export function mapSdkError(e: unknown, signal: AbortSignal): DocmakerError {
  if (isDocmakerError(e)) return e as DocmakerError;
  const err = e as { name?: string; status?: number; message?: string };
  if (signal.aborted || err?.name === "APIUserAbortError" || err?.name === "AbortError") return new DocmakerError("CANCELED", "canceled", { cause: e });
  const status = typeof err?.status === "number" ? err.status : null;
  const msg = err?.message ?? String(e);
  if (status === 401 || status === 403) return new DocmakerError("CONFIG_MISSING_KEY", `Anthropic API rejected the key (${status})`, { cause: e, hint: "set ANTHROPIC_API_KEY with `docmaker setup` or the settings page" });
  if (status === 429) return new DocmakerError("LLM_API", `Anthropic rate limit: ${msg}`, { cause: e, retryable: true });
  if (status !== null && status >= 500) return new DocmakerError("LLM_API", `Anthropic API error ${status}: ${msg}`, { cause: e, retryable: true });
  if (status !== null) return new DocmakerError("LLM_API", `Anthropic API error ${status}: ${msg}`, { cause: e });
  if (err?.name === "APIConnectionError" || err?.name === "APIConnectionTimeoutError") return new DocmakerError("LLM_API", `Anthropic API unreachable: ${msg}`, { cause: e, retryable: true });
  return new DocmakerError("LLM_API", msg, { cause: e });
}

/** Concatenated text blocks parsed as JSON and validated with the wire schema; null when either fails. */
export function parseStructuredText<S extends z.ZodType>(msg: MessageLike, schema: S): z.infer<S> | null {
  const text = (Array.isArray(msg.content) ? (msg.content as { type?: string; text?: string }[]) : [])
    .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  if (text.trim() === "") return null;
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export class AnthropicLlm implements LlmClient {
  readonly kind = "anthropic" as const;
  private readonly sdk: AnthropicLike;
  private readonly rawDir: string;
  private readonly refusalFallback: boolean;
  private readonly logger: Logger;

  constructor(o: { sdk: AnthropicLike; rawDir: string; refusalFallback: boolean; logger: Logger }) {
    this.sdk = o.sdk;
    this.rawDir = o.rawDir;
    this.refusalFallback = o.refusalFallback;
    this.logger = o.logger;
  }

  private fallbackParams(): Record<string, unknown> {
    return this.refusalFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {};
  }

  fingerprint(endpoint: string, body: unknown): string {
    return sha256Bytes(`anthropic|${endpoint}|${canonicalJson(body)}`);
  }

  private async record(h: LlmCallCtx, o: { fp: string; endpoint: string; stage: StageId; lang: Lang | null; usage: Usage; outputRef: string | null }): Promise<Receipt> {
    const r = await h.costs.record({
      fingerprint: o.fp, provider: "anthropic", endpoint: o.endpoint, model: MODEL, stage: o.stage, lang: o.lang,
      usage: {
        input_tokens: o.usage.input, output_tokens: o.usage.output, cache_read_input_tokens: o.usage.cacheRead,
        cache_creation_input_tokens: o.usage.cacheWrite, web_search_requests: o.usage.webSearches, web_fetch_requests: o.usage.webFetches,
      },
      costUsd: usageCostUsd(o.usage), outputRef: o.outputRef,
    });
    h.onReceipt?.(r);
    return r;
  }

  /** One API call; returns the message and its parsed output (null when the text is not JSON matching the schema). */
  private async send<S extends z.ZodType>(req: StructuredRequest<S>, maxTokens: number, signal: AbortSignal): Promise<{ msg: MessageLike; parsed: z.infer<S> | null }> {
    const base = {
      model: MODEL, max_tokens: maxTokens, system: systemParam(req.system), messages: [{ role: "user", content: req.user }],
      output_config: { effort: req.effort, format: wireOutputFormat(req.schema) },
    };
    let msg: MessageLike;
    try {
      if (maxTokens > STREAM_ABOVE) {
        msg = (await this.sdk.beta.messages.stream({ ...base, ...this.fallbackParams() } as never, { signal } as never).finalMessage()) as MessageLike;
      } else {
        const opts = { signal, timeout: PARSE_TIMEOUT_MS } as never;
        msg = (this.refusalFallback
          ? await this.sdk.beta.messages.create({ ...base, ...this.fallbackParams() } as never, opts)
          : await this.sdk.messages.create(base as never, opts)) as MessageLike;
      }
    } catch (e) {
      throw mapSdkError(e, signal);
    }
    return { msg, parsed: parseStructuredText(msg, req.schema) };
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>> {
    if (h.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
    const identity = {
      model: MODEL, step: req.step, key: req.key, effort: req.effort, max_tokens: req.maxTokens, system: req.system, user: hashableUser(req.user),
      schema: z.toJSONSchema(req.schema, { unrepresentable: "any" }), fallback: this.refusalFallback,
    };
    // receipt identity: the non-streaming label stays "messages.parse" so responses paid before the switch to
    // messages.create (same request, same schema) are still reused instead of being bought again
    const endpoint = req.maxTokens > STREAM_ABOVE ? "messages.stream" : "messages.parse";
    const fp = this.fingerprint(endpoint, identity);
    const reused = await reuseParsed(this.rawDir, fp, req.schema, h, this.logger);
    if (reused !== undefined) return reused;

    let usage = ZERO;
    let maxTokens = req.maxTokens;
    let grew = false;
    let reparsed = false;
    let last: MessageLike = {};
    let attempts = 0;
    for (;;) {
      attempts++;
      let sent: { msg: MessageLike; parsed: z.infer<S> | null };
      try {
        sent = await this.send(req, maxTokens, h.signal);
      } catch (e) {
        // an earlier attempt of this call was paid for: record it before surfacing the error
        if (attempts > 1) await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef: null });
        throw e;
      }
      const { msg, parsed } = sent;
      last = msg;
      usage = addUsage(usage, msg);
      if (msg.stop_reason === "refusal") {
        await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef: null });
        throw new DocmakerError("LLM_REFUSAL", `the model declined the ${req.step} step${msg.stop_details?.category ? ` (${String(msg.stop_details.category)})` : ""}`, { hint: REFUSAL_HINT });
      }
      if (msg.stop_reason === "max_tokens" && !grew) {
        grew = true;
        maxTokens = Math.min(MAX_TOKENS_CAP, Math.ceil(maxTokens * 1.5));
        this.logger.warn("llm: max_tokens reached; retrying once with a larger budget", { step: req.step, maxTokens });
        continue;
      }
      if (parsed === null) {
        if (!reparsed) {
          reparsed = true;
          this.logger.warn("llm: structured output did not parse; retrying once", { step: req.step });
          continue;
        }
        await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef: null });
        throw new DocmakerError("LLM_SCHEMA", `the ${req.step} output does not match its schema (stop_reason ${String(msg.stop_reason)})`, { retryable: true });
      }
      const outputRef = await persistRaw(this.rawDir, fp, { fingerprint: fp, step: req.step, key: req.key, model: MODEL, attempts, request: identity, response: last, parsed });
      await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef });
      h.costs.assertWithinBudget(req.stage, req.lang);
      return parsed;
    }
  }

  async research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult> {
    const tools: Record<string, unknown>[] = [];
    if (req.maxSearches > 0) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: req.maxSearches });
    if (req.maxFetches > 0) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: req.maxFetches, citations: { enabled: true }, max_content_tokens: 20000 });
    const turns: TurnLike[] = req.resumeTurns.filter((t): t is TurnLike => !!t && typeof t === "object" && Array.isArray((t as TurnLike).content));
    if (turns.length !== req.resumeTurns.length) this.logger.warn("research: ignored malformed saved turns", { saved: req.resumeTurns.length, kept: turns.length });
    // append-only: assistant turns are replayed unchanged (thinking blocks, encrypted_content included)
    const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: req.user }];
    for (const t of turns) messages.push({ role: "assistant", content: t.content });
    const system = systemParam(req.system);
    const baseId = this.fingerprint("messages.research", { model: MODEL, system: req.system, user: req.user, tools });
    let done = turns.length > 0 && turns[turns.length - 1]!.stop_reason !== "pause_turn";
    while (!done && turns.length < MAX_RESEARCH_TURNS) {
      if (h.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
      const n = turns.length + 1;
      h.progress(Math.min(0.95, (n - 1) / MAX_RESEARCH_TURNS), `research turn ${n}`);
      let msg: MessageLike;
      try {
        msg = (await this.sdk.beta.messages
          .stream({ model: MODEL, max_tokens: MAX_TOKENS_CAP, system, tools, messages, output_config: { effort: "high" }, ...this.fallbackParams() } as never, { signal: h.signal } as never)
          .finalMessage()) as MessageLike;
      } catch (e) {
        throw mapSdkError(e, h.signal);
      }
      turns.push(msg as TurnLike);
      await req.onTurn(n, msg);
      await this.record(h, { fp: sha256Bytes(`${baseId}|turn|${n}`), endpoint: "messages.stream", stage: "research", lang: null, usage: addUsage(ZERO, msg), outputRef: `research/raw/turn-${n}.json` });
      h.costs.assertWithinBudget("research", null);
      if (msg.stop_reason === "refusal") throw new DocmakerError("LLM_REFUSAL", "the model declined the research step", { hint: REFUSAL_HINT });
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      if (msg.stop_reason === "max_tokens") this.logger.warn("research: the dossier hit max_tokens and may be truncated");
      done = true;
    }
    const built = buildResearchFromTurns(turns);
    for (const e of built.serverErrors) this.logger.warn(`research: server tool error ${e}`);
    h.progress(1, "research done", { sources: built.registry.length });
    return { dossierMarkdown: built.dossierMarkdown, registry: built.registry, searchesUsed: built.searchesUsed, fetchesUsed: built.fetchesUsed, turns: turns.length };
  }
}

export function createAnthropicSdk(apiKey: string | null): AnthropicLike {
  try {
    return new Anthropic(apiKey ? { apiKey, maxRetries: 2 } : { maxRetries: 2 }) as unknown as AnthropicLike;
  } catch (e) {
    throw new DocmakerError("CONFIG_MISSING_KEY", "no Anthropic API key configured", { cause: e, hint: "set ANTHROPIC_API_KEY with `docmaker setup` or the settings page" });
  }
}
