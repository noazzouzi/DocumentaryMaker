// Typed readers for project documents (one place for paths + schemas).
import {
  ActiveTake, ApprovalsDoc, BeatPlansDoc, BeatSlicesDoc, ClipWordsDoc, DocmakerError, EntitiesDoc, FactCheck, FactSheet, FrozenDoc, Ledger,
  LoudnessDoc, MusicDoc, Outline, OverridesDoc, P, PicksDoc, ProgramLayout, Project, QaReport, RegistryDoc, RenderDoc, ResearchDossier,
  Script, StyleSuggestion, Timeline, TimelineLintDoc, UsageDoc, UserPicksDoc, VoiceTrack, type Lang, type PublishInfo,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";

export const docs = {
  project: (s: ProjectStore) => s.readJson(P.project, Project),
  approvals: async (s: ProjectStore) => (await s.readJsonOrNull(P.approvals, ApprovalsDoc)) ?? { schemaVersion: 1 as const, approvals: [] },
  dossier: (s: ProjectStore) => s.readJsonOrNull(P.dossier, ResearchDossier),
  registry: (s: ProjectStore) => s.readJsonOrNull(P.registry, RegistryDoc),
  factsheet: (s: ProjectStore) => s.readJsonOrNull(P.factsheet, FactSheet),
  entities: (s: ProjectStore) => s.readJsonOrNull(P.entities, EntitiesDoc),
  suggestion: (s: ProjectStore) => s.readJsonOrNull(P.styleSuggestion, StyleSuggestion),
  outline: (s: ProjectStore) => s.readJsonOrNull(P.outline, Outline),
  script: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.script(lang), Script),
  factcheck: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.factcheck(lang), FactCheck),
  plans: (s: ProjectStore) => s.readJsonOrNull(P.beatPlans, BeatPlansDoc),
  slices: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.beatSlices(lang), BeatSlicesDoc),
  userPicks: (s: ProjectStore) => s.readJsonOrNull(P.userPicks, UserPicksDoc),
  picks: (s: ProjectStore) => s.readJsonOrNull(P.picks, PicksDoc),
  frozen: (s: ProjectStore) => s.readJsonOrNull(P.frozen, FrozenDoc),
  ledger: (s: ProjectStore) => s.readJsonOrNull(P.ledger, Ledger),
  music: (s: ProjectStore) => s.readJsonOrNull(P.music, MusicDoc),
  clipWords: (s: ProjectStore, segmentId: string) => s.readJsonOrNull(P.clipWords(segmentId), ClipWordsDoc),
  activeTake: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.activeTake(lang), ActiveTake),
  take: (s: ProjectStore, lang: Lang, takeId: string) => s.readJsonOrNull(P.take(lang, takeId), VoiceTrack),
  layout: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.layout(lang), ProgramLayout),
  timeline: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.timeline(lang), Timeline),
  overrides: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.overrides(lang), OverridesDoc),
  timelineLint: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.timelineLint(lang), TimelineLintDoc),
  usage: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.usage(lang), UsageDoc),
  loudness: (s: ProjectStore, lang: Lang) => s.readJsonOrNull(P.loudness(lang), LoudnessDoc),
  renderDoc: (s: ProjectStore, lang: Lang, preset: string) => s.readJsonOrNull(P.renderDoc(lang, preset), RenderDoc),
  qa: (s: ProjectStore, lang: Lang, preset: string) => s.readJsonOrNull(P.qaReport(lang, preset), QaReport),
};

/** Throws UPSTREAM_MISSING with a hint naming the stage that produces the document. */
export function need<T>(v: T | null | undefined, what: string, producer: string): T {
  if (v === null || v === undefined) {
    throw new DocmakerError("UPSTREAM_MISSING", `${what} is missing`, { hint: `run the ${producer} stage first (docmaker run <slug> --to ${producer})` });
  }
  return v;
}

/** The active take of a language (null when none). */
export async function activeTakeOf(s: ProjectStore, lang: Lang): Promise<VoiceTrack | null> {
  const a = await docs.activeTake(s, lang);
  if (!a) return null;
  return docs.take(s, lang, a.takeId);
}

/**
 * Title / thumbnail / description the fact-check covers for a language: the user's publish info, else the script title and
 * the style suggestion's first thumbnail text (so the fact-check always covers what will be published, rule e).
 */
export function effectivePublish(project: Project, lang: Lang, script: Script | null, suggestion: StyleSuggestion | null): PublishInfo {
  const p = project.publish[lang];
  return {
    title: (p?.title ?? script?.title ?? project.title).slice(0, 100),
    thumbnailText: (p?.thumbnailText ?? suggestion?.thumbnailTextOptions[0] ?? "").slice(0, 40),
    description: p?.description ?? "",
  };
}
