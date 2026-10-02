import { z } from "zod";
import {
  ActId, AssetId, BeatId, ChapterId, Fps, Frame, Lang, Ms, PosFrames, SegmentId, Sha256, TakeId, WordId, docVersion,
} from "./common";

export const Pauses = z.object({
  headMs: Ms, // silence before the first word of the program
  segmentGapMs: Ms, // between consecutive narration segments
  deviceGapMs: Ms, // after a segment whose device is cliffhanger|reveal|rhetorical_question
  chapterGapMs: Ms, // minimum gap before each chapter except the first (chapter card / title sting breathe here)
  preRevealMs: Ms, // silence inserted before the chapter's REVEAL anchor word (VO split at a word boundary)
  clipLeadMs: Ms, // before a clip segment
  clipTailMs: Ms, // after a clip segment
  tailMs: Ms, // after the last word (outro music)
});
export type Pauses = z.infer<typeof Pauses>;

/** sponsor_slot segments produce NO layout segment (only a marker). */
export const LayoutSegmentMode = z.enum(["vo", "clip", "clip-narrated", "clip-card", "breath"]);
export type LayoutSegmentMode = z.infer<typeof LayoutSegmentMode>;

export const LayoutWord = z.object({
  id: WordId,
  segmentId: SegmentId,
  idx: z.number().int().nonnegative(),
  text: z.string(),
  norm: z.string(),
  from: Frame,
  dur: PosFrames, // end = max(from+1, min(msToFrame(endMs), nextWord.from))
  startMs: Ms, // absolute program time
  endMs: Ms,
});
export type LayoutWord = z.infer<typeof LayoutWord>;

export const LayoutSegment = z.object({
  segmentId: SegmentId,
  chapterId: ChapterId,
  mode: LayoutSegmentMode,
  from: Frame,
  dur: PosFrames,
  startMs: Ms, // frame-quantised: startMs = frameToMs(msToFrame(raw))
  endMs: Ms,
  voFile: z.string().nullable(), // segment wav (project-relative) for vo | clip-narrated
  voAssetId: z.string().nullable(), // sha256 of the segment wav
  clipAssetId: AssetId.nullable(),
  clipPassageInMs: Ms.nullable(), // clip: passage start inside the conformed clip file
  /** Silence inserted INSIDE the segment audio (REVEAL pre-pause): samples after splitAtMs move later by ms. ≤ 1 in v1. */
  insertions: z.array(z.object({ afterWordIdx: z.number().int().nonnegative(), splitAtMs: Ms, ms: Ms })),
  wordStart: z.number().int().nonnegative(), // index into ProgramLayout.words
  wordEnd: z.number().int().nonnegative(), // exclusive
});
export type LayoutSegment = z.infer<typeof LayoutSegment>;

/** Beats tile their CHAPTER: first beat starts at chapter.from, last ends at chapter end. */
export const LayoutBeat = z.object({
  beatId: BeatId,
  segmentId: SegmentId,
  chapterId: ChapterId,
  from: Frame,
  dur: PosFrames,
  onsetFrame: Frame, // first word onset (= from for clip/breath/first-of-chapter beats without words)
  wordStart: z.number().int().nonnegative(),
  wordEnd: z.number().int().nonnegative(),
});
export type LayoutBeat = z.infer<typeof LayoutBeat>;

export const ProgramLayout = z.object({
  schemaVersion: docVersion("layout"),
  lang: Lang,
  fps: Fps,
  takeId: TakeId,
  takeKind: z.enum(["scratch", "final"]),
  scriptHash: Sha256,
  plansHash: Sha256,
  slicesHash: Sha256,
  onlyChapters: z.array(ChapterId).nullable(),
  pauses: Pauses,
  durationInFrames: PosFrames,
  durationMs: Ms,
  chapters: z.array(
    z.object({
      chapterId: ChapterId, title: z.string(), act: ActId, macroAct: z.enum(["setup", "confrontation", "resolution"]),
      from: Frame, dur: PosFrames, firstWordFrame: Frame.nullable(),
    }),
  ),
  segments: z.array(LayoutSegment),
  beats: z.array(LayoutBeat),
  words: z.array(LayoutWord),
  sponsorMarkers: z.array(z.object({ segmentId: SegmentId, frame: Frame })),
  voProgram: z.object({
    assetId: AssetId, // program/<lang>/vo_program.wav, 48 kHz mono, normalised to -16 LUFS (gain BAKED IN)
    projectRel: z.string(),
    bakedGainDb: z.number(), // informational: gain baked into vo_program.wav; NLE VoClips apply it to segment files
    durationMs: Ms,
  }),
});
export type ProgramLayout = z.infer<typeof ProgramLayout>;
