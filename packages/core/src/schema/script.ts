import { z } from "zod";
import {
  ChapterId, FactCheckId, FactRef, IsoDateTime, Lang, LintIssue, Ms, QuoteId, SegmentId, Sha256, docVersion,
} from "./common";

export const SegmentType = z.enum(["narration", "clip", "sponsor_slot", "music_breath"]);
export type SegmentType = z.infer<typeof SegmentType>;
export const Device = z.enum([
  "none", "open_loop", "re_hook", "pattern_interrupt", "callback", "cliffhanger",
  "punchline", "rhetorical_question", "reveal", "payoff",
]);
export type Device = z.infer<typeof Device>;

export const ScriptSegment = z.object({
  id: SegmentId, // the chapter is the id prefix (chapterOfSegment); no redundant chapterId field
  type: SegmentType,
  displayText: z.string(), // shown + captioned. clip: the verbatim quote (original language). "" for sponsor/breath
  ttsText: z.string(), // spoken text; filled by the ENGINE via voice.buildTtsText unless ttsTextEdited. "" for sponsor/breath/clip
  ttsTextEdited: z.boolean(),
  quoteId: QuoteId.nullable(),
  subtitleTranslation: z.string(), // clip whose quote language ≠ script language: natural translation; else ""
  factIds: z.array(FactRef),
  device: Device,
  breathMs: Ms, // music_breath duration (default 2000), else 0
  /** Secondary languages only: hashJson(primary segment displayText) at transcreation time; mismatch → "out of sync". */
  primaryHash: Sha256.nullable(),
});
export type ScriptSegment = z.infer<typeof ScriptSegment>;

export const ChapterScript = z.object({
  chapterId: ChapterId,
  title: z.string(), // chapter card title in THIS language
  segments: z.array(ScriptSegment),
  loopsOpened: z.array(z.string()),
  loopsClosed: z.array(z.string()),
  summaryForNext: z.string(),
  userEdited: z.boolean(), // set by writeDoc when a user PUT changed this chapter
  locked: z.boolean(), // user toggle; regeneration of userEdited|locked chapters needs forceOverwriteEdits
});
export type ChapterScript = z.infer<typeof ChapterScript>;

/** script/<lang>/script.json is the ONLY source of truth for a language's script. */
export const Script = z
  .object({
    schemaVersion: docVersion("script"),
    lang: Lang,
    outlineHash: Sha256, // docHash(outline) the chapters were written from
    title: z.string(), // video title in this language
    chapters: z.array(ChapterScript),
    lint: z.array(LintIssue),
    generatedBy: z.enum(["llm", "fixture", "user"]),
    updatedAt: IsoDateTime,
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const ch of s.chapters) {
      if (seen.has(ch.chapterId)) ctx.addIssue({ code: "custom", message: `duplicate chapter ${ch.chapterId}` });
      seen.add(ch.chapterId);
      for (const seg of ch.segments) {
        if (seen.has(seg.id)) ctx.addIssue({ code: "custom", message: `duplicate segment ${seg.id}` });
        seen.add(seg.id);
        if (!seg.id.startsWith(ch.chapterId + "-")) {
          ctx.addIssue({ code: "custom", message: `segment ${seg.id} is not in chapter ${ch.chapterId}` });
        }
      }
    }
  });
export type Script = z.infer<typeof Script>;

// ---- fact-check (per language): narration + on-screen text + title/thumbnail/description
export const FactCheckVerdict = z.enum([
  "supported", "partially_supported", "unsupported", "contradicted", "needs_attribution",
  "status_missing_or_outdated", "opinion_ok", "opinion_presented_as_fact", "quote_mismatch",
  "unverified_quote", "private_person_named",
]);
export const FactCheckSurface = z.enum(["narration", "clip-quote", "on-screen", "title", "thumbnail", "description"]);
export const FactCheckItem = z.object({
  id: FactCheckId, // stable across re-runs (resolution and note carry over when the id matches)
  where: z.string(), // segment id | beat id | "title" | "thumbnail" | "description"
  surface: FactCheckSurface,
  sentence: z.string(),
  claimKind: z.enum(["fact", "allegation", "judicial_finding", "opinion", "quote", "number", "speculation"]),
  verdict: FactCheckVerdict,
  risk: z.enum(["none", "low", "medium", "high"]),
  factIds: z.array(z.string()),
  problem: z.string(),
  suggestedRewrite: z.string(),
  origin: z.enum(["llm", "deterministic"]),
  rule: z.string().nullable(), // deterministic rule id ("a".."g") or null
  /** quote_mismatch (deterministic) can never be acknowledged or dismissed — only fixed. */
  resolution: z.enum(["open", "rewritten", "acknowledged", "dismissed"]),
  note: z.string(), // required (≥ 10 chars) for acknowledged/dismissed high items
});
export type FactCheckItem = z.infer<typeof FactCheckItem>;
export const FactCheck = z.object({
  schemaVersion: docVersion("factcheck"),
  lang: Lang,
  scriptHash: Sha256, // docHash(script/<lang>/script.json) checked
  slicesHash: Sha256, // docHash(beats/<lang>.json) checked (on-screen text)
  publishHash: Sha256, // hashJson(project.publish[lang] ?? null)
  items: z.array(FactCheckItem),
  needsMoreResearch: z.array(z.string()),
  titleThumbnailIssues: z.array(z.string()),
  createdAt: IsoDateTime,
});
export type FactCheck = z.infer<typeof FactCheck>;

// ---- inferred types (one per schema constant)
export type FactCheckVerdict = z.infer<typeof FactCheckVerdict>;
export type FactCheckSurface = z.infer<typeof FactCheckSurface>;
