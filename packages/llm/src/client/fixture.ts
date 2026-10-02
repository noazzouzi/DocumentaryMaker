// FixtureLlm: offline LLM that serves recorded wire responses from <fixtureDir>/llm/<step>[.<key>].json (§6.9).
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { DocmakerError, RegistryEntry, type Progress } from "@docmaker/core";
import type { LlmCallCtx, LlmClient, ResearchRequest, ResearchResult, StructuredRequest } from "../types";

const ResearchFixture = z.object({
  dossier_markdown: z.string(),
  registry: z.array(z.object({
    url: z.string(), title: z.string(), page_age: z.string().nullable().default(null), fetched: z.boolean(),
    cited: z.number().int().nonnegative(), snippets: z.array(z.string()),
  })),
  searches_used: z.number().int().nonnegative(),
  fetches_used: z.number().int().nonnegative(),
});

/** Accepts `<repoRoot>/fixtures/<id>` or `<repoRoot>/fixtures/<id>/llm`. */
export function fixtureLlmDir(fixtureDir: string): string {
  const nested = join(fixtureDir, "llm");
  if (existsSync(nested)) return nested;
  return basename(fixtureDir) === "llm" ? fixtureDir : nested;
}

export function fixtureFileName(step: string, key: string): string {
  return key === "" ? `${step}.json` : `${step}.${key}.json`;
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new DocmakerError("CANCELED", "canceled");
}

async function readJson(path: string, what: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new DocmakerError("FIXTURE_MISSING", `fixture response missing: ${path}`, {
      hint: `the fixture has no recorded ${what}; add the file or run with the anthropic provider`, details: { path },
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    throw new DocmakerError("LLM_SCHEMA", `fixture ${path} is not valid JSON`, { cause: e });
  }
}

export class FixtureLlm implements LlmClient {
  /** Constructor arguments are kept for inspection in tests. */
  readonly stubArgs: readonly unknown[];
  readonly kind = "fixture" as const;
  readonly dir: string;
  constructor(fixtureDir: string) {
    this.stubArgs = [fixtureDir];
    this.dir = fixtureLlmDir(fixtureDir);
  }

  /** Path of the recorded response for a step/key (exists or not). */
  pathFor(step: string, key: string): string {
    return join(this.dir, fixtureFileName(step, key));
  }

  has(step: string, key: string): boolean {
    return existsSync(this.pathFor(step, key));
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>> {
    checkAbort(h.signal);
    const path = this.pathFor(req.step, req.key);
    const raw = await readJson(path, `${req.step}${req.key ? ` (${req.key})` : ""} response`);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new DocmakerError("LLM_SCHEMA", `fixture ${path} does not match the ${req.step} wire schema`, {
        details: parsed.error.issues.slice(0, 10),
      });
    }
    return parsed.data;
  }

  async research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult> {
    checkAbort(h.signal);
    const path = join(this.dir, "research.json");
    const parsed = ResearchFixture.safeParse(await readJson(path, "research dossier"));
    if (!parsed.success) throw new DocmakerError("LLM_SCHEMA", `fixture ${path} is not a research fixture`, { details: parsed.error.issues.slice(0, 10) });
    const f = parsed.data;
    const registry = f.registry.map((r, i) =>
      RegistryEntry.parse({ id: `S${i + 1}`, url: r.url, title: r.title, pageAge: r.page_age, fetched: r.fetched, cited: r.cited, snippets: r.snippets.slice(0, 5) }),
    );
    h.progress(1, "research (fixture)", { sources: registry.length, topic: req.topic });
    return { dossierMarkdown: f.dossier_markdown, registry, searchesUsed: f.searches_used, fetchesUsed: f.fetches_used, turns: 0 };
  }
}

/** Synchronous variant used by tests and tools: reads + validates one fixture file. */
export function readFixtureFile<S extends z.ZodType>(fixtureDir: string, step: string, key: string, schema: S): z.infer<S> {
  const path = join(fixtureLlmDir(fixtureDir), fixtureFileName(step, key));
  if (!existsSync(path)) throw new DocmakerError("FIXTURE_MISSING", `fixture response missing: ${path}`);
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}
