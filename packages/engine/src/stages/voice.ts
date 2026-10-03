// voice[lang] (§8.9, App. D): scratch → voice.synthesizeTrack({kind:"scratch"}) (synthetic, free, ungated);
// final → gates (factcheck-ack, person-ack, cost) unless the provider is synthetic → synthesizeTrack() or, for the
// "recording" provider, importRecording() of voice/<lang>/recordings/* → take.json + active.json.
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  ActiveTake, DocmakerError, P, VoiceSettings, VoiceTrack, hashJson, spokenText,
  type Lang, type PicksDoc, type Project, type Script,
} from "@docmaker/core";
import type { StageCtx, StageDef } from "../types";
import { activeTakeOf, docs, need } from "../docs";
import { factcheckGate, personGate } from "../gates";
import { nowIso } from "../util";
import { X, needLang, voiceCtx, writeDoc } from "./common";
import { cpsOf } from "./outline";

export type TakeKind = "scratch" | "final";
export const takeKindOf = (ctx: Pick<StageCtx, "options">): TakeKind => ctx.options.takeKind ?? "final";

export function voiceSettingsOf(project: Project, lang: Lang): VoiceSettings {
  return project.voice[lang] ?? VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1" });
}

/** Final takes need the editorial gates unless the user explicitly chose the free synthetic voice (§8.9). */
export function finalTakeGated(project: Project, lang: Lang, kind: TakeKind): boolean {
  return kind === "final" && voiceSettingsOf(project, lang).provider !== "synthetic";
}

/** Clip segments narrated as a fallback (clip not found/manual and clipFallback "narrated"). */
export function clipNarratedOf(project: Project, script: Script, picks: PicksDoc | null): string[] {
  if (project.assets.clipFallback !== "narrated") return [];
  const res = new Map((picks?.clips ?? []).map((c) => [c.segmentId, c]));
  const out: string[] = [];
  for (const ch of script.chapters) {
    for (const s of ch.segments) {
      if (s.type !== "clip") continue;
      const r = res.get(s.id);
      if (!r || (r.status !== "found" && r.status !== "manual")) out.push(s.id);
    }
  }
  return out;
}

async function recordingFiles(ctx: StageCtx, lang: Lang): Promise<string[]> {
  const dir = ctx.store.abs(P.recordings(lang));
  try {
    return (await readdir(dir)).filter((f) => /\.(wav|mp3|m4a|flac|ogg|aac|webm)$/i.test(f)).sort().map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export const voiceStage: StageDef = {
  id: "voice",
  perLang: true,
  version: 1,
  optionKeys: ["takeKind", "segments", "retryBad", "pickupTts"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const e = X(ctx);
    const script = await docs.script(ctx.store, lang);
    const picks = await docs.picks(ctx.store);
    const kind = takeKindOf(ctx);
    const voice = voiceSettingsOf(ctx.project, lang);
    const narrated = script ? clipNarratedOf(ctx.project, script, picks) : [];
    const segs = (script?.chapters ?? []).flatMap((c) => c.segments
      .filter((s) => s.type === "narration" || narrated.includes(s.id))
      .map((s) => ({ id: s.id, tts: hashJson(s.type === "narration" ? s.ttsText : spokenText(s, "clip-narrated")) })));
    const recordings = kind === "final" && voice.provider === "recording" ? await recordingFiles(ctx, lang) : [];
    return {
      lang, kind, segments: segs, narrated,
      voice: kind === "scratch" ? { provider: "synthetic", lexicon: voice.lexicon } : { settings: e.rt.deps.voice.voiceSettingsHash(voice), provider: voice.provider },
      cps: cpsOf(ctx.project, ctx.style, lang),
      recordings: await Promise.all(recordings.map(async (f) => ({ name: path.basename(f), etag: await ctx.store.etag(path.relative(ctx.store.dir, f)) }))),
    };
  },
  async gatesBefore(ctx) {
    const lang = needLang(ctx);
    if (!finalTakeGated(ctx.project, lang, takeKindOf(ctx))) return [];
    const out = [];
    const fc = await factcheckGate(ctx.store, ctx.project, lang);
    if (fc) out.push(fc);
    const pg = await personGate(ctx.store, ctx.project);
    if (pg) out.push(pg);
    return out;
  },
  async estimate(ctx) {
    const lang = needLang(ctx);
    const kind = takeKindOf(ctx);
    const voice = voiceSettingsOf(ctx.project, lang);
    if (kind === "scratch" || voice.provider !== "elevenlabs") return { stage: "voice", lang, lines: [], totalUsd: 0, confidence: "exact" };
    const script = await docs.script(ctx.store, lang);
    if (!script) return null;
    const previous = await activeTakeOf(ctx.store, lang);
    const lines = X(ctx).rt.deps.voice.estimateTtsCost({ script, voice, segments: ctx.options.segments ?? null, previous });
    return { stage: "voice", lang, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: (ctx) => [P.activeTake(needLang(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const p = ctx.project;
    const script = need(await docs.script(ctx.store, lang), `script/${lang}/script.json`, `script (${lang})`);
    const facts = await docs.factsheet(ctx.store);
    const picks = await docs.picks(ctx.store);
    const kind = takeKindOf(ctx);
    const voice = voiceSettingsOf(p, lang);
    const previous = await activeTakeOf(ctx.store, lang);
    const clipNarrated = clipNarratedOf(p, script, picks);
    const personNames = (facts?.people ?? []).flatMap((x) => [x.name, ...x.aliases]);
    const vctx = voiceCtx(ctx);
    let track: VoiceTrack;
    if (kind === "final" && voice.provider === "recording") {
      const files = await recordingFiles(ctx, lang);
      if (files.length === 0) throw new DocmakerError("UPSTREAM_MISSING", `no recording in ${P.recordings(lang)}`, { hint: "docmaker voice import <slug> <files…>" });
      const perSegment = files.every((f) => /^CH\d+-S\d+/.test(path.basename(f)));
      const pickupProvider = voice.pickupProvider;
      track = await e.rt.deps.voice.importRecording({
        lang, script, files, mode: perSegment ? "per-segment" : "global", aligner: "auto",
        previous: previous && previous.provider === "recording" ? previous : null, projectDir: ctx.store.dir,
        pickup: ctx.options.pickupTts && pickupProvider ? { provider: pickupProvider, voice: { ...voice, provider: pickupProvider } } : null,
        clipNarrated, namesPrompt: personNames.slice(0, 40).join(", "),
      }, vctx);
    } else {
      track = await e.rt.deps.voice.synthesizeTrack({
        lang, script, voice, kind, clipNarrated, segments: ctx.options.segments ?? null,
        previous: previous && previous.kind === kind ? previous : null, projectDir: ctx.store.dir,
        styleCps: cpsOf(p, ctx.style, lang), retryBad: ctx.options.retryBad === true, personNames,
      }, vctx);
    }
    if (track.lang !== lang) throw new DocmakerError("INTERNAL", `voice returned a ${track.lang} take for ${lang}`);
    await writeDoc(ctx, "voice", P.take(lang, track.id), VoiceTrack, track);
    const cur = await docs.activeTake(ctx.store, lang);
    if (!cur || cur.takeId !== track.id) {
      await writeDoc(ctx, "voice", P.activeTake(lang), ActiveTake, { schemaVersion: 1, lang, takeId: track.id, setAt: nowIso() });
    }
    if (track.missingSegmentIds.length) ctx.emit({ type: "log", level: "warn", stage: "voice", message: `${lang}: ${track.missingSegmentIds.length} segment(s) missing from the take` });
    return { artifacts: [P.take(lang, track.id), P.activeTake(lang), ...track.segments.map((s) => s.file)] };
  },
};
