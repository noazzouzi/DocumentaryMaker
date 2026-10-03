// assets (§7.3, App. D): audio.ensureSfxPack (global cache) → prepareMusic (ENGINE: per used mood generateMusic /
// scanMusicLibrary → assets.freezeFile → assets/music.json) → assets.resolveAssets (+ reranker when a key is set) →
// candidates, clips, picks, frozen (music merged), ledger. Never writes user-picks.json or usage.
import {
  CandidatesDoc, ClipWordsDoc, FrozenDoc, Ledger, MusicDoc, P, PicksDoc, docHash, hashJson, rngFor,
  type BeatPlan, type FrozenAsset, type LicenseInfo, type MusicMood, type MusicTrack, type Project, type SfxEntry, type StylePlugin,
} from "@docmaker/core";
import type { AudioCtx, MusicGenOptions } from "@docmaker/audio";
import type { StageCtx, StageDef } from "../types";
import { docs, need } from "../docs";
import { fairUseGate } from "../gates";
import { X, assetsCtx, audioCtx, emitLog, stepCtx, writeDoc } from "./common";

const MOOD_KEY: Record<Exclude<MusicMood, "none">, MusicGenOptions["key"]> = {
  ominous: "D minor", tense: "E minor", sad: "A minor", mysterious: "A minor", epic: "D minor",
  uplifting: "C major", comedic: "C major", chill: "C major",
};
const DEFAULT_MOOD: Exclude<MusicMood, "none"> = "mysterious";

export const PROCEDURAL_MUSIC_LICENSE: LicenseInfo = {
  code: "PROCEDURAL", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false,
  attributionText: null, restrictions: [],
};

const energyOf = (mean: number): MusicGenOptions["energy"] => (mean <= 2.4 ? "low" : mean >= 3.6 ? "high" : "mid");

/** Moods used by the plans (beats with musicMood ≠ none), each with the mean energy of its beats. Sorted by mood. */
export function usedMoods(plans: readonly BeatPlan[]): { mood: Exclude<MusicMood, "none">; energy: MusicGenOptions["energy"] }[] {
  const acc = new Map<Exclude<MusicMood, "none">, { sum: number; n: number }>();
  for (const p of plans) {
    if (p.musicMood === "none") continue;
    const a = acc.get(p.musicMood) ?? { sum: 0, n: 0 };
    a.sum += p.energy;
    a.n += 1;
    acc.set(p.musicMood, a);
  }
  if (acc.size === 0) return [{ mood: DEFAULT_MOOD, energy: "mid" }];
  return [...acc.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([mood, a]) => ({ mood, energy: energyOf(a.sum / a.n) }));
}

/** Procedural generator options for one mood (deterministic from the project seed). Length covers one music section. */
export function musicOptionsFor(project: Pick<Project, "seed" | "targetMinutes">, style: StylePlugin, mood: Exclude<MusicMood, "none">, energy: MusicGenOptions["energy"]): MusicGenOptions {
  const mp = style.data.musicPolicy;
  const bpm = Math.round(mp.moodBpm[mood] ?? 90);
  const sectionSec = Math.min(mp.sectionSec[1], project.targetMinutes * 60 + 30);
  const bars = Math.max(8, Math.ceil((sectionSec * bpm) / 240));
  const seed = Math.floor(rngFor(project.seed, `music:${mood}:${energy}`)() * 0x7fffffff);
  return { mood, bpm, bars, seed, key: MOOD_KEY[mood], energy };
}

/** prepareMusic (engine, §7.3): music tracks + their FrozenAssets (role "music"). */
export async function prepareMusic(ctx: StageCtx, plans: readonly BeatPlan[]): Promise<{ tracks: MusicTrack[]; frozen: FrozenAsset[] }> {
  const e = X(ctx);
  const p = ctx.project;
  const actx: AudioCtx = audioCtx(ctx);
  const assets = assetsCtx(ctx);
  const tracks: MusicTrack[] = [];
  const frozen: FrozenAsset[] = [];
  if (p.audio.music === "none") return { tracks, frozen };
  if (p.audio.music === "library") {
    if (!p.audio.musicLibraryDir) {
      emitLog(ctx, "assets", "warn", "audio.music is \"library\" but no musicLibraryDir is set: no music");
      return { tracks, frozen };
    }
    const lib = await e.rt.deps.audio.scanMusicLibrary(p.audio.musicLibraryDir, actx);
    // declared licences go through the §7.4 policy like every visual (NC on a monetized project, ND, SA without allowShareAlike)
    const policy = new e.rt.deps.assets.LicensePolicyEngine(p.assets.licensePolicy, { monetized: p.editorial.monetized, fairUseAcknowledged: p.editorial.fairUseAcknowledged });
    for (const t of lib) {
      // undeclared library tracks are never used (no USER-OWNED default; the user declares a licence first)
      if (t.license.code === "UNKNOWN" || t.license.restrictions.includes("unknown-rights")) {
        emitLog(ctx, "assets", "warn", `music ${t.title}: no licence declared — skipped`);
        continue;
      }
      const verdict = policy.evaluate(t.license, null);
      if (!verdict.allowed) {
        emitLog(ctx, "assets", "warn", `music ${t.title}: refused by the licence policy (${verdict.reasons.join("; ")}) — skipped`);
        continue;
      }
      // scanMusicLibrary already returns the normalised (-18 LUFS) copy
      const fa = await e.rt.deps.assets.freezeFile({
        file: t.file, kind: "audio", role: "music", candidate: null, declaration: null, projectDir: ctx.store.dir,
        conform: {
          file: t.file, ext: "wav", width: null, height: null, durationMs: t.durationMs, fps: null, hasAudio: true, lufs: -18, recipe: "audio-norm-v1",
          sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0, analysis: { grayscale: null, meanLuma: null, year: null, lowRes: false },
        },
      }, assets);
      frozen.push(fa);
      tracks.push({
        assetId: fa.id, title: t.title, source: "library", moods: t.moods.length ? t.moods : ["none"], energy: "mid", bpm: t.bpm,
        beatsMs: t.beatsMs, downbeatsMs: t.downbeatsMs, durationMs: fa.durationMs ?? t.durationMs, lufs: -18, loopable: false, license: t.license,
      });
    }
    return { tracks, frozen };
  }
  for (const { mood, energy } of usedMoods(plans)) {
    const o = musicOptionsFor(p, ctx.style, mood, energy);
    const g = await e.rt.deps.audio.generateMusic(o, actx);
    const fa = await e.rt.deps.assets.freezeFile({
      file: g.wavPath, kind: "audio", role: "music", candidate: null, declaration: null, projectDir: ctx.store.dir,
      conform: {
        file: g.wavPath, ext: "wav", width: null, height: null, durationMs: g.durationMs, fps: null, hasAudio: true, lufs: -18,
        recipe: "proc-music-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0,
        analysis: { grayscale: null, meanLuma: null, year: null, lowRes: false },
      },
    }, assets);
    frozen.push(fa);
    tracks.push({
      assetId: fa.id, title: `Procedural ${mood} (${o.key}, ${o.bpm} BPM, ${energy})`, source: "procedural", moods: [mood], energy,
      bpm: g.bpm, beatsMs: g.beatsMs, downbeatsMs: g.downbeatsMs, durationMs: g.durationMs, lufs: -18, loopable: true, license: PROCEDURAL_MUSIC_LICENSE,
    });
  }
  return { tracks, frozen };
}

/** SFX entries of the project's enabled packs (each pack generated once in the global cache). Missing optional packs warn. */
export async function ensureSfx(ctx: StageCtx): Promise<SfxEntry[]> {
  const e = X(ctx);
  const actx = audioCtx(ctx);
  const ok: string[] = [];
  for (const pack of ctx.project.audio.sfxPacks) {
    try {
      await e.rt.deps.audio.ensureSfxPack(pack, actx);
      ok.push(pack);
    } catch (err) {
      if (pack === "procedural") throw err;
      emitLog(ctx, "assets", "warn", `SFX pack ${pack} unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return ok.length ? e.rt.deps.audio.loadSfxEntries(ok, actx) : [];
}

function configuredProviders(ctx: StageCtx): string[] {
  const s = ctx.secrets;
  const keyed: Record<string, boolean> = { pexels: !!s.pexels, pixabay: !!s.pixabay, brave: !!s.brave, fal: !!s.fal };
  return ctx.project.assets.providers.filter((id) => keyed[id] ?? true);
}

export const assetsStage: StageDef = {
  id: "assets",
  perLang: false,
  version: 1,
  optionKeys: ["allowPaid"],
  async inputs(ctx) {
    const e = X(ctx);
    const p = ctx.project;
    const primary = await docs.script(ctx.store, p.primaryLang);
    const facts = await docs.factsheet(ctx.store);
    const clipSegs = (primary?.chapters ?? []).flatMap((c) => c.segments.filter((s) => s.type === "clip").map((s) => ({ id: s.id, quoteId: s.quoteId, text: s.displayText })));
    const quoteIds = new Set(clipSegs.map((s) => s.quoteId));
    return {
      plans: await ctx.store.docHashOf(P.beatPlans), userPicks: await ctx.store.docHashOf(P.userPicks), entities: await ctx.store.docHashOf(P.entities),
      factsheet: facts ? docHash(facts) : null, clips: clipSegs, quotes: hashJson((facts?.quotes ?? []).filter((q) => quoteIds.has(q.id))),
      localIndex: await ctx.store.docHashOf(P.localIndex), styleHash: ctx.style.dataHash,
      providers: configuredProviders(ctx), licensePolicy: p.assets.licensePolicy, monetized: p.editorial.monetized, offline: e.offline,
      fairUse: p.editorial.fairUseAcknowledged, visionRerank: p.assets.visionRerank, rerank: !e.offline && ctx.llm.kind === "anthropic" && !!ctx.secrets.anthropic,
      maxCandidatesPerBeat: p.assets.maxCandidatesPerBeat, maxClipSeconds: p.assets.maxClipSeconds, clipFallback: p.assets.clipFallback,
      music: p.audio.music, musicLibraryDir: p.audio.musicLibraryDir, sfxPacks: p.audio.sfxPacks, personAcks: await e.personAcks(),
      riskFlags: await e.riskFlags(), seed: p.seed, themeAccent: p.themeOverride?.accent ?? null,
    };
  },
  async gatesBefore(ctx) {
    const g = await fairUseGate(ctx.store, ctx.project, X(ctx).offline);
    return g ? [g] : [];
  },
  async estimate(ctx) {
    const e = X(ctx);
    const p = ctx.project;
    const plans = await docs.plans(ctx.store);
    const n = plans?.plans.length ?? Math.round(p.targetMinutes * 15);
    const lines = [];
    if (!e.offline && ctx.llm.kind === "anthropic" && ctx.secrets.anthropic && p.assets.visionRerank !== "off") {
      const share = p.assets.visionRerank === "all" ? 1 : 0.3;
      lines.push(...e.rt.deps.llm.estimateStepCost("rerank", { inputChars: Math.round(n * share) * 9_000, outputChars: Math.round(n * share) * 800, cachedChars: 0, lang: null }));
    }
    if (!e.offline && ctx.options.allowPaid && ctx.secrets.fal && p.assets.providers.includes("fal")) {
      const ai = plans?.plans.filter((b) => b.visualKind === "ai_illustration" && b.personIds.length === 0).length ?? 0;
      if (ai > 0) lines.push({ label: "fal flux/schnell images", provider: "fal", unit: "megapixels" as const, quantity: ai * 2.1, unitPriceUsd: 0.003, totalUsd: ai * 2.1 * 0.003 });
    }
    const total = lines.reduce((a, l) => a + l.totalUsd, 0);
    return { stage: "assets", lang: null, lines, totalUsd: total, confidence: lines.length ? "rough" : "exact" };
  },
  outputs: () => [P.picks, P.frozen, P.ledger, P.music],
  async run(ctx) {
    const e = X(ctx);
    const p = ctx.project;
    const plans = need(await docs.plans(ctx.store), "beats/plans.json", "beats");
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const primary = need(await docs.script(ctx.store, p.primaryLang), `script/${p.primaryLang}/script.json`, `script (${p.primaryLang})`);
    const entities = (await docs.entities(ctx.store)) ?? { schemaVersion: 1 as const, entities: [] };
    const userPicks = (await docs.userPicks(ctx.store)) ?? { schemaVersion: 1 as const, picks: [], portraits: [], clips: [] };
    const prevFrozen = await docs.frozen(ctx.store);

    ctx.progress(0.02, "SFX packs");
    await ensureSfx(ctx);
    ctx.progress(0.08, "music");
    const music = await prepareMusic(ctx, plans.plans);
    const frozenWithMusic: FrozenDoc = {
      schemaVersion: 1,
      assets: { ...(prevFrozen?.assets ?? {}), ...Object.fromEntries(music.frozen.map((a) => [a.id, a])) },
    };
    // music assets that are no longer used are dropped from the previous set (resolveAssets keeps role "music" entries)
    const musicIds = new Set(music.frozen.map((a) => a.id));
    for (const [id, a] of Object.entries(frozenWithMusic.assets)) if (a.role === "music" && !musicIds.has(id)) delete frozenWithMusic.assets[id];

    const actx = assetsCtx(ctx);
    const rerank = !e.offline && ctx.llm.kind === "anthropic" && !!ctx.secrets.anthropic && p.assets.visionRerank !== "off";
    const reranker = rerank ? e.rt.deps.llm.makeReranker(stepCtx(ctx)) : null;
    ctx.progress(0.12, "resolving assets");
    const out = await e.rt.deps.assets.resolveAssets({
      project: { ...p, assets: { ...p.assets, offline: e.offline } }, plans, facts, entities, style: ctx.style.data, primaryScript: primary, userPicks,
      previous: { picks: await docs.picks(ctx.store), frozen: frozenWithMusic, ledger: await docs.ledger(ctx.store) },
      projectDir: ctx.store.dir, reranker, personAcks: await e.personAcks(), allowPaid: ctx.options.allowPaid ?? false,
    }, { ...actx, progress: (pct, msg, d) => ctx.progress(0.12 + 0.86 * pct, msg, d) });

    const frozen: FrozenDoc = { schemaVersion: 1, assets: { ...out.frozen.assets, ...Object.fromEntries(music.frozen.map((a) => [a.id, a])) } };
    const artifacts: string[] = [];
    for (const c of out.candidates) {
      await writeDoc(ctx, "assets", P.candidates(c.beatId), CandidatesDoc, c);
      artifacts.push(P.candidates(c.beatId));
    }
    for (const w of out.clipWords) {
      await writeDoc(ctx, "assets", P.clipWords(w.segmentId), ClipWordsDoc, w);
      artifacts.push(P.clipWords(w.segmentId));
    }
    await writeDoc(ctx, "assets", P.frozen, FrozenDoc, frozen);
    await writeDoc(ctx, "assets", P.ledger, Ledger, out.ledger);
    await writeDoc(ctx, "assets", P.picks, PicksDoc, out.picks);
    await writeDoc(ctx, "assets", P.music, MusicDoc, { schemaVersion: 1, tracks: music.tracks });
    const notFound = out.picks.clips.filter((c) => c.status !== "found" && c.status !== "manual");
    if (notFound.length) emitLog(ctx, "assets", "info", `${notFound.length} clip(s) not resolved (${[...new Set(notFound.map((c) => c.status))].join(", ")}): fallback "${p.assets.clipFallback}"`);
    if (out.picks.orphans.length) emitLog(ctx, "assets", "warn", `${out.picks.orphans.length} user pick(s) orphaned (their beat was re-planned)`);
    return { artifacts: [P.picks, P.frozen, P.ledger, P.music, ...artifacts] };
  },
};
