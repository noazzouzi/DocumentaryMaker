// resolveAssets — the assets stage minus SFX and music (§7.3). Returns documents; the engine writes them (stage-owned only).
// The stage never writes user-picks.json or usage. Media files are hardlinked into <project>/media/ by freezeFile.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CandidatesDoc, docHash, DocmakerError, hashJson, isDocmakerError, LocalIndexDoc, P, PicksDoc } from "@docmaker/core";
import type {
  AssetPick, AssetProvider, AssetProviderId, AssetQuery, BeatPlan, BeatPlansDoc, CandidateRecord, CandidateScore, ClipResolution, ClipWordsDoc,
  EntitiesDoc, FactSheet, FrozenAsset, FrozenDoc, Ledger, PicksDoc as PicksDocT, Project, Reranker, Script, StyleData, UserPicksDoc,
} from "@docmaker/core";
import { buildAiDenylist, checkFalPrompt, falAllowedForBeat } from "./denylist";
import { loadClip } from "./clipsim";
import { buildLedger } from "./ledger";
import { LicensePolicyEngine } from "./license";
import { materializeCandidate } from "./materialize";
import { RecentUse, pickAssets } from "./pick";
import { isClipBeat, isGraphicsBeat, planQueries, providerOrder, shotsNeeded } from "./plan";
import { allProviders, OFFLINE_PROVIDERS } from "./providers";
import type { SearchResult } from "./providers/common";
import { createLocalProvider } from "./providers/local";
import { createProceduralProvider } from "./providers/procedural";
import { FAL_COST_PER_IMAGE_USD, FAL_ENDPOINT, falRequest } from "./providers/paid";
import { ConcurrencyGate, QuotaBuckets } from "./quota";
import { dHash, dedupeRecords, keyOf, needsVisionRerank, rankCandidates } from "./rank";
import type { AssetsCtx } from "./types";
import { readUserFrozen } from "./userfrozen";
import { peopleRuleBlocks, validatePick } from "./validate";
import { errMsg, makeTmpDir, nowIso, rmrf } from "./util";
import { resolveClips, type PassagePicker } from "./youtube/clips";
import { providerContext } from "./materialize";

export interface AssetsStageInput {
  project: Project; plans: BeatPlansDoc; facts: FactSheet; entities: EntitiesDoc; style: StyleData; primaryScript: Script;
  userPicks: UserPicksDoc; previous: { picks: PicksDocT | null; frozen: FrozenDoc | null; ledger: Ledger | null };
  projectDir: string; reranker: Reranker | null; personAcks: readonly string[];
  /** JobOptions.allowPaid (hashed option key of the stage). false → paid providers (Brave, fal) are skipped; the engine passes
   *  `reranker: null` for the same reason. Undefined → the engine's cost gate already approved paid work. */
  allowPaid?: boolean;
  /** Optional LLM tie-breaker for clip passages (engine binds llm.pickPassage); null → the first match ≥ 0.6 wins. */
  passagePicker?: PassagePicker | null;
}
export interface AssetsStageOutput { picks: PicksDocT; frozen: FrozenDoc; ledger: Ledger; candidates: CandidatesDoc[]; clipWords: ClipWordsDoc[] }

const DEFAULT_FOCAL = { x: 0.5, y: 0.45 };
const RERANK_TOP = 8;

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T | null> {
  try {
    const r = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function isOffline(project: Project, ctx: Pick<AssetsCtx, "config">): boolean {
  return ctx.config.offline || project.assets.offline;
}

/** Enabled + configured providers (offline → local + procedural only). Procedural is always last and always present. */
export function activeProviders(project: Project, ctx: Pick<AssetsCtx, "config" | "secrets">, o: { local: AssetProvider; procedural: AssetProvider; allowPaid?: boolean }): Map<AssetProviderId, AssetProvider> {
  const offline = isOffline(project, ctx);
  const registry = new Map<AssetProviderId, AssetProvider>(allProviders().map((p) => [p.id, p]));
  registry.set("local", o.local);
  registry.set("procedural", o.procedural);
  const out = new Map<AssetProviderId, AssetProvider>();
  for (const id of project.assets.providers) {
    const p = registry.get(id);
    if (!p || id === "youtube") continue; // YouTube clips go through resolveClips
    if (offline && !OFFLINE_PROVIDERS.includes(id)) continue;
    if (p.paid && o.allowPaid === false) continue;
    if (!p.isConfigured(ctx.secrets, ctx.config) && id !== "procedural") continue;
    out.set(id, p);
  }
  out.set("procedural", o.procedural);
  return out;
}

function scoreOf(rec: CandidateRecord): CandidateScore {
  return rec.score ?? { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "" };
}

function pickFor(plan: BeatPlan, slot: number, asset: FrozenAsset, score: CandidateScore): AssetPick {
  const video = asset.kind === "video";
  return {
    beatId: plan.id, slot, assetId: asset.id, role: slot === 0 ? "primary" : "alt", focal: score.focal ?? DEFAULT_FOCAL, crop: score.safeCrop ?? null,
    sourceInMs: video ? asset.conform.handleHeadMs : null,
    sourceOutMs: video && asset.durationMs !== null ? Math.max(asset.conform.handleHeadMs, asset.durationMs - asset.conform.handleTailMs) : null,
    score, pickedBy: "auto", planKey: plan.planKey,
  };
}

export async function resolveAssets(i: AssetsStageInput, ctx: AssetsCtx): Promise<AssetsStageOutput> {
  const { project, style, facts } = i;
  const log = ctx.logger.child({ stage: "assets" });
  const offline = isOffline(project, ctx);
  const policyCtx = { monetized: project.editorial.monetized, fairUseAcknowledged: project.editorial.fairUseAcknowledged };
  const policy = new LicensePolicyEngine(project.assets.licensePolicy, policyCtx);
  const pal = style.tokens.palette;
  const palette = [pal.ink, project.themeOverride?.accent ?? pal.accent, pal.secondary];
  const procedural = createProceduralProvider({ palette });
  const localIndex = await readJson(path.join(i.projectDir, P.localIndex), LocalIndexDoc);
  const local = createLocalProvider(localIndex);
  const providers = activeProviders(project, ctx, { local, procedural, allowPaid: i.allowPaid });
  const quota = new QuotaBuckets(ctx.config);
  const gate = new ConcurrencyGate();
  const pctx = providerContext(ctx);
  const denylist = buildAiDenylist(facts, i.entities);
  const prevFrozen = i.previous.frozen?.assets ?? {};
  const userFrozen = await readUserFrozen(i.projectDir);
  const fps = project.video.fps;
  const maxCands = project.assets.maxCandidatesPerBeat;
  const motionData = new Map(i.plans.primary.map((b) => [b.beatId, b.motionData]));
  const cardShare = style.stills.layoutWeights.card;

  const frozen = new Map<string, FrozenAsset>();
  const byKey = new Map<string, FrozenAsset>(); // provider:providerAssetId → frozen (this run + previous)
  for (const a of [...Object.values(prevFrozen), ...Object.values(userFrozen)]) if (a.candidate) byKey.set(keyOf(a.candidate), a);
  const picks: AssetPick[] = [];
  const candidatesDocs: CandidatesDoc[] = [];
  const recent = new RecentUse();
  const plans = [...i.plans.plans].sort((a, b) => a.order - b.order);
  const visualPlans = plans.filter((p) => !isClipBeat(p));

  const mediaOk = async (a: FrozenAsset) => exists(path.join(i.projectDir, a.projectRel));

  /** Freeze (or reuse) a candidate; failures return null so the caller tries the next one. */
  const freeze = async (plan: BeatPlan, rec: CandidateRecord, role: AssetQuery["role"]): Promise<FrozenAsset | null> => {
    const c = rec.candidate;
    const k = keyOf(c);
    const prev = byKey.get(k);
    if (prev && (await mediaOk(prev))) return prev;
    if (prev) {
      // Media link missing (project copied without media/): re-link from the cache when possible.
      try {
        await ctx.cache.linkIntoProject(prev.id, prev.ext, i.projectDir);
        return prev;
      } catch { /* fall through to a fresh fetch */ }
    }
    const provider = providers.get(c.provider) ?? (c.provider === "procedural" ? procedural : null);
    if (!provider) return null;
    if (c.provider === "fal") {
      if (!falAllowedForBeat(plan)) return null;
      const verdict = checkFalPrompt(plan.visualQuery, denylist);
      if (!verdict.ok) {
        log.warn("fal prompt refused", { beatId: plan.id, reason: verdict.reason });
        return null;
      }
    }
    try {
      const a = await gate.run(c.provider, provider.limits.concurrency, () => materializeCandidate({
        provider, candidate: c, raw: rec.raw, role, projectDir: i.projectDir, fps, beatSec: plan.estSeconds,
        declaration: c.provider === "local" ? localIndex?.files.find((f) => f.sha256 === c.providerAssetId)?.declaration ?? null : null,
      }, ctx));
      if (c.provider === "fal") {
        const seed = Number(/^flux-schnell-(\d+)-/.exec(c.providerAssetId)?.[1] ?? 0);
        await ctx.costs.record({
          fingerprint: hashJson({ provider: "fal", endpoint: FAL_ENDPOINT, request: falRequest(c.description, seed) }), provider: "fal", endpoint: FAL_ENDPOINT,
          model: "flux/schnell", stage: "assets", lang: null, usage: { images: 1 }, costUsd: FAL_COST_PER_IMAGE_USD, outputRef: a.projectRel,
        }).catch((e: unknown) => log.warn("could not record the fal receipt", { error: errMsg(e) }));
      }
      byKey.set(k, a);
      return a;
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      log.warn("freeze failed; trying the next candidate", { beatId: plan.id, candidate: k, error: errMsg(e) });
      return null;
    }
  };

  const roleByKey = new Map<string, AssetQuery["role"]>();
  const search = async (plan: BeatPlan, queries: AssetQuery[]): Promise<CandidateRecord[]> => {
    const records: CandidateRecord[] = [];
    for (const q of queries) {
      for (const id of providerOrder(plan, q.kind)) {
        if (records.length >= maxCands) break;
        const p = providers.get(id);
        if (!p || !p.kinds.includes(q.kind)) continue;
        if (id === "fal" && (!falAllowedForBeat(plan) || !checkFalPrompt(q.text, denylist).ok)) continue;
        try {
          if (id !== "local" && id !== "procedural") await quota.acquire(id, p.limits, ctx.signal);
          const res: SearchResult[] = await gate.run(id, p.limits.concurrency, () => p.search(q, pctx));
          for (const r of res) {
            records.push({ candidate: r.candidate, score: null, raw: r.raw });
            if (!roleByKey.has(keyOf(r.candidate))) roleByKey.set(keyOf(r.candidate), q.role);
          }
        } catch (e) {
          if (isDocmakerError(e) && e.code === "CANCELED") throw e;
          log.warn("provider search failed", { provider: id, beatId: plan.id, error: errMsg(e) });
        }
      }
    }
    return records;
  };

  /** Thumbnails of the top candidates → dHash dedupe → optional CLIP similarity (M3) and vision rerank (Reranker). */
  const clipModel = project.assets.useClip && !offline ? await loadClip(ctx.config, log) : null;
  const rerank = async (plan: BeatPlan, recs: CandidateRecord[], ranked: ReturnType<typeof rankCandidates>): Promise<{ recs: CandidateRecord[]; reranked: Map<number, Partial<CandidateScore>> | null }> => {
    const vision = i.reranker !== null && !offline && needsVisionRerank(plan, ranked.slice(0, 2).map((r) => r.score), project.assets.visionRerank);
    if (!vision && !clipModel) return { recs, reranked: null };
    const top = ranked.slice(0, clipModel ? RERANK_TOP + 4 : RERANK_TOP).filter((r) => r.record.candidate.previewUrl);
    if (top.length < 2) return { recs, reranked: null };
    const tmp = await makeTmpDir("thumbs");
    try {
      const thumbs: { rec: CandidateRecord; file: string }[] = [];
      for (const [k, r] of top.entries()) {
        const raw = path.join(tmp, `t${k}.download`);
        const file = path.join(tmp, `t${k}.jpg`);
        try {
          await ctx.http.download(r.record.candidate.previewUrl, raw, { signal: ctx.signal, maxBytes: 8 * 1024 * 1024 });
          // The Reranker contract: local JPEG thumbnails ≤ 768 px (whatever the provider served: webp, png, gif…).
          await sharp(raw, { failOn: "none", animated: false }).rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#000000" }).jpeg({ quality: 85 }).toFile(file);
          thumbs.push({ rec: r.record, file });
        } catch (e) {
          log.debug("thumbnail download failed", { error: errMsg(e) });
        }
      }
      const hashes = new Map<string, bigint>();
      for (const t of thumbs) {
        try {
          hashes.set(keyOf(t.rec.candidate), await dHash(t.file));
        } catch { /* undecodable thumbnail */ }
      }
      const deduped = dedupeRecords(recs, hashes);
      const kept = thumbs.filter((t) => hashes.has(keyOf(t.rec.candidate)) && deduped.some((d) => keyOf(d.candidate) === keyOf(t.rec.candidate)));
      const m = new Map<number, Partial<CandidateScore>>();
      const idxOf = (t: { rec: CandidateRecord }) => deduped.findIndex((d) => keyOf(d.candidate) === keyOf(t.rec.candidate));
      if (clipModel && kept.length > 0) {
        try {
          const sims = await clipModel.scores(plan.visualQuery, kept.map((t) => t.file));
          kept.forEach((t, k) => {
            const idx = idxOf(t);
            if (idx >= 0 && sims[k] !== undefined) m.set(idx, { ...(m.get(idx) ?? {}), clip: sims[k]! });
          });
        } catch (e) {
          log.warn("CLIP scoring failed", { error: errMsg(e) });
        }
      }
      if (vision && kept.length >= 2) {
        const identity = plan.personIds.length > 0 ? `people: ${plan.personIds.join(",")}` : "";
        const top8 = kept.slice(0, RERANK_TOP);
        const res = await i.reranker!.rerank(
          { beatId: plan.id, visualQuery: plan.visualQuery, narration: i.plans.primary.find((b) => b.beatId === plan.id)?.text ?? "", visualKind: plan.visualKind, identityHint: identity },
          top8.map((t) => t.rec.candidate), top8.map((t) => t.file), ctx.signal,
        );
        top8.forEach((t, k) => {
          const idx = idxOf(t);
          const s = res.scores[k];
          if (idx >= 0 && s) m.set(idx, { ...(m.get(idx) ?? {}), ...s });
        });
      }
      return { recs: deduped, reranked: m.size > 0 ? m : null };
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      log.warn("rerank failed; metadata ranking kept", { beatId: plan.id, error: errMsg(e) });
      return { recs, reranked: null };
    } finally {
      await rmrf(tmp);
    }
  };

  let done = 0;
  for (const plan of visualPlans) {
    if (ctx.signal.aborted) throw new DocmakerError("CANCELED", "assets stage canceled");
    ctx.progress(done / Math.max(1, visualPlans.length) * 0.9, `assets ${done + 1}/${visualPlans.length}`, { beatId: plan.id });
    done++;
    const queries = planQueries({ plan, facts, entities: i.entities, style, personAcks: i.personAcks });
    const shots = shotsNeeded(plan, style, motionData.get(plan.id) ?? null);
    const graphics = isGraphicsBeat(plan);

    // Idempotence: keep previous auto picks of an unchanged beat (same planKey) whose media still exist — unless they are
    // procedural fallbacks and we are now online (a real search may do better).
    const prevBeat = (i.previous.picks?.picks ?? []).filter((p) => p.beatId === plan.id && p.pickedBy === "auto" && p.planKey === plan.planKey);
    if (prevBeat.length > 0) {
      const assets = prevBeat.map((p) => prevFrozen[p.assetId]);
      const okAll = assets.every((a) => a !== undefined) && (await Promise.all(assets.map((a) => mediaOk(a!)))).every(Boolean);
      const proceduralOnly = assets.every((a) => a?.candidate?.provider === "procedural" || a?.conform.recipe.startsWith("proc-"));
      if (okAll && (offline || !proceduralOnly)) {
        const issues = prevBeat.flatMap((p) => validatePick({ pick: p, plan, asset: prevFrozen[p.assetId]!, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: i.personAcks }));
        if (!issues.some((x) => x.level === "error")) {
          for (const p of prevBeat) {
            picks.push(p);
            frozen.set(p.assetId, prevFrozen[p.assetId]!);
          }
          recent.push(prevBeat.map((p) => { const c = prevFrozen[p.assetId]!.candidate; return c ? keyOf(c) : p.assetId; }));
          const prevDoc = await readJson(path.join(i.projectDir, P.candidates(plan.id)), CandidatesDoc);
          candidatesDocs.push(prevDoc ?? { schemaVersion: 1, beatId: plan.id, queries, records: [] });
          continue;
        }
      }
    }

    let records = dedupeRecords(await search(plan, queries));
    records = records.filter((r) => {
      const v = policy.evaluate(r.candidate.license, { personIds: plan.personIds, cueTypes: plan.cueTags.map((c) => c.type) });
      return v.allowed && !peopleRuleBlocks(r.candidate.license, r.candidate, plan);
    });
    const real = records.filter((r) => r.candidate.provider !== "procedural");
    let ranked = rankCandidates({ plan, records: real, reranked: null, cardShare });
    if (ranked.length > 1) {
      const rr = await rerank(plan, real, ranked);
      if (rr.reranked || rr.recs.length !== real.length) ranked = rankCandidates({ plan, records: rr.recs, reranked: rr.reranked, cardShare });
    }
    const roleOf = (rec: CandidateRecord): AssetQuery["role"] => roleByKey.get(keyOf(rec.candidate)) ?? queries[0]?.role ?? "broll";

    // Greedy picks with fallback to the next candidate when a freeze or validatePick fails.
    const ordered = pickAssets({ plan, ranked, shots: ranked.length, recentUse: recent.map() });
    const chosen: AssetPick[] = [];
    for (const cand of ordered) {
      if (chosen.length >= shots) break;
      const rec = ranked.find((r) => keyOf(r.record.candidate) === keyOf(cand.candidate))!.record;
      const a = await freeze(plan, rec, roleOf(rec));
      if (!a || chosen.some((p) => p.assetId === a.id)) continue;
      const pick = pickFor(plan, chosen.length, a, cand.score);
      const issues = validatePick({ pick, plan, asset: a, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: i.personAcks });
      if (issues.some((x) => x.level === "error")) {
        log.warn("pick rejected by validatePick", { beatId: plan.id, issues: issues.filter((x) => x.level === "error").map((x) => x.msg) });
        continue;
      }
      chosen.push(pick);
      frozen.set(a.id, a);
    }
    // Nothing usable → procedural (always succeeds). Graphics backgrounds stay empty: the director renders a generated backdrop.
    const procRecords: CandidateRecord[] = [];
    if (chosen.length === 0 && !graphics) {
      const kind: "image" | "video" = queries.find((q) => q.kind === "video") ? "video" : "image";
      const role = queries[0]?.role ?? "broll";
      const q: AssetQuery = queries.find((x) => x.kind === kind) ?? { beatId: plan.id, kind, role, text: plan.visualQuery, localText: null, entityQid: null, personIds: [], orientation: "landscape", minWidth: 0, durationSec: null, limit: shots, lang: null };
      const res = await procedural.search({ ...q, beatId: plan.id, limit: shots, durationSec: kind === "video" ? [Math.ceil(plan.estSeconds + 2), 600] : null }, pctx);
      for (const r of res) {
        const rec: CandidateRecord = { candidate: r.candidate, score: { metadata: 0.1, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0.1, focal: null, safeCrop: null, notes: "procedural fallback" }, raw: r.raw };
        procRecords.push(rec);
        const a = await freeze(plan, rec, role);
        if (!a) continue;
        chosen.push(pickFor(plan, chosen.length, a, scoreOf(rec)));
        frozen.set(a.id, a);
        if (chosen.length >= shots) break;
      }
      if (chosen.length === 0) log.warn("no asset for beat (procedural fallback failed)", { beatId: plan.id });
    }
    picks.push(...chosen);
    recent.push(chosen.map((p) => { const c = frozen.get(p.assetId)?.candidate; return c ? keyOf(c) : p.assetId; }));
    candidatesDocs.push(CandidatesDoc.parse({
      schemaVersion: 1, beatId: plan.id, queries,
      records: [...ranked.map((r) => r.record), ...procRecords].slice(0, Math.max(maxCands, procRecords.length)),
    }));
  }

  // ---- clips (primary clip segments); manual resolutions from user-picks win per segment
  const userClipSegs = new Set(i.userPicks.clips.map((c) => c.segmentId));
  ctx.progress(0.9, "clips");
  const clipRes = await resolveClips({ project, script: i.primaryScript, facts, skipSegments: userClipSegs, projectDir: i.projectDir, passagePicker: i.passagePicker ?? null, personAcks: i.personAcks }, ctx);
  for (const a of clipRes.frozen) frozen.set(a.id, a);
  const clips: ClipResolution[] = [...clipRes.clips];
  const clipWords: ClipWordsDoc[] = [...clipRes.clipWords];
  for (const uc of i.userPicks.clips) {
    if (uc.assetId) {
      const a = frozen.get(uc.assetId) ?? userFrozen[uc.assetId] ?? prevFrozen[uc.assetId];
      if (!a) {
        log.warn("manual clip references an unknown asset; ignored", { segmentId: uc.segmentId });
        continue;
      }
      frozen.set(a.id, a);
    }
    clips.push(uc);
  }
  clips.sort((a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0));

  // ---- user picks: win per (beatId, slot) when the planKey matches; otherwise (or when invalid) they become orphans
  const planById = new Map(plans.map((p) => [p.id, p]));
  const orphans: AssetPick[] = [];
  for (const up of i.userPicks.picks) {
    const plan = planById.get(up.beatId);
    const asset = frozen.get(up.assetId) ?? userFrozen[up.assetId] ?? prevFrozen[up.assetId];
    if (!plan || plan.planKey !== up.planKey || !asset) {
      if (!asset && plan && plan.planKey === up.planKey) log.warn("user pick references an asset that is not frozen", { beatId: up.beatId, slot: up.slot });
      orphans.push(up);
      continue;
    }
    const issues = validatePick({ pick: up, plan, asset, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: i.personAcks });
    if (issues.some((x) => x.level === "error")) {
      log.warn("user pick no longer passes validatePick; kept as orphan", { beatId: up.beatId, slot: up.slot, issues: issues.map((x) => x.msg) });
      orphans.push(up);
      continue;
    }
    const idx = picks.findIndex((p) => p.beatId === up.beatId && p.slot === up.slot);
    if (idx >= 0) picks[idx] = up;
    else picks.push(up);
    frozen.set(asset.id, asset);
  }
  picks.sort((a, b) => (planById.get(a.beatId)?.order ?? 0) - (planById.get(b.beatId)?.order ?? 0) || a.slot - b.slot);

  // ---- portraits: user choices (validated) + the first identity pick per public/acknowledged person
  const portraits: PicksDocT["portraits"] = [];
  const personOk = (pid: string) => {
    const p = facts.people.find((x) => x.id === pid);
    return p !== undefined && !p.isMinorOrPrivateVictim && (p.publicFigure || i.personAcks.includes(pid));
  };
  for (const up of i.userPicks.portraits) {
    const a = frozen.get(up.assetId) ?? userFrozen[up.assetId] ?? prevFrozen[up.assetId];
    if (!personOk(up.personId) || !a || a.kind !== "image") continue;
    portraits.push(up);
    frozen.set(a.id, a);
  }
  for (const person of facts.people) {
    if (portraits.some((p) => p.personId === person.id) || !personOk(person.id)) continue;
    const pk = picks.find((p) => {
      const pl = planById.get(p.beatId);
      const a = frozen.get(p.assetId);
      return pl && a && a.kind === "image" && pl.visualKind === "archival_photo" && pl.personIds.length === 1 && pl.personIds[0] === person.id
        && a.candidate !== null && a.candidate.provider !== "procedural";
    });
    if (pk) portraits.push({ personId: person.id, assetId: pk.assetId });
  }

  // ---- frozen + ledger (keep engine-frozen music so the stage output never drops it)
  for (const a of Object.values(prevFrozen)) if (a.role === "music" && !frozen.has(a.id)) frozen.set(a.id, a);
  const frozenDoc: FrozenDoc = { schemaVersion: 1, assets: Object.fromEntries([...frozen.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) };
  const ledger = buildLedger([...frozen.values()].filter((a) => a.role !== "music"));
  const picksDoc = PicksDoc.parse({ schemaVersion: 1, plansHash: docHash(i.plans), picks, clips, portraits, orphans, updatedAt: nowIso() });

  try {
    await ctx.cache.enforceCap(frozen.keys());
  } catch (e) {
    log.debug("cache gc skipped", { error: errMsg(e) });
  }
  ctx.progress(1, "assets done");
  return { picks: picksDoc, frozen: frozenDoc, ledger, candidates: candidatesDocs, clipWords };
}

/** Quote ids whose YouTube passage matched ≥ 0.8 (the factcheck stage upgrades them to verbatim/video). */
export function videoVerifiedQuotes(picks: PicksDocT): string[] {
  return picks.clips.filter((c) => (c.youtube?.matchScore ?? 0) >= 0.8).map((c) => c.quoteId).sort();
}
