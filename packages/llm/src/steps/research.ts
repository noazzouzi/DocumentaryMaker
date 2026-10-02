// Step 1a research: registry building from (possibly resumed) research turns + the runResearch step.
// Ported from $SP/script-pipeline/research.ts. Registry = ONLY URLs the API returned that were cited or fetched.
import { RegistryEntry, type Lang } from "@docmaker/core";
import { EDITORIAL_RULES } from "../prompts/rules";
import { RESEARCH_ROLE, RESEARCH_USER } from "../prompts/steps";
import type { ResearchRequest, ResearchResult, StepCtx } from "../types";

interface Src { url: string; title: string; pageAge: string | null; fetched: boolean; cited: number; snippets: string[] }
type Block = Record<string, unknown> & { type?: unknown };

export interface TurnLike { content?: unknown; stop_reason?: unknown; usage?: unknown }
export interface RegistryBuild extends Omit<ResearchResult, "turns"> { serverErrors: string[] }

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Rebuilds the dossier and source registry from research turns, in order. Citations: web_search_result_location → url;
 * char_location → fetchedDocs[document_index]. `[url]` markers become `[S#]` (ids in first-seen order of cited/fetched sources).
 */
export function buildResearchFromTurns(turns: readonly TurnLike[]): RegistryBuild {
  const sources = new Map<string, Src>();
  const fetchedDocs: string[] = [];
  const serverErrors: string[] = [];
  let dossier = "";
  let searches = 0;
  let fetches = 0;
  let usageSearches = 0;
  let usageFetches = 0;
  for (const turn of turns) {
    const content = Array.isArray(turn.content) ? (turn.content as Block[]) : [];
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "web_search_tool_result") {
        searches++;
        // server-tool errors arrive as an OBJECT in content (never index it)
        if (!Array.isArray(b.content)) {
          serverErrors.push(`web_search: ${str((b.content as Block | undefined)?.error_code) ?? "error"}`);
          continue;
        }
        for (const r of b.content as Block[]) {
          const url = str(r.url);
          if (!url || sources.has(url)) continue;
          sources.set(url, { url, title: str(r.title) ?? url, pageAge: str(r.page_age), fetched: false, cited: 0, snippets: [] });
        }
      } else if (b.type === "web_fetch_tool_result") {
        fetches++;
        const c = b.content as Block | undefined;
        if (!c || c.type !== "web_fetch_result") {
          serverErrors.push(`web_fetch: ${str(c?.error_code) ?? "error"}`);
          continue;
        }
        const url = str(c.url);
        if (!url) continue;
        const doc = c.content as Block | undefined;
        const s = sources.get(url) ?? { url, title: str(doc?.title) ?? url, pageAge: null, fetched: true, cited: 0, snippets: [] };
        s.fetched = true;
        sources.set(url, s);
        fetchedDocs.push(url);
      } else if (b.type === "text") {
        dossier += str(b.text) ?? "";
        const cited = new Set<string>();
        for (const c of Array.isArray(b.citations) ? (b.citations as Block[]) : []) {
          const url = c.type === "web_search_result_location" ? str(c.url)
            : c.type === "char_location" && typeof c.document_index === "number" ? fetchedDocs[c.document_index] ?? null : null;
          const s = url ? sources.get(url) : undefined;
          if (!s) continue;
          s.cited++;
          const snippet = str(c.cited_text)?.trim();
          if (snippet && s.snippets.length < 5 && !s.snippets.includes(snippet)) s.snippets.push(snippet);
          if (!cited.has(s.url)) {
            cited.add(s.url);
            dossier += ` [${s.url}]`;
          }
        }
      }
    }
    const usage = turn.usage as { server_tool_use?: { web_search_requests?: unknown; web_fetch_requests?: unknown } | null } | undefined;
    const st = usage?.server_tool_use;
    if (st && typeof st.web_search_requests === "number") usageSearches += st.web_search_requests;
    if (st && typeof st.web_fetch_requests === "number") usageFetches += st.web_fetch_requests;
  }
  const kept = [...sources.values()].filter((s) => s.cited > 0 || s.fetched);
  const registry = kept.map((s, i) =>
    RegistryEntry.parse({ id: `S${i + 1}`, url: s.url, title: s.title, pageAge: s.pageAge, fetched: s.fetched, cited: s.cited, snippets: s.snippets.slice(0, 5) }),
  );
  for (const r of registry) dossier = dossier.split(`[${r.url}]`).join(`[${r.id}]`);
  // citations of sources that were neither cited nor fetched cannot exist; any leftover [url] marker is dropped
  dossier = dossier.replace(/ \[https?:\/\/[^\]\s]+\]/g, "");
  return {
    dossierMarkdown: dossier.trim(), registry, searchesUsed: Math.max(searches, usageSearches), fetchesUsed: Math.max(fetches, usageFetches), serverErrors,
  };
}

/** "S1 | title | url | page_age | snippets" lines for FACTSHEET_USER. */
export function sourceListText(registry: readonly RegistryEntry[]): string {
  return registry.map((s) => `${s.id} | ${s.title} | ${s.url} | ${s.pageAge ?? ""} | ${s.snippets.join(" / ")}`).join("\n");
}

export function researchPrompts(i: { topic: string; langs: Lang[]; minutes: number; asOf: string }): { system: { text: string; cache: boolean }[]; user: string } {
  const lang = i.langs[0] ?? "en";
  return {
    system: [{ text: `${RESEARCH_ROLE}\n${EDITORIAL_RULES(lang, i.asOf)}`, cache: true }],
    user: RESEARCH_USER(i.topic, lang, i.minutes) + (i.langs.length > 1 ? `\nThe video is also published in ${i.langs.slice(1).map((l) => (l === "fr" ? "French" : "English")).join(", ")}: search those languages too.` : ""),
  };
}

export function runResearch(ctx: StepCtx, i: { topic: string; langs: Lang[]; minutes: number; asOf: string; resumeTurns: unknown[]; onTurn: ResearchRequest["onTurn"] }): Promise<ResearchResult> {
  const p = researchPrompts(i);
  return ctx.llm.research(
    { topic: i.topic, langs: i.langs, minutes: i.minutes, asOf: i.asOf, maxSearches: 25, maxFetches: 30, system: p.system, user: p.user, resumeTurns: i.resumeTurns, onTurn: i.onTurn },
    { signal: ctx.signal, costs: ctx.costs, newRequest: ctx.newRequest, progress: ctx.progress },
  );
}
