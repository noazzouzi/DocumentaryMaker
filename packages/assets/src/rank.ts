// Ranking (§7.6): metadata score, optional CLIP (M3) and vision rerank fusion, dHash dedupe, needsVisionRerank.
import sharp from "sharp";
import type { AssetProviderId, BeatPlan, Candidate, CandidateRecord, CandidateScore, FactSheet, Person, VisualKind } from "@docmaker/core";
import { candidateNamesPerson, nonLikenessSubject, personNameTokenSets } from "./identity";
import { ERA_SLACK_YEARS, relevancePenalty, relevanceSignals, signalNotes, type BeatContext, type RelevanceSignals } from "./relevance";
import { canonToken, clamp01, matchQueryTokens, matchTokens } from "./util";

/** PROVIDER_PRIOR[visualKind][provider] ∈ [0,1]; missing → 0.5. */
export const PROVIDER_PRIOR: Record<VisualKind, Partial<Record<AssetProviderId, number>>> = {
  archival_photo: { wikimedia: 1, loc: 0.9, openverse: 0.7, "internet-archive": 0.6, nasa: 0.6, pexels: 0.2, pixabay: 0.2, local: 0.95, brave: 0.4, procedural: 0.05 },
  news_footage: { "internet-archive": 1, pexels: 0.6, pixabay: 0.5, nasa: 0.6, local: 0.95, procedural: 0.05 },
  stock_broll: { pexels: 1, pixabay: 0.9, "internet-archive": 0.6, nasa: 0.6, openverse: 0.5, wikimedia: 0.5, local: 0.95, procedural: 0.05 },
  youtube_clip: { youtube: 1, local: 0.9 },
  motion_graphic: { procedural: 0.8, local: 0.9, pexels: 0.5, pixabay: 0.5 },
  document_screenshot: { wikimedia: 0.9, loc: 1, "internet-archive": 0.8, local: 0.95, procedural: 0.3 },
  social_post: { procedural: 0.8, local: 0.9 },
  map: { procedural: 0.8, wikimedia: 0.7, local: 0.9 },
  text_card: { procedural: 0.8, local: 0.9 },
  ai_illustration: { fal: 1, local: 0.9, procedural: 0.5 },
};

export interface MetadataParts { textMatch: number; coverage: number; resolution: number; aspect: number; durFit: number; prior: number; anachronism: number; penalty: number; metadata: number }

/** People of the beat (names), so a lone surname match ("Mackay Island") gets no credit for the person's name. */
export type RankPerson = Pick<Person, "name" | "aliases">;

/** Query tokens that count for this candidate: a person's name tokens only count when the candidate names that person. */
function effectiveQuery(c: Candidate, q: readonly string[], people: readonly RankPerson[]): string[] {
  if (people.length === 0) return [...q];
  const drop = new Set<string>();
  for (const p of people) {
    for (const set of personNameTokenSets(p)) {
      const canon = set.map(canonToken);
      if (!canon.every((t) => q.includes(t))) continue;
      if (!candidateNamesPerson(c, p)) for (const t of canon) drop.add(t);
    }
  }
  return q.filter((t) => !drop.has(t));
}

function fieldsOf(c: Candidate): { title: Set<string>; tags: Set<string>; desc: Set<string> } {
  return { title: new Set(matchTokens(c.title)), tags: new Set(c.tags.flatMap((t) => matchTokens(t))), desc: new Set(matchTokens(c.description)) };
}

function rawText(c: Candidate, q: readonly string[], people: readonly RankPerson[] = []): number {
  const eq = effectiveQuery(c, q, people);
  if (eq.length === 0) return 0;
  const { title, tags, desc } = fieldsOf(c);
  let s = 0;
  for (const t of eq) s += (title.has(t) ? 2 : 0) + (tags.has(t) ? 1.5 : 0) + (desc.has(t) ? 1 : 0);
  return s;
}

/** Share of the query's content tokens found in the candidate's title, tags or description (absolute, not relative to the
 *  other candidates): the relevance floor reads it. A person's name only counts when the candidate names that person. */
export function textCoverage(c: Candidate, queryText: string, people: readonly RankPerson[] = []): number {
  const q = matchQueryTokens(queryText);
  if (q.length === 0) return 0;
  const { title, tags, desc } = fieldsOf(c);
  return effectiveQuery(c, q, people).filter((t) => title.has(t) || tags.has(t) || desc.has(t)).length / q.length;
}

/** Candidates below this coverage of every beat query are irrelevant (unless identity evidence or a vision score says
 *  otherwise): a designed backdrop beats an unrelated photograph. Two words of a five-word query is the least that counts. */
export const RELEVANCE_FLOOR = 0.4;

const PERIOD_KINDS: readonly VisualKind[] = ["archival_photo", "news_footage", "document_screenshot"];
export { ERA_SLACK_YEARS };

export function resolutionScore(c: Pick<Candidate, "kind" | "width">): number {
  if (c.width === null) return 0.5;
  if (c.kind === "video") return c.width >= 1920 ? 1 : c.width >= 1280 ? 0.6 : 0.2;
  return clamp01((Math.min(c.width, 3840) - 960) / 960);
}
export function aspectScore(c: Pick<Candidate, "width" | "height">): number {
  if (!c.width || !c.height) return 0.5;
  return 1 - Math.min(1, Math.abs(Math.log(c.width / c.height / (16 / 9))) / Math.LN2);
}
export function durFitScore(c: Pick<Candidate, "kind" | "durationSec">, beatSec: number): number {
  if (c.kind !== "video") return 1;
  if (c.durationSec === null) return 0.6;
  if (c.durationSec >= beatSec + 2) return 1;
  if (c.durationSec >= 0.5 * beatSec) return 0.6;
  return 0.2;
}

/** All metadata components (textMatch normalised by the best raw text score among `all`). */
export function metadataParts(c: Candidate, plan: BeatPlan, all: readonly Candidate[], o?: { cardShare?: number; queryText?: string; people?: readonly RankPerson[]; era?: readonly [number, number] | null; year?: number | null; signals?: RelevanceSignals | null }): MetadataParts {
  const q = matchQueryTokens(o?.queryText ?? plan.visualQuery);
  const people = o?.people ?? [];
  const max = Math.max(0, ...all.map((x) => rawText(x, q, people)), rawText(c, q, people));
  const textMatch = max > 0 ? rawText(c, q, people) / max : 0;
  const coverage = textCoverage(c, o?.queryText ?? plan.visualQuery, people);
  const resolution = resolutionScore(c);
  const aspect = aspectScore(c);
  const durFit = durFitScore(c, plan.estSeconds);
  const prior = PROVIDER_PRIOR[plan.visualKind]?.[c.provider] ?? 0.5;
  const aspectW = (o?.cardShare ?? 0) > 0 && c.kind === "image" ? 0.05 : 0.1;
  const era = o?.era ?? null;
  const year = o?.year ?? null;
  const signals = o?.signals ?? null;
  // With beat signals (salient nouns, era windows, places, currencies) their penalty replaces the plain story-era check.
  const anachronism = signals ? (signals.anachronism ? 1 : 0)
    : era && year !== null && PERIOD_KINDS.includes(plan.visualKind) && (year < era[0] - ERA_SLACK_YEARS || year > era[1] + ERA_SLACK_YEARS) ? 1 : 0;
  const penalty = signals ? relevancePenalty(signals) : 0.1 * anachronism;
  const metadata = clamp01(0.45 * textMatch + 0.2 * resolution + aspectW * aspect + 0.1 * durFit + 0.15 * prior - penalty);
  return { textMatch, coverage, resolution, aspect, durFit, prior, anachronism, penalty, metadata };
}

export function metadataScore(c: Candidate, plan: BeatPlan, all: readonly Candidate[]): number {
  return metadataParts(c, plan, all).metadata;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Metadata penalty of a grave/statue/plaque/house/signature/coat-of-arms picture on a beat about people. */
export const MEMORIAL_PENALTY = 0.05;

/** Fuses metadata (+ CLIP similarity) (+ vision rerank) into CandidateScore.total and sorts best first (deterministic ties). */
export function rankCandidates(i: {
  plan: BeatPlan; records: CandidateRecord[]; reranked: Map<number, Partial<CandidateScore>> | null; cardShare?: number; people?: readonly RankPerson[];
  era?: readonly [number, number] | null;
  /** Beat relevance context and the texts the beat searched with: salient-noun, era-window, place and currency penalties. */
  relevance?: { ctx: BeatContext; queries: readonly string[] } | null;
}): { record: CandidateRecord; score: CandidateScore }[] {
  const all = i.records.map((r) => r.candidate);
  const scored = i.records.map((record, idx) => {
    const signals = i.relevance ? relevanceSignals(record.candidate, yearOfRaw(record.raw), i.relevance.queries, i.relevance.ctx, i.people ?? []) : null;
    const m = metadataParts(record.candidate, i.plan, all, { cardShare: i.cardShare, people: i.people, era: i.era, year: yearOfRaw(record.raw), signals });
    const rr = i.reranked?.get(idx) ?? null;
    const clip = rr?.clip ?? null;
    // On a beat about people, their likeness comes before their grave, statue or house (which may still illustrate it);
    // their books and letters are fair illustrations and keep their score.
    const subject = (i.people?.length ?? 0) > 0 ? nonLikenessSubject(record.candidate) : null;
    const memorial = subject !== null && subject !== "document" ? MEMORIAL_PENALTY : 0;
    let metadata = clamp01(m.metadata - memorial);
    if (clip !== null && clip !== undefined) metadata = clamp01(metadata - 0.45 * m.textMatch + 0.2 * m.textMatch + 0.25 * clip);
    const vision = rr?.vision ?? null;
    const technical = rr?.technical ?? null;
    const watermark = rr?.watermark ?? null;
    const nsfw = rr?.nsfw ?? null;
    const total = vision !== null && vision !== undefined
      ? clamp01(0.6 * vision * (watermark ? 0.5 : 1) * (nsfw ? 0 : 1) + 0.25 * metadata + 0.15 * (technical ?? 0.5))
      : metadata;
    const score: CandidateScore = {
      metadata: r3(metadata), clip: clip === null || clip === undefined ? null : r3(clip), vision: vision === null || vision === undefined ? null : r3(vision),
      technical: technical === null || technical === undefined ? null : r3(technical), watermark, nsfw, total: r3(nsfw ? 0 : total),
      focal: rr?.focal ?? null, safeCrop: rr?.safeCrop ?? null,
      notes: rr?.notes ?? `text ${m.textMatch.toFixed(2)} cov ${m.coverage.toFixed(2)} res ${m.resolution.toFixed(2)} aspect ${m.aspect.toFixed(2)} dur ${m.durFit.toFixed(2)} prior ${m.prior.toFixed(2)}${signals ? ` ${signalNotes(signals)}` : m.anachronism ? " anachronism" : ""}`,
    };
    return { record: { ...record, score }, score, idx };
  });
  scored.sort((a, b) => b.score.total - a.score.total || b.score.metadata - a.score.metadata || keyOf(a.record.candidate).localeCompare(keyOf(b.record.candidate)));
  return scored.map(({ record, score }) => ({ record, score }));
}

/** Year a provider parsed into the record's raw data (null when unknown). */
export function yearOfRaw(raw: unknown): number | null {
  const y = (raw as { year?: unknown } | null)?.year;
  return typeof y === "number" && Number.isFinite(y) ? y : null;
}

/** The story's era from the fact sheet timeline (min and max years), null when undated. */
export function eraOf(facts: Pick<FactSheet, "timeline">): [number, number] | null {
  const years = facts.timeline.map((e) => /^(-?\d{1,4})/.exec(e.date)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
  return years.length > 0 ? [Math.min(...years), Math.max(...years)] : null;
}

export const keyOf = (c: Pick<Candidate, "provider" | "providerAssetId">): string => `${c.provider}:${c.providerAssetId}`;

/** all → always; selective → person beats, archival/news beats, or top-2 metadata within 0.05; off → never. */
export function needsVisionRerank(plan: BeatPlan, top: readonly CandidateScore[], mode: "off" | "selective" | "all"): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  if (plan.personIds.length > 0) return true;
  if (plan.visualKind === "archival_photo" || plan.visualKind === "news_footage") return true;
  const m = [...top].map((s) => s.metadata).sort((a, b) => b - a);
  return m.length >= 2 && m[0]! - m[1]! <= 0.05;
}

// ------------------------------------------------------------------------------------------------ dHash
/** 64-bit difference hash: 9×8 greyscale, bit = left pixel brighter than its right neighbour. */
export async function dHash(file: string | Buffer): Promise<bigint> {
  const { data } = await sharp(file).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = (h << 1n) | (data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return h;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Drops duplicates: same provider asset id, then near-identical pictures (Hamming ≤ 6) keeping the first occurrence. */
export function dedupeRecords<T extends { candidate: Candidate }>(records: readonly T[], hashes?: ReadonlyMap<string, bigint>, maxDistance = 6): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  const keptHashes: bigint[] = [];
  for (const r of records) {
    const k = keyOf(r.candidate);
    if (seen.has(k)) continue;
    const h = hashes?.get(k);
    if (h !== undefined && keptHashes.some((x) => hamming(x, h) <= maxDistance)) continue;
    seen.add(k);
    kept.push(r);
    if (h !== undefined) keptHashes.push(h);
  }
  return kept;
}
