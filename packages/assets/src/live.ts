// Interactive search (scene board / CLI) with a server-side record cache, and freeze-by-reference (§7.4: the client never
// supplies licence data — the server re-derives the Candidate from candidates/<beatId>.json or this cache).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BeatPlansDoc, CandidateRecord as CandidateRecordSchema, CandidatesDoc, DocmakerError, isDocmakerError, LocalIndexDoc, P, Project, sha16 } from "@docmaker/core";
import type { AssetProvider, AssetProviderId, AssetQuery, BeatPlan, CandidateRecord, FrozenAsset, LicensePolicy } from "@docmaker/core";
import { LicensePolicyEngine } from "./license";
import { materializeCandidate, providerContext } from "./materialize";
import { allProviders, OFFLINE_PROVIDERS } from "./providers";
import { createLocalProvider } from "./providers/local";
import { createProceduralProvider } from "./providers/procedural";
import { QuotaBuckets } from "./quota";
import { dedupeRecords, keyOf, rankCandidates } from "./rank";
import type { AssetsCtx } from "./types";
import { recordUserFrozen } from "./userfrozen";
import { peopleRuleBlocks } from "./validate";
import { errMsg, writeFileAtomic } from "./util";

export const LIVE_CACHE_DIR = "assets/live-cache";
export const LIVE_CACHE_TTL_MS = 7 * 86_400_000;

const liveFile = (projectDir: string, provider: string, id: string) => path.join(projectDir, LIVE_CACHE_DIR, `${provider}-${sha16(`${provider}:${id}`)}.json`);

async function readJson<T>(file: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T | null> {
  try {
    const r = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

async function planOf(projectDir: string, beatId: string | null): Promise<BeatPlan | null> {
  if (!beatId) return null;
  const doc = await readJson(path.join(projectDir, P.beatPlans), BeatPlansDoc);
  return doc?.plans.find((p) => p.id === beatId) ?? null;
}

/** A plan-shaped stand-in for ranking free-text searches. */
function pseudoPlan(q: AssetQuery): BeatPlan {
  return {
    id: "CH1-B001", chapterId: "CH1", segmentId: "CH1-S01", order: 0, origin: "user", purpose: "context", energy: 3, estSeconds: 4,
    visualKind: q.kind === "video" ? "stock_broll" : "archival_photo", visualQuery: q.text, personIds: q.personIds, quoteId: null, youtubeQuoteToFind: "",
    motionTemplate: "none", camera: "static", transitionIn: "cut", sfx: [], musicCue: "none", musicMood: "none", factIds: [], cueTags: [], planKey: "0000000000000000",
  };
}

async function providerFor(id: AssetProviderId, projectDir: string): Promise<AssetProvider> {
  if (id === "local") return createLocalProvider(await readJson(path.join(projectDir, P.localIndex), LocalIndexDoc));
  if (id === "procedural") return createProceduralProvider();
  const p = allProviders().find((x) => x.id === id);
  if (!p) throw new DocmakerError("VALIDATION", `unknown provider ${id}`);
  return p;
}

export async function liveSearch(i: { query: AssetQuery; providers: AssetProviderId[]; allowPaid: boolean; policy: LicensePolicy; editorial: Project["editorial"]; projectDir: string }, ctx: AssetsCtx): Promise<CandidateRecord[]> {
  const project = await readJson(path.join(i.projectDir, P.project), Project);
  const offline = ctx.config.offline || (project?.assets.offline ?? false);
  const engine = new LicensePolicyEngine(i.policy, { monetized: i.editorial.monetized, fairUseAcknowledged: i.editorial.fairUseAcknowledged });
  const plan = (await planOf(i.projectDir, i.query.beatId)) ?? pseudoPlan(i.query);
  const quota = new QuotaBuckets(ctx.config);
  const records: CandidateRecord[] = [];
  for (const id of i.providers) {
    if (offline && !OFFLINE_PROVIDERS.includes(id)) continue;
    const p = await providerFor(id, i.projectDir);
    if (p.paid && !i.allowPaid) continue;
    if (!p.kinds.includes(i.query.kind) || !p.isConfigured(ctx.secrets, ctx.config)) continue;
    try {
      if (id !== "local" && id !== "procedural") await quota.acquire(id, p.limits, ctx.signal);
      for (const r of await p.search(i.query, providerContext(ctx))) records.push({ candidate: r.candidate, score: null, raw: r.raw });
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      ctx.logger.warn("live search provider failed", { provider: id, error: errMsg(e) });
    }
  }
  const allowed = dedupeRecords(records).filter((r) => {
    const v = engine.evaluate(r.candidate.license, { personIds: plan.personIds, cueTypes: plan.cueTags.map((c) => c.type) });
    return v.allowed && !peopleRuleBlocks(r.candidate.license, r.candidate, plan);
  });
  const ranked = rankCandidates({ plan, records: allowed, reranked: null }).map((r) => r.record);
  const at = Date.now();
  for (const r of ranked) await writeFileAtomic(liveFile(i.projectDir, r.candidate.provider, r.candidate.providerAssetId), JSON.stringify({ cachedAt: at, record: r }));
  return ranked;
}

async function findRecord(projectDir: string, beatId: string, provider: AssetProviderId, providerAssetId: string): Promise<CandidateRecord | null> {
  const doc = await readJson(path.join(projectDir, P.candidates(beatId)), CandidatesDoc);
  const hit = doc?.records.find((r) => r.candidate.provider === provider && r.candidate.providerAssetId === providerAssetId);
  if (hit) return hit;
  try {
    const j = JSON.parse(await readFile(liveFile(projectDir, provider, providerAssetId), "utf8")) as { cachedAt: number; record: CandidateRecord };
    if (Date.now() - j.cachedAt > LIVE_CACHE_TTL_MS) return null;
    const parsed = CandidateRecordSchema.safeParse(j.record);
    if (parsed.success && keyOf(parsed.data.candidate) === `${provider}:${providerAssetId}`) return parsed.data;
  } catch { /* not cached */ }
  return null;
}

export async function freezeCandidate(i: { projectDir: string; beatId: string; provider: AssetProviderId; providerAssetId: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  const rec = await findRecord(i.projectDir, i.beatId, i.provider, i.providerAssetId);
  if (!rec) throw new DocmakerError("VALIDATION", `unknown candidate ${i.provider}:${i.providerAssetId} for ${i.beatId}`, { hint: "search again; candidates expire after 7 days" });
  const project = await readJson(path.join(i.projectDir, P.project), Project);
  if (!project) throw new DocmakerError("UPSTREAM_MISSING", "project.json is missing or invalid");
  if ((ctx.config.offline || project.assets.offline) && !OFFLINE_PROVIDERS.includes(i.provider)) {
    throw new DocmakerError("OFFLINE", "offline mode: only local and procedural assets can be frozen");
  }
  const plan = await planOf(i.projectDir, i.beatId);
  const engine = new LicensePolicyEngine(project.assets.licensePolicy, { monetized: project.editorial.monetized, fairUseAcknowledged: project.editorial.fairUseAcknowledged });
  const v = engine.evaluate(rec.candidate.license, plan ? { personIds: plan.personIds, cueTypes: plan.cueTags.map((c) => c.type) } : null);
  if (!v.allowed) throw new DocmakerError("POLICY_DENIED", `licence denied: ${v.reasons.join("; ")}`);
  if (peopleRuleBlocks(rec.candidate.license, rec.candidate, plan)) throw new DocmakerError("POLICY_DENIED", "stock look-alikes cannot stand in for real people or appear on SHOCK/SENSITIVE/REVEAL beats");
  const provider = await providerFor(i.provider, i.projectDir);
  const localDecl = i.provider === "local" ? (provider as ReturnType<typeof createLocalProvider>).index?.files.find((f) => f.sha256 === i.providerAssetId)?.declaration ?? null : null;
  const role = plan?.visualKind === "archival_photo" ? (plan.personIds.length > 0 ? "portrait" : "archival") : plan?.visualKind === "document_screenshot" ? "document" : "broll";
  const a = await materializeCandidate({ provider, candidate: rec.candidate, raw: rec.raw, role, projectDir: i.projectDir, fps: project.video.fps, beatSec: plan?.estSeconds ?? 6, declaration: localDecl }, ctx);
  await recordUserFrozen(i.projectDir, a);
  return a;
}
