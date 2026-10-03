// direct[lang] (§9.3, App. D): StyleRenderTokens (theme merge, caption variant) → director.direct() with validateAsset =
// assets.validatePick bound to the project → timeline/<lang>.json (compact), .lint.json, .usage.json. SFX files used by
// the timeline are linked into media/<assetId>.wav (the director's TimelineAsset path for SFX entries).
import {
  DOC_VERSIONS, DocmakerError, P, TOKENIZER_VERSION, Timeline, TimelineLintDoc, UsageDoc, collectAssetIds, docHash, hashJson,
  type AssetPick, type FrozenAsset, type LintIssue, type SfxEntry, type WordTiming,
} from "@docmaker/core";
import type { StageCtx, StageDef } from "../types";
import { activeTakeOf, docs, need } from "../docs";
import { X, audioCtx, buildRenderTokens, emitLog, filterPlans, filterScript, filterTexts, needLang, onlyChaptersOf, writeDoc } from "./common";

const ZERO_SCORE = { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "" };

/** SFX entries of the enabled packs (null when a pack was never generated; the assets stage generates them). */
export async function sfxEntriesOrNull(ctx: StageCtx): Promise<SfxEntry[] | null> {
  try {
    return await X(ctx).rt.deps.audio.loadSfxEntries(ctx.project.audio.sfxPacks, audioCtx(ctx));
  } catch {
    return null;
  }
}

export const directStage: StageDef = {
  id: "direct",
  perLang: true,
  version: 1,
  optionKeys: ["onlyChapters"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const e = X(ctx);
    const p = ctx.project;
    const picks = await docs.picks(ctx.store);
    const clipWords: Record<string, string | null> = {};
    for (const c of picks?.clips ?? []) clipWords[c.segmentId] = await ctx.store.docHashOf(P.clipWords(c.segmentId));
    const take = await activeTakeOf(ctx.store, lang);
    const sfx = await sfxEntriesOrNull(ctx);
    return {
      layout: await ctx.store.docHashOf(P.layout(lang)), plans: await ctx.store.docHashOf(P.beatPlans), slices: await ctx.store.docHashOf(P.beatSlices(lang)),
      script: await ctx.store.docHashOf(P.script(lang)), outline: await ctx.store.docHashOf(P.outline),
      picks: await ctx.store.docHashOf(P.picks), frozen: await ctx.store.docHashOf(P.frozen), clipWords,
      userFrozen: Object.keys(await e.rt.deps.assets.readUserFrozen(ctx.store.dir)).sort(), factsheet: await ctx.store.docHashOf(P.factsheet),
      factcheck: await ctx.store.docHashOf(P.factcheck(lang)), riskFlags: await e.riskFlags(),
      pickups: take ? take.segments.filter((s) => s.pickup).map((s) => s.segmentId).sort() : [], takeKind: take?.kind ?? null, provider: take?.provider ?? null,
      styleHash: ctx.style.dataHash, seed: p.seed, captions: p.captions, captionsVariant: p.captionsVariant, video: p.video, themeOverride: p.themeOverride,
      maxClipSeconds: p.assets.maxClipSeconds, licensePolicy: p.assets.licensePolicy, editorial: { monetized: p.editorial.monetized, fairUse: p.editorial.fairUseAcknowledged },
      overrides: await ctx.store.docHashOf(P.overrides(lang)), sfx: sfx ? hashJson(sfx.map((x) => [x.id, x.assetId, x.peakOffsetMs])) : null,
      music: await ctx.store.docHashOf(P.music), personAcks: await e.personAcks(),
      director: e.rt.deps.director.DIRECTOR_VERSION, tokenizer: TOKENIZER_VERSION, timelineVersion: DOC_VERSIONS.timeline,
    };
  },
  outputs: (ctx) => [P.timeline(needLang(ctx)), P.timelineLint(needLang(ctx)), P.usage(needLang(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const p = ctx.project;
    const only = onlyChaptersOf(ctx);
    const layout = need(await docs.layout(ctx.store, lang), `layout/${lang}.json`, `layout (${lang})`);
    if (JSON.stringify(layout.onlyChapters ?? null) !== JSON.stringify(only)) {
      throw new DocmakerError("UPSTREAM_MISSING", `layout/${lang}.json was built for chapters ${layout.onlyChapters?.join(",") ?? "all"}, not ${only?.join(",") ?? "all"}`, { hint: "re-run the layout stage with the same chapter selection" });
    }
    const script = need(await docs.script(ctx.store, lang), `script/${lang}/script.json`, `script (${lang})`);
    const plansDoc = need(await docs.plans(ctx.store), "beats/plans.json", "beats");
    const slices = need(await docs.slices(ctx.store, lang), `beats/${lang}.json`, `beatslice (${lang})`);
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const take = need(await activeTakeOf(ctx.store, lang), `voice/${lang}/active.json`, `voice (${lang})`);
    const picks = (await docs.picks(ctx.store)) ?? { schemaVersion: 1 as const, plansHash: docHash(plansDoc), picks: [], clips: [], portraits: [], orphans: [], updatedAt: new Date(0).toISOString() };
    // assets frozen outside the assets stage (uploads, scene-board freezes) are usable by overrides before the next assets run
    const frozen: Record<string, FrozenAsset> = { ...(await e.rt.deps.assets.readUserFrozen(ctx.store.dir)), ...((await docs.frozen(ctx.store))?.assets ?? {}) };
    const music = (await docs.music(ctx.store))?.tracks ?? [];
    const sfx = (await sfxEntriesOrNull(ctx)) ?? [];
    const outline = await docs.outline(ctx.store);
    const plans = filterPlans(plansDoc.plans, only);
    const texts = filterTexts(slices.texts, plans);
    const fscript = filterScript(script, only);
    const clipWords: Record<string, WordTiming[]> = {};
    for (const c of picks.clips) {
      const w = await docs.clipWords(ctx.store, c.segmentId);
      if (w) clipWords[c.segmentId] = w.words;
    }
    const personAcks = await e.personAcks();
    const planById = new Map(plansDoc.plans.map((x) => [x.id, x]));
    const validateAsset = (assetId: string, beatId: string | null): LintIssue[] => {
      const asset = frozen[assetId];
      const where = beatId ?? "timeline";
      if (!asset) return [{ level: "error", rule: "POLICY", where, msg: `asset ${assetId.slice(0, 12)} is not frozen in this project` }];
      const plan = beatId ? planById.get(beatId) ?? null : null;
      const pick: AssetPick = {
        beatId: beatId ?? plans[0]?.id ?? "CH1-B001", slot: 0, assetId, role: "primary", focal: { x: 0.5, y: 0.45 }, crop: null, sourceInMs: null, sourceOutMs: null,
        score: ZERO_SCORE, pickedBy: "user", planKey: plan?.planKey ?? "0000000000000000",
      };
      // An asset that is someone's portrait (quote/social cards, avatars) is checked as an identity slot for that person.
      const portraitOf = picks.portraits.find((x) => x.assetId === assetId)?.personId ?? null;
      return e.rt.deps.assets.validatePick({ pick, plan, asset, policy: p.assets.licensePolicy, editorial: p.editorial, facts, personAcks, portraitOf });
    };
    const tokens = buildRenderTokens(ctx.style, p, e.rt.deps.styles.styleFontAssets(ctx.style).map((f) => ({ family: f.family, weight: f.weight, style: f.style, url: f.relPath })));
    const out = e.rt.deps.director.direct({
      project: p, lang, style: ctx.style.data, renderTokens: tokens, layout, layoutHash: docHash(layout), script: fscript, plans, texts, facts, picks, frozen,
      clipWords, sfx, music, voiceProvider: take.provider, takeKind: take.kind, pickupSegments: take.segments.filter((s) => s.pickup).map((s) => s.segmentId),
      personAcks, riskFlags: (await e.riskFlags()).filter((f) => f !== "none"), factCheck: await docs.factcheck(ctx.store, lang),
      overrides: await docs.overrides(ctx.store, lang), validateAsset, outline,
    });
    // SFX files referenced by the timeline → media/<assetId>.wav (hardlink into the project; the render asset server serves media/)
    const sfxById = new Map(sfx.map((x) => [x.assetId, x]));
    for (const id of collectAssetIds(out.timeline)) {
      const entry = sfxById.get(id);
      const ta = out.timeline.assets[id];
      if (entry && ta && !(await ctx.store.exists(ta.projectRel))) await ctx.store.linkOrCopy(entry.file, ta.projectRel);
    }
    await writeDoc(ctx, "direct", P.timeline(lang), Timeline, out.timeline);
    await writeDoc(ctx, "direct", P.timelineLint(lang), TimelineLintDoc, { schemaVersion: 1, lang, issues: out.lint, stats: { ...out.stats }, rejectedOverrides: out.rejectedOverrides });
    await writeDoc(ctx, "direct", P.usage(lang), UsageDoc, { schemaVersion: 1, lang, usage: out.usage });
    const errors = out.lint.filter((x) => x.level === "error");
    if (errors.length) emitLog(ctx, "direct", "error", `${lang}: ${errors.length} timeline lint error(s): ${errors.slice(0, 4).map((x) => `${x.rule}@${x.where}`).join(", ")}`);
    if (out.rejectedOverrides.length) emitLog(ctx, "direct", "warn", `${lang}: ${out.rejectedOverrides.length} override(s) rejected`);
    return { artifacts: [P.timeline(lang), P.timelineLint(lang), P.usage(lang)] };
  },
};
