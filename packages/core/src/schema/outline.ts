import { z } from "zod";
import { ActId, ChapterId, ClaimId, EventId, IsoDateTime, Lang, QuoteId, docVersion } from "./common";

export const Budget = z.object({
  lang: Lang,
  minutes: z.number(),
  storyShape: z.string(),
  charsPerSec: z.number(),
  runtimeSec: z.number().int(),
  narrationSec: z.number().int(),
  chars: z.number().int(),
  words: z.number().int(),
  chapters: z.number().int().positive(),
  perAct: z.record(ActId, z.number().int().nonnegative()), // words per act
  beatsApprox: z.number().int(),
});
export type Budget = z.infer<typeof Budget>;

export const ChapterPlan = z.object({
  id: ChapterId,
  act: ActId,
  title: z.string(), // primary-language working title
  targetSec: z.number().positive(), // LANGUAGE-NEUTRAL length target (narration seconds)
  targetWords: z.number().int().positive(), // primary language only (= targetSec·cps/avgCharsPerWord)
  purpose: z.string(),
  eventIds: z.array(EventId),
  claimIds: z.array(ClaimId),
  quoteIds: z.array(QuoteId), // clips to play in this chapter
  opensLoops: z.array(z.string()),
  closesLoops: z.array(z.string()),
  exitHook: z.string(),
  adBreakAfter: z.boolean(),
});
export type ChapterPlan = z.infer<typeof ChapterPlan>;

export const Outline = z.object({
  schemaVersion: docVersion("outline"),
  lang: Lang, // authoring language (= project.primaryLang); other languages transcreate per chapter
  title: z.string(),
  thesis: z.string(),
  thesisConfirmed: z.boolean(), // the user edited or explicitly confirmed the thesis (outline-approval requires it)
  storyShape: z.string(),
  hookTeasers: z.array(z.object({ id: z.string(), teaser: z.string(), paidOffIn: ChapterId })),
  loops: z.array(
    z.object({ id: z.string().regex(/^L\d+$/), question: z.string(), openedIn: ChapterId, closedIn: ChapterId }),
  ),
  chapters: z.array(ChapterPlan).min(1),
  callbackPlan: z.array(z.string()),
  nextVideoBridge: z.string(),
  budget: Budget, // primary language
  budgets: z.partialRecord(Lang, Budget), // every project language (each with its own cps)
  generatedBy: z.enum(["llm", "fixture", "user"]),
  updatedAt: IsoDateTime,
});
export type Outline = z.infer<typeof Outline>;
