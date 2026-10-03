// Ranking (§7.6): metadata score, optional CLIP (M3) and vision rerank fusion, dHash dedupe, needsVisionRerank.
import sharp from "sharp";
import type { AssetProviderId, BeatPlan, Candidate, CandidateRecord, CandidateScore, VisualKind } from "@docmaker/core";
import { clamp01, queryTokens, tokensOf } from "./util";

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

export interface MetadataParts { textMatch: number; resolution: number; aspect: number; durFit: number; prior: number; metadata: number }

function rawText(c: Candidate, q: readonly string[]): number {
  if (q.length === 0) return 0;
  const title = new Set(tokensOf(c.title));
  const tags = new Set(c.tags.flatMap((t) => tokensOf(t)));
  const desc = new Set(tokensOf(c.description));
  let s = 0;
  for (const t of q) s += (title.has(t) ? 2 : 0) + (tags.has(t) ? 1.5 : 0) + (desc.has(t) ? 1 : 0);
  return s;
}

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
export function metadataParts(c: Candidate, plan: BeatPlan, all: readonly Candidate[], o?: { cardShare?: number; queryText?: string }): MetadataParts {
  const q = queryTokens(o?.queryText ?? plan.visualQuery);
  const max = Math.max(0, ...all.map((x) => rawText(x, q)), rawText(c, q));
  const textMatch = max > 0 ? rawText(c, q) / max : 0;
  const resolution = resolutionScore(c);
  const aspect = aspectScore(c);
  const durFit = durFitScore(c, plan.estSeconds);
  const prior = PROVIDER_PRIOR[plan.visualKind]?.[c.provider] ?? 0.5;
  const aspectW = (o?.cardShare ?? 0) > 0 && c.kind === "image" ? 0.05 : 0.1;
  const metadata = clamp01(0.45 * textMatch + 0.2 * resolution + aspectW * aspect + 0.1 * durFit + 0.15 * prior);
  return { textMatch, resolution, aspect, durFit, prior, metadata };
}

export function metadataScore(c: Candidate, plan: BeatPlan, all: readonly Candidate[]): number {
  return metadataParts(c, plan, all).metadata;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Fuses metadata (+ CLIP similarity) (+ vision rerank) into CandidateScore.total and sorts best first (deterministic ties). */
export function rankCandidates(i: { plan: BeatPlan; records: CandidateRecord[]; reranked: Map<number, Partial<CandidateScore>> | null; cardShare?: number }): { record: CandidateRecord; score: CandidateScore }[] {
  const all = i.records.map((r) => r.candidate);
  const scored = i.records.map((record, idx) => {
    const m = metadataParts(record.candidate, i.plan, all, { cardShare: i.cardShare });
    const rr = i.reranked?.get(idx) ?? null;
    const clip = rr?.clip ?? null;
    let metadata = m.metadata;
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
      notes: rr?.notes ?? `text ${m.textMatch.toFixed(2)} res ${m.resolution.toFixed(2)} aspect ${m.aspect.toFixed(2)} dur ${m.durFit.toFixed(2)} prior ${m.prior.toFixed(2)}`,
    };
    return { record: { ...record, score }, score, idx };
  });
  scored.sort((a, b) => b.score.total - a.score.total || b.score.metadata - a.score.metadata || keyOf(a.record.candidate).localeCompare(keyOf(b.record.candidate)));
  return scored.map(({ record, score }) => ({ record, score }));
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
