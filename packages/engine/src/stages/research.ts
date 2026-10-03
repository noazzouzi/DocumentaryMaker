// research (§5.1, App. D): runResearch (resumable) → buildFactSheet → entities → verifyQuotes → dossier/registry/factsheet.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  EntitiesDoc, FactSheet, P, RegistryDoc, ResearchDossier, Verification, type EntitiesDoc as EntitiesDocT, type VerificationItem,
} from "@docmaker/core";
import type { StageDef } from "../types";
import { docs } from "../docs";
import { nowIso, writeTextIfChanged } from "../util";
import { X, assetsCtx, emitLog, stepCtx, writeDoc } from "./common";

async function savedTurns(dirAbs: string): Promise<unknown[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dirAbs)).filter((f) => /^turn-\d+\.json$/.test(f));
  } catch {
    return [];
  }
  files.sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5)));
  const out: unknown[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(path.join(dirAbs, f), "utf8")));
    } catch {
      break; // a torn turn ends the resumable prefix
    }
  }
  return out;
}

export const researchStage: StageDef = {
  id: "research",
  perLang: false,
  version: 1,
  optionKeys: [],
  async inputs(ctx) {
    const p = ctx.project;
    return {
      idea: p.idea, languages: p.languages, targetMinutes: p.targetMinutes, asOf: p.editorial.asOf,
      provider: p.llm.provider, fixtureId: p.llm.fixtureId, offline: X(ctx).offline,
    };
  },
  async estimate(ctx) {
    if (ctx.llm.kind === "fixture") return { stage: "research", lang: null, lines: [], totalUsd: 0, confidence: "exact" };
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
    const rawDir = ctx.store.abs("research/raw");
    const resumeTurns = await savedTurns(rawDir);
    if (resumeTurns.length) emitLog(ctx, "research", "info", `resuming research from ${resumeTurns.length} saved turn(s)`);
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
