// research (§5.1, App. D): runResearch (resumable) → buildFactSheet → entities → verifyQuotes → dossier/registry/factsheet.
// Saved research turns (research/raw/turn-<n>.json) are scoped to one research request by research/raw/meta.json: they are
// resumed only for the same request (topic, languages, minutes, asOf, provider, stage version) and discarded when the
// request changed or `newRequest` asks for a new paid call. A forced re-run of the same request replays them (§5.3:
// paid calls are reused; a forced no-op re-run changes nothing).
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  EntitiesDoc, FactSheet, P, RegistryDoc, ResearchDossier, Verification, hashJson, type EntitiesDoc as EntitiesDocT, type Project,
  type VerificationItem,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { StageDef } from "../types";
import { docs } from "../docs";
import { nowIso, writeTextIfChanged } from "../util";
import { X, assetsCtx, emitLog, llmBilled, llmHashKind, stepCtx, writeDoc } from "./common";

const RESEARCH_VERSION = 1;
export const RESEARCH_RAW_DIR = "research/raw";
export const RESEARCH_META = "research/raw/meta.json";
const TURN_RE = /^turn-(\d+)\.json$/;

/** What identifies one research request: saved turns are resumable only for the same key. */
export function researchRequestKey(p: Pick<Project, "idea" | "languages" | "targetMinutes" | "editorial" | "llm">): string {
  return hashJson({
    stageVersion: RESEARCH_VERSION, topic: p.idea, langs: [...p.languages].sort(), minutes: p.targetMinutes, asOf: p.editorial.asOf,
    provider: p.llm.provider, fixtureId: p.llm.provider === "fixture" ? p.llm.fixtureId : null,
  });
}

/** research/raw/meta.json: which request the saved turns belong to (no timestamps: a replay rewrites nothing). */
interface RawMeta { schemaVersion: 1; requestKey: string }

async function readMeta(store: ProjectStore): Promise<RawMeta | null> {
  try {
    const m = JSON.parse(await readFile(store.abs(RESEARCH_META), "utf8")) as Partial<RawMeta>;
    return typeof m.requestKey === "string" ? { schemaVersion: 1, requestKey: m.requestKey } : null;
  } catch {
    return null;
  }
}
async function writeMeta(store: ProjectStore, requestKey: string): Promise<void> {
  await writeTextIfChanged(store.abs(RESEARCH_META), JSON.stringify({ schemaVersion: 1, requestKey } satisfies RawMeta, null, 2) + "\n");
}

async function turnFiles(dirAbs: string): Promise<string[]> {
  try {
    return (await readdir(dirAbs)).filter((f) => TURN_RE.test(f)).sort((a, b) => Number(TURN_RE.exec(a)![1]) - Number(TURN_RE.exec(b)![1]));
  } catch {
    return [];
  }
}

/** The contiguous prefix turn-1 … turn-n of readable saved turns. */
async function savedTurns(dirAbs: string): Promise<unknown[]> {
  const files = await turnFiles(dirAbs);
  const out: unknown[] = [];
  for (const [i, f] of files.entries()) {
    if (f !== `turn-${i + 1}.json`) break; // a gap ends the resumable prefix
    try {
      out.push(JSON.parse(await readFile(path.join(dirAbs, f), "utf8")));
    } catch {
      break; // a torn turn ends the resumable prefix
    }
  }
  return out;
}

const stopReason = (t: unknown): string | null =>
  t && typeof t === "object" && typeof (t as { stop_reason?: unknown }).stop_reason === "string" ? (t as { stop_reason: string }).stop_reason : null;

/** Deletes every saved turn; returns how many there were. */
async function clearTurns(dirAbs: string): Promise<number> {
  const files = await turnFiles(dirAbs);
  for (const f of files) await rm(path.join(dirAbs, f), { force: true });
  return files.length;
}

export interface ResearchResumeInfo {
  /** Readable saved turns (contiguous prefix). */
  saved: number;
  /** The saved turns belong to the project's current research request. */
  matches: boolean;
  /** The last saved turn ended the research (no pause_turn): a resume only rebuilds the fact sheet. */
  complete: boolean;
}

/** Saved research turns of a project and whether a research run would resume from them. */
export async function researchResumeInfo(store: ProjectStore, project: Project): Promise<ResearchResumeInfo> {
  const turns = await savedTurns(store.abs(RESEARCH_RAW_DIR));
  const meta = await readMeta(store);
  const last = turns.length ? stopReason(turns[turns.length - 1]) : null;
  return { saved: turns.length, matches: turns.length > 0 && meta?.requestKey === researchRequestKey(project), complete: turns.length > 0 && last !== null && last !== "pause_turn" };
}

export const researchStage: StageDef = {
  id: "research",
  perLang: false,
  version: RESEARCH_VERSION,
  optionKeys: [],
  async inputs(ctx) {
    const p = ctx.project;
    return {
      idea: p.idea, languages: p.languages, targetMinutes: p.targetMinutes, asOf: p.editorial.asOf,
      provider: llmHashKind(p.llm.provider), fixtureId: p.llm.fixtureId, offline: X(ctx).offline,
    };
  },
  async estimate(ctx) {
    if (!llmBilled(ctx)) return { stage: "research", lang: null, lines: [], totalUsd: 0, confidence: "exact" };
    const e = X(ctx);
    const minutes = ctx.project.targetMinutes;
    const lines = [
      ...e.rt.deps.llm.estimateStepCost("research", { inputChars: 60_000 + minutes * 2_000, outputChars: 24_000 + minutes * 600, cachedChars: 0, webSearches: 25, lang: null }),
      ...e.rt.deps.llm.estimateStepCost("factsheet", { inputChars: 40_000 + minutes * 1_500, outputChars: 20_000 + minutes * 500, cachedChars: 0, lang: null }),
    ];
    return { stage: "research", lang: null, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "rough" };
  },
  outputs: () => [P.dossier, P.dossierMd, P.registry, P.factsheet, P.verification, P.entities],
  async run(ctx) {
    const e = X(ctx);
    const p = ctx.project;
    const fixture = ctx.llm.kind === "fixture";
    const rawDir = ctx.store.abs(RESEARCH_RAW_DIR);
    const requestKey = researchRequestKey(p);
    const meta = await readMeta(ctx.store);
    let resumeTurns: unknown[] = [];
    if (meta?.requestKey === requestKey && ctx.options.newRequest !== true) {
      resumeTurns = await savedTurns(rawDir);
      // turns past a gap or a torn file can never be resumed: drop them so a new turn n never sits next to an old n+1
      const files = await turnFiles(rawDir);
      for (const f of files.slice(resumeTurns.length)) await rm(path.join(rawDir, f), { force: true });
    } else {
      const dropped = await clearTurns(rawDir);
      if (dropped) {
        const why = ctx.options.newRequest === true ? "a new request was asked for" : meta ? "the research request changed (idea, languages, length, as-of date or provider)" : "they are not tied to a known request";
        emitLog(ctx, "research", "info", `discarded ${dropped} saved research turn(s): ${why}`);
      }
    }
    if (resumeTurns.length) {
      const done = stopReason(resumeTurns[resumeTurns.length - 1]) !== "pause_turn";
      emitLog(ctx, "research", "info", done ? `reusing the completed research (${resumeTurns.length} saved turn(s))` : `resuming research from ${resumeTurns.length} saved turn(s)`);
    }
    await writeMeta(ctx.store, requestKey);
    const rawFiles: string[] = resumeTurns.map((_, i) => P.researchTurn(i + 1));
    const r = await e.rt.deps.llm.runResearch(stepCtx(ctx), {
      topic: p.idea, langs: p.languages, minutes: p.targetMinutes, asOf: p.editorial.asOf, resumeTurns,
      onTurn: async (n, message) => {
        const rel = P.researchTurn(n);
        await writeTextIfChanged(ctx.store.abs(rel), JSON.stringify(message));
        if (!rawFiles.includes(rel)) rawFiles.push(rel);
      },
    });
    const registry: RegistryDoc = { schemaVersion: 1, entries: r.registry };
    const dossier: ResearchDossier = {
      schemaVersion: 1, topic: p.idea, asOf: p.editorial.asOf, searchLanguages: p.languages, markdown: r.dossierMarkdown,
      searchesUsed: r.searchesUsed, fetchesUsed: r.fetchesUsed, turns: r.turns, rawFiles: [...new Set(rawFiles)].sort(), generatedBy: fixture ? "fixture" : "llm",
    };
    ctx.progress(0.5, "building the fact sheet");
    const built = await e.rt.deps.llm.buildFactSheet(stepCtx(ctx), { dossier, registry, asOf: p.editorial.asOf, topic: p.idea });
    let facts = built.factSheet;

    // entities (Wikidata): public persons only; non-public after person-ack; never minors / private victims (§6.3)
    ctx.progress(0.7, "resolving entities");
    const previous = await docs.entities(ctx.store);
    const acks = new Set(await e.personAcks());
    const offlineLike = e.offline || fixture;
    const actx = offlineLike ? null : assetsCtx(ctx);
    const entities: EntitiesDocT["entities"] = [];
    for (const person of facts.people) {
      const userSet = previous?.entities.find((x) => x.personId === person.id && x.resolvedBy === "user");
      if (userSet) {
        entities.push(userSet);
        continue;
      }
      const allowed = !person.isMinorOrPrivateVictim && (person.publicFigure || acks.has(person.id));
      let hit: { qid: string; label: string; aliases: string[] } | null = null;
      if (allowed && actx) {
        try {
          hit = await e.rt.deps.assets.resolveEntity(person.name, p.primaryLang, { http: actx.http, signal: ctx.signal });
        } catch (err) {
          emitLog(ctx, "research", "warn", `entity lookup failed for ${person.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      entities.push(hit
        ? { personId: person.id, qid: hit.qid, label: hit.label, aliases: hit.aliases, resolvedBy: "wbsearchentities" }
        : { personId: person.id, qid: null, label: person.name, aliases: [], resolvedBy: "none" });
    }
    const byPerson = new Map(entities.map((x) => [x.personId, x]));
    facts = {
      ...facts,
      people: facts.people.map((pp) => {
        const en = byPerson.get(pp.id);
        if (!en || pp.isMinorOrPrivateVictim) return { ...pp, wikidataQid: null };
        return { ...pp, wikidataQid: en.qid, aliases: [...new Set([...pp.aliases, ...en.aliases])] };
      }),
    };

    // quote verification: offline or fixture → no request at all (quotes stay "unchecked", items "skipped-offline")
    ctx.progress(0.85, "verifying quotes");
    const vq = await e.rt.deps.assets.verifyQuotes(facts, { http: actx?.http ?? null, offline: offlineLike, signal: ctx.signal });
    facts = vq.factSheet;
    const regIds = new Set(registry.entries.map((x) => x.id));
    const refItems: VerificationItem[] = facts.sources.map((s) => ({ ref: s.id, check: "source-ref", ok: regIds.has(s.id), detail: regIds.has(s.id) ? "in registry" : "not returned by the API" }));
    const verification: Verification = { schemaVersion: 1, checkedAt: nowIso(), items: [...refItems, ...vq.items], invalidRefs: built.invalidRefs };

    await writeDoc(ctx, "research", P.dossier, ResearchDossier, dossier);
    await writeTextIfChanged(ctx.store.abs(P.dossierMd), r.dossierMarkdown.endsWith("\n") ? r.dossierMarkdown : r.dossierMarkdown + "\n");
    await writeDoc(ctx, "research", P.registry, RegistryDoc, registry);
    await writeDoc(ctx, "research", P.factsheet, FactSheet, facts);
    await writeDoc(ctx, "research", P.verification, Verification, verification);
    await writeDoc(ctx, "research", P.entities, EntitiesDoc, { schemaVersion: 1, entities });
    return { artifacts: [P.dossier, P.dossierMd, P.registry, P.factsheet, P.verification, P.entities, ...dossier.rawFiles] };
  },
};
