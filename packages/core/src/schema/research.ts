import { z } from "zod";
import {
  ClaimId, EventId, FigureId, IsoDate, IsoDateTime, PersonId, QuoteId, SourceId, Unit, docVersion,
} from "./common";
import { ThemeOverride } from "./project";

export const SourceType = z.enum([
  "court_document", "official_statement", "regulatory_filing", "major_news", "trade_press",
  "primary_interview", "primary_social_post", "book", "wikipedia", "tabloid", "blog_or_forum", "other",
]);
export const ClaimStatus = z.enum([
  "established_fact", "judicial_finding_civil", "criminal_conviction", "acquitted", "charged_pending",
  "under_investigation", "civil_claim_pending", "settled_no_admission", "dismissed", "appeal_pending",
  "allegation", "denied_allegation", "disputed", "rumor_unverified", "retracted",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;
/** Statuses that may change over time: render/export require a recheck or an acknowledgement when asOf is > 30 days old. */
export const PENDING_STATUSES: readonly ClaimStatus[] = [
  "charged_pending", "under_investigation", "civil_claim_pending", "appeal_pending",
];
/** Statuses under which accusatory on-screen wording is allowed (deterministic fact-check rule f). */
export const ESTABLISHED_STATUSES: readonly ClaimStatus[] = ["established_fact", "criminal_conviction", "judicial_finding_civil"];
export const Reliability = z.enum(["high", "medium", "low"]);
export const Sensitivity = z.enum(["low", "medium", "high"]); // high = crime, sexual misconduct, abuse, health, minors, fraud
export const QuoteMedium = z.enum([
  "video_interview", "tv_news", "court_testimony", "podcast", "social_post", "print", "statement",
]);
export const TopicType = z.enum([
  "person_downfall", "company_collapse", "scandal_expose", "rise_story", "true_crime",
  "history", "explainer", "internet_drama", "conspiracy_debunk", "other",
]);
export type TopicType = z.infer<typeof TopicType>;
export const RiskFlag = z.enum([
  "real_person_allegations", "minors", "sexual_violence", "suicide_self_harm", "ongoing_trial",
  "health_speculation", "graphic_violence", "none",
]);
export type RiskFlag = z.infer<typeof RiskFlag>;

export const Source = z.object({
  id: SourceId,
  url: z.string().min(1), // ONLY URLs returned by web_search/web_fetch results (registry rule §6.3)
  title: z.string(),
  publisher: z.string(),
  publishedAt: z.string(), // ISO date or ""
  sourceType: SourceType,
  reliability: Reliability,
  language: z.string(), // BCP-47 of the source ("en", "fr", …) or ""
  fetched: z.boolean(),
  cited: z.number().int().nonnegative(),
  snippets: z.array(z.string()).max(5),
});
export type Source = z.infer<typeof Source>;

export const Person = z.object({
  id: PersonId,
  name: z.string(),
  roleInStory: z.string(),
  publicFigure: z.boolean(), // false → identity search, portraits and lower thirds need gate "person-ack"
  isMinorOrPrivateVictim: z.boolean(), // true → never named on screen, never searched, never shown
  imageQueries: z.array(z.string()),
  wikidataQid: z.string().regex(/^Q\d+$/).nullable(), // resolved IN CODE (wbsearchentities), never by the LLM or by vision
  aliases: z.array(z.string()), // Wikidata aliases + name tokens; feeds the AI-image denylist (§7.4)
});
export type Person = z.infer<typeof Person>;

export const TimelineEvent = z.object({
  id: EventId,
  date: z.string(), // YYYY | YYYY-MM | YYYY-MM-DD
  title: z.string(),
  whatHappened: z.string(),
  personIds: z.array(PersonId),
  status: ClaimStatus,
  sourceIds: z.array(SourceId),
  dramaValue: z.number().min(0).max(10),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const QuoteVerification = z.enum(["unchecked", "verbatim", "fuzzy", "not-found", "fetch-failed"]);
export type QuoteVerification = z.infer<typeof QuoteVerification>;
export const Quote = z.object({
  id: QuoteId,
  speakerId: PersonId,
  verbatim: z.string(), // exact words, original language, never paraphrased
  language: z.string(),
  date: z.string(),
  context: z.string(),
  medium: QuoteMedium,
  sourceId: SourceId,
  youtubeSearchQuery: z.string(), // "" if not on video
  verification: QuoteVerification,
  verifiedBy: z.enum(["none", "page", "video"]), // "video" = YouTube passage match ≥ 0.8 (§7.7)
});
export type Quote = z.infer<typeof Quote>;

export const Figure = z.object({
  id: FigureId,
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  asOf: z.string(),
  sourceIds: z.array(SourceId),
  chartable: z.boolean(),
});
export type Figure = z.infer<typeof Figure>;

export const Claim = z.object({
  id: ClaimId,
  summary: z.string(),
  madeBy: z.string(),
  against: z.string(),
  status: ClaimStatus,
  jurisdiction: z.string(), // "UK High Court", "Fairfax County VA jury", "" if none
  decisionDate: z.string(),
  subjectResponse: z.string(), // denial/statement of the accused, "" if none found
  asOf: z.string(), // date the status was last verified (defaults to FactSheet.asOf; refreshed by recheck)
  sensitivity: Sensitivity,
  sourceIds: z.array(SourceId),
});
export type Claim = z.infer<typeof Claim>;

const uniqueIds = (label: string) => (arr: { id: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const x of arr) {
    if (seen.has(x.id)) ctx.addIssue({ code: "custom", message: `duplicate ${label} id ${x.id}` });
    seen.add(x.id);
  }
};

export const FactSheet = z.object({
  schemaVersion: docVersion("factsheet"),
  topic: z.string(),
  asOf: IsoDate,
  oneLinePremise: z.string(),
  centralQuestion: z.string(),
  sources: z.array(Source).superRefine(uniqueIds("source")),
  people: z.array(Person).superRefine(uniqueIds("person")),
  timeline: z.array(TimelineEvent).superRefine(uniqueIds("event")),
  quotes: z.array(Quote).superRefine(uniqueIds("quote")),
  figures: z.array(Figure).superRefine(uniqueIds("figure")),
  claims: z.array(Claim).superRefine(uniqueIds("claim")),
  angles: z.array(z.string()),
  gaps: z.array(z.string()), // unverified: never asserted in the script
});
export type FactSheet = z.infer<typeof FactSheet>;

export const ResearchDossier = z.object({
  schemaVersion: docVersion("dossier"),
  topic: z.string(),
  asOf: IsoDate,
  searchLanguages: z.array(z.string()),
  markdown: z.string(), // citations rewritten to [S#]
  searchesUsed: z.number().int().nonnegative(),
  fetchesUsed: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(), // pause_turn continuations (each saved to research/raw/turn-<n>.json)
  rawFiles: z.array(z.string()),
  generatedBy: z.enum(["llm", "fixture"]),
});
export type ResearchDossier = z.infer<typeof ResearchDossier>;

export const RegistryEntry = z.object({
  id: SourceId,
  url: z.string(),
  title: z.string(),
  pageAge: z.string().nullable(),
  fetched: z.boolean(),
  cited: z.number().int().nonnegative(),
  snippets: z.array(z.string()).max(5),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;
export const RegistryDoc = z.object({ schemaVersion: docVersion("registry"), entries: z.array(RegistryEntry) });
export type RegistryDoc = z.infer<typeof RegistryDoc>;

export const VerificationItem = z.object({
  ref: z.string(),
  check: z.enum(["source-ref", "quote-verbatim", "url-reachable", "figure-source"]),
  ok: z.boolean(),
  detail: z.string(), // "skipped-offline" when offline/fixture (§6.3)
});
export const Verification = z.object({
  schemaVersion: docVersion("verification"),
  checkedAt: IsoDateTime,
  items: z.array(VerificationItem),
  invalidRefs: z.array(z.string()), // items whose sourceIds are not in the registry → moved to gaps
});
export type Verification = z.infer<typeof Verification>;

export const StyleSuggestion = z.object({
  schemaVersion: docVersion("styleSuggestion"),
  topicType: TopicType,
  ranked: z.array(z.object({ styleId: z.string(), score: Unit, why: z.string() })),
  recommendedStyleId: z.string(),
  recommendedMinutes: z.number(),
  titleOptions: z.array(z.string()),
  thumbnailTextOptions: z.array(z.string()),
  riskFlags: z.array(RiskFlag),
  themeOverride: ThemeOverride.nullable(),
  source: z.enum(["llm", "offline", "fixture"]),
  stage: z.enum(["idea", "research"]), // idea = cheap pre-research ranking at /new; research = refined
});
export type StyleSuggestion = z.infer<typeof StyleSuggestion>;

// ---- inferred types (one per schema constant)
export type SourceType = z.infer<typeof SourceType>;
export type Reliability = z.infer<typeof Reliability>;
export type Sensitivity = z.infer<typeof Sensitivity>;
export type QuoteMedium = z.infer<typeof QuoteMedium>;
export type VerificationItem = z.infer<typeof VerificationItem>;
