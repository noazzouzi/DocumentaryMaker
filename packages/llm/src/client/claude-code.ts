// Claude Code client (provider "claude-code"): every call runs the official `claude` CLI headless (`claude -p`, stream-json
// in and out), signed in with the user's own Claude subscription. The CLI runs unmodified and isolated from the user's
// Claude Code customisations (--safe-mode, no skills, no MCP, an empty working directory, no saved session), without
// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in its environment so the subscription is used, never an API key. This process
// never reads the CLI's credentials. Receipts are kept (costUsd 0): a re-run step reuses its answer instead of quota.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DocmakerError, RegistryEntry, canonicalJson, isDocmakerError, type Lang, type Logger, type Progress, type Receipt, type StageId } from "@docmaker/core";
import { run, sha256Bytes } from "@docmaker/core/node";
import { MODEL } from "../estimate";
import { RESEARCH_CLAUDE_CODE } from "../prompts/steps";
import type { RegistryBuild } from "../steps/research";
import type { Effort, LlmCallCtx, LlmClient, ResearchRequest, ResearchResult, StructuredRequest, SystemBlock } from "../types";
import { wireJsonSchema } from "../wire/jsonschema";
import { REFUSAL_HINT } from "./anthropic";
import { hashableUser, persistRaw, reuseParsed } from "./raw";

export const CLAUDE_CODE_PROVIDER = "claude-code";
/** Variables that would make the CLI bill an API key (or another endpoint) instead of the subscription. */
export const CLAUDE_CODE_STRIPPED_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] as const;
export const CLAUDE_CODE_LOGIN_HINT = "run `claude auth login` where docmaker runs and sign in with your Claude subscription";
export const CLAUDE_CODE_INSTALL_HINT = "install Claude Code where docmaker runs (Linux/WSL: curl -fsSL https://claude.ai/install.sh | bash), then run `claude auth login`";
const LIMIT_HINT = "wait for the subscription limit to reset (`claude` then /usage shows when), then resume the job";
const RESEARCH_TOOLS = ["WebSearch", "WebFetch"] as const;
const STRUCTURED_MAX_TURNS = 6;
const STRUCTURED_TIMEOUT_MS = 30 * 60_000;
const RESEARCH_TIMEOUT_MS = 90 * 60_000;
const MAX_OUTPUT_TOKENS = "64000";

type Json = Record<string, unknown>;
export type ClaudeCodeEvent = Json & { type?: unknown };
/** What research() hands to onTurn (research/raw/turn-1.json) and rebuilds from on resume. */
export interface ClaudeCodeTurn { provider: typeof CLAUDE_CODE_PROVIDER; stop_reason: "end_turn"; events: ClaudeCodeEvent[]; result: Json }

export interface ClaudeCodeConfig {
  /** The CLI ("claude"), and arguments placed before ours (tests run a fake CLI through node). */
  bin: string;
  binArgs?: string[];
  /** Empty working directory of the CLI: no project CLAUDE.md, settings or .mcp.json is ever picked up. */
  workDir: string;
  rawDir: string;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
}

interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number; webFetches: number }
const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, webFetches: 0 };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const blocks = (e: ClaudeCodeEvent): Json[] => {
  const c = obj(e.message)?.content;
  return Array.isArray(c) ? (c.filter((b) => obj(b) !== null) as Json[]) : [];
};
const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => str(obj(b)?.text) ?? "").join("") : "";

/** The command line of one call (system prompt in a file: it can be far longer than one argv string allows). */
export function claudeCodeArgs(o: { systemFile: string; effort: Effort; tools: readonly string[]; maxTurns: number; schema: Json | null }): string[] {
  const tools = o.tools.join(",");
  return [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--safe-mode", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config",
    "--model", MODEL, "--effort", o.effort, "--system-prompt-file", o.systemFile,
    "--tools", tools, ...(tools ? ["--allowedTools", tools] : []), "--permission-mode", "dontAsk", "--max-turns", String(o.maxTurns),
    ...(o.schema ? ["--json-schema", JSON.stringify(o.schema)] : []),
  ];
}

/** The CLI's environment: the caller's, minus every variable that would bypass the subscription. */
export function claudeCodeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, CLAUDE_CODE_MAX_OUTPUT_TOKENS: MAX_OUTPUT_TOKENS, DISABLE_AUTOUPDATER: "1" };
  for (const k of CLAUDE_CODE_STRIPPED_ENV) delete env[k];
  return env;
}

/** The error a finished run maps to; null when it succeeded. */
export function claudeCodeFailure(result: Json, events: readonly ClaudeCodeEvent[]): DocmakerError | null {
  const last = obj([...events].reverse().find((e) => e.type === "assistant")?.message);
  if ((last?.stop_reason ?? result.stop_reason) === "refusal") {
    const category = obj(last?.stop_details)?.category;
    return new DocmakerError("LLM_REFUSAL", `the model declined this step${category ? ` (${String(category)})` : ""}`, { hint: REFUSAL_HINT });
  }
  if (result.is_error !== true && result.subtype === "success") return null;
  const text = (str(result.result) ?? "").trim();
  const detail = (text || String(result.subtype ?? "error")).slice(0, 500);
  const category = [...events].reverse().map((e) => str(e.error)).find((c) => c !== null) ?? null;
  const rejected = events.some((e) => e.type === "rate_limit_event" && obj(e.rate_limit_info)?.status === "rejected");
  if (category === "authentication_failed" || category === "oauth_org_not_allowed" || /not logged in|\/login\b|invalid api key/i.test(text)) {
    return new DocmakerError("CONFIG_MISSING_KEY", `Claude Code is not signed in: ${detail}`, { hint: CLAUDE_CODE_LOGIN_HINT });
  }
  if (category === "rate_limit" || rejected || /usage limit|hit your limit|limit reached/i.test(text)) {
    return new DocmakerError("LLM_API", `Claude subscription limit reached: ${detail}`, { retryable: true, hint: LIMIT_HINT });
  }
  if (category === "overloaded" || category === "server_error") return new DocmakerError("LLM_API", `Claude API error (${category}): ${detail}`, { retryable: true });
  if (result.subtype === "error_max_turns") return new DocmakerError("LLM_API", `claude stopped after ${String(result.num_turns ?? "?")} turns without finishing`, { retryable: true });
  return new DocmakerError("LLM_API", `claude failed (${String(result.subtype ?? "error")}${category ? `, ${category}` : ""}): ${detail}`);
}

function addUsage(a: Usage, result: Json, tools: { searches: number; fetches: number } = { searches: 0, fetches: 0 }): Usage {
  const u = obj(result.usage) ?? {};
  const n = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
  return {
    input: a.input + n("input_tokens"), output: a.output + n("output_tokens"), cacheRead: a.cacheRead + n("cache_read_input_tokens"),
    cacheWrite: a.cacheWrite + n("cache_creation_input_tokens"), webSearches: a.webSearches + tools.searches, webFetches: a.webFetches + tools.fetches,
  };
}

const systemText = (system: readonly SystemBlock[]): string => system.map((b) => b.text).join("\n\n");

export function isClaudeCodeTurn(t: unknown): t is ClaudeCodeTurn {
  const o = obj(t);
  return o !== null && o.provider === CLAUDE_CODE_PROVIDER && Array.isArray(o.events) && obj(o.result) !== null;
}

/** Saved events: the tool calls, their results and the text (the stream's init, rate-limit and partial events are dropped). */
function compactEvents(events: readonly ClaudeCodeEvent[]): ClaudeCodeEvent[] {
  const out: ClaudeCodeEvent[] = [];
  for (const e of events) {
    if (e.type === "assistant") {
      const kept = blocks(e).filter((b) => b.type === "tool_use" || b.type === "text");
      if (kept.length) out.push({ type: "assistant", message: { content: kept, stop_reason: obj(e.message)?.stop_reason ?? null } });
    } else if (e.type === "user") {
      const kept = blocks(e).filter((b) => b.type === "tool_result");
      if (kept.length) out.push({ type: "user", message: { content: kept }, tool_use_result: e.tool_use_result ?? null });
    }
  }
  return out;
}

/** Matching key of a URL: scheme, "www.", default port, fragment and trailing slashes ignored. */
export function urlKey(u: string): string | null {
  try {
    const x = new URL(u.trim().replace(/[.,;:!?)]+$/, ""));
    if (x.protocol !== "http:" && x.protocol !== "https:") return null;
    return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return null;
  }
}

function searchLinks(structured: Json | null, text: string): { url: string; title: string | null }[] {
  const out: { url: string; title: string | null }[] = [];
  const results = structured && Array.isArray(structured.results) ? structured.results : null;
  if (results) {
    for (const r of results) {
      const content = obj(r)?.content;
      if (!Array.isArray(content)) continue; // the search's own commentary arrives as plain strings
      for (const c of content) {
        const url = str(obj(c)?.url);
        if (url) out.push({ url, title: str(obj(c)?.title) });
      }
    }
    return out;
  }
  // text form of the same result: `Links: [{"title":"…","url":"…"}, …]`
  for (const m of text.matchAll(/\{"title":"(?:[^"\\]|\\.)*","url":"(?:[^"\\]|\\.)*"\}/g)) {
    try {
      const c = JSON.parse(m[0]) as { title?: unknown; url?: unknown };
      if (typeof c.url === "string") out.push({ url: c.url, title: str(c.title) });
    } catch { /* not a link object */ }
  }
  return out;
}

const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const URL_MARK = /\[\s*(https?:\/\/[^\s\]]+(?:\s*[,;]\s*https?:\/\/[^\s\]]+)*)\s*\]/g;
const splitUrls = (group: string): string[] => group.split(/\s*[,;]\s*(?=https?:\/\/)/);

/**
 * Dossier and registry of a Claude Code research run. Registry = ONLY URLs a WebSearch returned or a WebFetch read, kept
 * when cited or fetched; `[url]` markers become `[S#]`; a cited URL no tool returned is removed (never an invented source).
 */
export function buildResearchFromClaudeCode(turn: ClaudeCodeTurn): RegistryBuild & { droppedCitations: number } {
  interface Src { url: string; title: string; fetched: boolean; cited: number; id: string | null }
  const byKey = new Map<string, Src>();
  const order: Src[] = [];
  const uses = new Map<string, { name: string; input: Json }>();
  const serverErrors: string[] = [];
  let searches = 0;
  let fetches = 0;
  const add = (url: string, title: string | null, fetched: boolean, alias?: string | null) => {
    const key = urlKey(url);
    if (!key) return;
    let s = byKey.get(key) ?? (alias ? byKey.get(urlKey(alias) ?? "") : undefined);
    if (!s) {
      let href = url;
      try { href = new URL(url).href; } catch { /* keep as returned */ }
      s = { url: href, title: title ?? href, fetched: false, cited: 0, id: null };
      order.push(s);
    }
    if (fetched) s.fetched = true;
    if (title && s.title === s.url) s.title = title;
    byKey.set(key, s);
    const ak = alias ? urlKey(alias) : null;
    if (ak) byKey.set(ak, s);
  };
  for (const e of turn.events) {
    if (e.type === "assistant") {
      for (const b of blocks(e)) {
        const id = str(b.id);
        const name = str(b.name);
        if (b.type !== "tool_use" || !id || !name) continue;
        uses.set(id, { name, input: obj(b.input) ?? {} });
        if (name === "WebSearch") searches++;
        else if (name === "WebFetch") fetches++;
      }
    } else if (e.type === "user") {
      const results = blocks(e).filter((b) => b.type === "tool_result");
      for (const b of results) {
        const use = uses.get(str(b.tool_use_id) ?? "");
        if (!use) continue;
        // the structured tool result sits on the event, unambiguous only when the event carries one result
        const structured = results.length === 1 ? obj(e.tool_use_result) : null;
        const text = textOf(b.content);
        if (use.name === "WebSearch") {
          if (b.is_error === true) serverErrors.push(`web_search: ${text.slice(0, 120) || "error"}`);
          else for (const l of searchLinks(structured, text)) add(l.url, l.title, false);
        } else if (use.name === "WebFetch") {
          const code = typeof structured?.code === "number" ? structured.code : null;
          const asked = str(use.input.url);
          if (b.is_error === true || (code !== null && (code < 200 || code >= 300))) {
            serverErrors.push(`web_fetch: ${code ?? (text.slice(0, 120) || "error")}${asked ? ` ${asked}` : ""}`);
            continue;
          }
          const url = str(structured?.url) ?? asked;
          if (url) add(url, null, true, asked);
        }
      }
    }
  }

  const raw = str(turn.result.result) ?? "";
  let dropped = 0;
  const lookup = (u: string): Src | undefined => byKey.get(urlKey(u) ?? "");
  // pass 1: count citations (markdown links first: their text is not a marker)
  for (const m of raw.matchAll(MD_LINK)) {
    const s = lookup(m[2]!);
    if (s) s.cited++;
    else dropped++;
  }
  for (const m of raw.replace(MD_LINK, "$1").matchAll(URL_MARK)) {
    for (const u of splitUrls(m[1]!)) {
      const s = lookup(u);
      if (s) s.cited++;
      else dropped++;
    }
  }
  const kept = order.filter((s) => s.cited > 0 || s.fetched);
  for (const [i, s] of kept.entries()) s.id = `S${i + 1}`;
  const registry = kept.map((s) => RegistryEntry.parse({ id: s.id, url: s.url, title: s.title, pageAge: null, fetched: s.fetched, cited: s.cited, snippets: [] }));
  // pass 2: markers → [S#]
  const mark = (urls: string[]): string => [...new Set(urls.map((u) => lookup(u)?.id).filter((id): id is string => !!id))].map((id) => `[${id}]`).join(" ");
  const dossier = raw
    .replace(MD_LINK, (_, label: string, url: string) => `${label}${mark([url]) ? ` ${mark([url])}` : ""}`)
    .replace(URL_MARK, (_, group: string) => mark(splitUrls(group)))
    .replace(/[ \t]+$/gm, "")
    .replace(/ {2,}/g, " ");
  return { dossierMarkdown: dossier.trim(), registry, searchesUsed: searches, fetchesUsed: fetches, serverErrors, droppedCitations: dropped };
}

export class ClaudeCodeLlm implements LlmClient {
  readonly kind = "claude-code" as const;
  private readonly cfg: ClaudeCodeConfig;
  private limitWarned = false;

  constructor(cfg: ClaudeCodeConfig) {
    this.cfg = cfg;
  }

  fingerprint(endpoint: string, body: unknown): string {
    return sha256Bytes(`${CLAUDE_CODE_PROVIDER}|${endpoint}|${canonicalJson(body)}`);
  }

  private async record(h: LlmCallCtx, o: { fp: string; endpoint: string; stage: StageId; lang: Lang | null; usage: Usage; outputRef: string | null }): Promise<Receipt> {
    const r = await h.costs.record({
      fingerprint: o.fp, provider: CLAUDE_CODE_PROVIDER, endpoint: o.endpoint, model: MODEL, stage: o.stage, lang: o.lang,
      usage: {
        input_tokens: o.usage.input, output_tokens: o.usage.output, cache_read_input_tokens: o.usage.cacheRead,
        cache_creation_input_tokens: o.usage.cacheWrite, web_search_requests: o.usage.webSearches, web_fetch_requests: o.usage.webFetches,
      },
      costUsd: 0, outputRef: o.outputRef,
    });
    h.onReceipt?.(r);
    return r;
  }

  /** One warning per client when a subscription window passes 90 %. */
  private watchLimits(e: ClaudeCodeEvent): void {
    if (this.limitWarned || e.type !== "rate_limit_event") return;
    const windows = obj(obj(e.rate_limit_info)?.unifiedWindows) ?? {};
    for (const [name, w] of Object.entries(windows)) {
      const used = obj(w)?.utilization;
      if (typeof used === "number" && used >= 0.9) {
        this.limitWarned = true;
        this.cfg.logger.warn(`Claude subscription: ${Math.round(used * 100)}% of the ${name.replace("_", "-")} limit used`);
        return;
      }
    }
  }

  /** Runs the CLI once; resolves with its result event and every event of the stream. */
  private async invoke(o: {
    system: string; user: StructuredRequest<z.ZodType>["user"]; effort: Effort; schema: Json | null; tools: readonly string[]; maxTurns: number;
    timeoutMs: number; signal: AbortSignal; onEvent?: (e: ClaudeCodeEvent) => void;
  }): Promise<{ result: Json; events: ClaudeCodeEvent[] }> {
    if (o.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
    await mkdir(this.cfg.workDir, { recursive: true });
    const tmp = await mkdtemp(join(tmpdir(), "docmaker-claude-"));
    const systemFile = join(tmp, "system.txt");
    const events: ClaudeCodeEvent[] = [];
    try {
      await writeFile(systemFile, o.system, "utf8");
      const message = { type: "user", message: { role: "user", content: o.user } };
      const r = await run(this.cfg.bin, [...(this.cfg.binArgs ?? []), ...claudeCodeArgs({ systemFile, effort: o.effort, tools: o.tools, maxTurns: o.maxTurns, schema: o.schema })], {
        signal: o.signal, cwd: this.cfg.workDir, env: claudeCodeEnv(this.cfg.env ?? process.env), timeoutMs: o.timeoutMs, input: `${JSON.stringify(message)}\n`,
        onStdoutLine: (line) => {
          let e: unknown;
          try {
            e = JSON.parse(line);
          } catch {
            return; // not an event (the CLI's own notices)
          }
          const ev = obj(e);
          if (!ev) return;
          events.push(ev);
          this.watchLimits(ev);
          o.onEvent?.(ev);
        },
      });
      const result = [...events].reverse().find((e) => e.type === "result");
      if (!result) {
        const err = r.stderr.trim().split(/\r?\n/).slice(-5).join(" | ");
        throw new DocmakerError("LLM_API", `claude exited with code ${r.code} without a result${err ? `: ${err}` : ""}`, { retryable: true });
      }
      const failure = claudeCodeFailure(result, events);
      if (failure) throw failure;
      return { result, events };
    } catch (e) {
      if (isDocmakerError(e) && e.code === "TOOL_MISSING") throw new DocmakerError("TOOL_MISSING", `Claude Code CLI not found (${this.cfg.bin})`, { hint: CLAUDE_CODE_INSTALL_HINT, cause: e });
      throw e;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>> {
    if (h.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
    const identity = {
      model: MODEL, step: req.step, key: req.key, effort: req.effort, system: req.system, user: hashableUser(req.user),
      schema: z.toJSONSchema(req.schema, { unrepresentable: "any" }),
    };
    const endpoint = "claude-code.structured";
    const fp = this.fingerprint(endpoint, identity);
    const reused = await reuseParsed(this.cfg.rawDir, fp, req.schema, h, this.cfg.logger);
    if (reused !== undefined) return reused;

    let usage = ZERO;
    for (let attempt = 1; ; attempt++) {
      let out: { result: Json; events: ClaudeCodeEvent[] };
      try {
        out = await this.invoke({
          system: systemText(req.system), user: req.user, effort: req.effort, schema: wireJsonSchema(req.schema), tools: [], maxTurns: STRUCTURED_MAX_TURNS,
          timeoutMs: STRUCTURED_TIMEOUT_MS, signal: h.signal,
        });
      } catch (e) {
        if (attempt > 1) await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef: null });
        throw e;
      }
      usage = addUsage(usage, out.result);
      let candidate: unknown = out.result.structured_output;
      if (candidate === undefined || candidate === null) {
        try {
          candidate = JSON.parse(str(out.result.result) ?? "");
        } catch { /* no JSON answer */ }
      }
      const parsed = req.schema.safeParse(candidate);
      if (parsed.success) {
        const outputRef = await persistRaw(this.cfg.rawDir, fp, {
          fingerprint: fp, provider: CLAUDE_CODE_PROVIDER, step: req.step, key: req.key, model: MODEL, attempts: attempt, request: identity, response: out.result, parsed: parsed.data,
        });
        await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef });
        h.costs.assertWithinBudget(req.stage, req.lang);
        return parsed.data;
      }
      if (attempt >= 2) {
        await this.record(h, { fp, endpoint, stage: req.stage, lang: req.lang, usage, outputRef: null });
        throw new DocmakerError("LLM_SCHEMA", `the ${req.step} output does not match its schema`, { retryable: true, details: parsed.error.issues.slice(0, 5) });
      }
      this.cfg.logger.warn("llm: structured output did not parse; retrying once", { step: req.step });
    }
  }

  async research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult> {
    if (h.signal.aborted) throw new DocmakerError("CANCELED", "canceled");
    const saved = req.resumeTurns[req.resumeTurns.length - 1];
    if (isClaudeCodeTurn(saved)) {
      h.progress(0.95, "research: rebuilding from the saved run");
      return this.finishResearch(this.buildChecked(saved), h);
    }
    if (req.resumeTurns.length) this.cfg.logger.warn("research: ignored saved turns that are not a Claude Code run", { saved: req.resumeTurns.length });
    const user = `${req.user}\n${RESEARCH_CLAUDE_CODE(req.maxSearches, req.maxFetches)}`;
    const budget = Math.max(1, req.maxSearches + req.maxFetches);
    let searches = 0;
    let fetches = 0;
    h.progress(0.02, "research: Claude Code is searching");
    const out = await this.invoke({
      system: systemText(req.system), user, effort: "high", schema: null, tools: RESEARCH_TOOLS, maxTurns: req.maxSearches + req.maxFetches + 15,
      timeoutMs: RESEARCH_TIMEOUT_MS, signal: h.signal,
      onEvent: (e) => {
        if (e.type !== "assistant") return;
        for (const b of blocks(e)) {
          if (b.type !== "tool_use") continue;
          const input = obj(b.input) ?? {};
          if (b.name === "WebSearch") h.progress(Math.min(0.95, (++searches + fetches) / budget), `research: search ${searches}: ${str(input.query) ?? ""}`);
          else if (b.name === "WebFetch") h.progress(Math.min(0.95, (searches + ++fetches) / budget), `research: page ${fetches}: ${str(input.url) ?? ""}`);
        }
      },
    });
    const turn: ClaudeCodeTurn = {
      provider: CLAUDE_CODE_PROVIDER, stop_reason: "end_turn", events: compactEvents(out.events),
      result: { subtype: out.result.subtype, num_turns: out.result.num_turns, result: out.result.result, usage: out.result.usage ?? null },
    };
    const fp = this.fingerprint("claude-code.research", { model: MODEL, system: req.system, user, tools: RESEARCH_TOOLS });
    const usage = addUsage(ZERO, out.result, { searches, fetches });
    let built: ReturnType<typeof buildResearchFromClaudeCode>;
    try {
      built = this.buildChecked(turn); // an empty run is never saved: a resume would reuse it
    } catch (e) {
      await this.record(h, { fp, endpoint: "claude-code.research", stage: "research", lang: null, usage, outputRef: null });
      throw e;
    }
    await req.onTurn(1, turn);
    await this.record(h, { fp, endpoint: "claude-code.research", stage: "research", lang: null, usage, outputRef: "research/raw/turn-1.json" });
    h.costs.assertWithinBudget("research", null);
    return this.finishResearch(built, h);
  }

  private buildChecked(turn: ClaudeCodeTurn): ReturnType<typeof buildResearchFromClaudeCode> {
    const built = buildResearchFromClaudeCode(turn);
    if (built.dossierMarkdown === "") throw new DocmakerError("LLM_API", "the research run returned no dossier", { retryable: true });
    return built;
  }

  private finishResearch(built: ReturnType<typeof buildResearchFromClaudeCode>, h: { progress: Progress }): ResearchResult {
    for (const e of built.serverErrors) this.cfg.logger.warn(`research: tool error ${e}`);
    if (built.droppedCitations > 0) this.cfg.logger.warn(`research: removed ${built.droppedCitations} citation(s) of URLs no search or fetch returned`);
    h.progress(1, "research done", { sources: built.registry.length });
    return { dossierMarkdown: built.dossierMarkdown, registry: built.registry, searchesUsed: built.searchesUsed, fetchesUsed: built.fetchesUsed, turns: 1 };
  }
}
