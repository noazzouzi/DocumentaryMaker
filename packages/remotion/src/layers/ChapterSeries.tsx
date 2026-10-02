// ChapterSeries — the picture track of one chapter as a data-driven <TransitionSeries> (port of $SP/rtest/src/Doc.tsx).
// Sequences carry the overlap handles computed by computeTimeline, so every transition is centred on its cut and the
// series total equals the chapter duration.
import type React from "react";
import { Sequence } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { ComputedChapter, ComputedTimeline } from "../compute/types";
import { overlapPresentation } from "../transitions/overlap";
import { VisualClipView } from "./VisualClipView";

export const ChapterSeries: React.FC<{ chapter: ComputedChapter; ct: ComputedTimeline }> = ({ chapter, ct }) => {
  const premount = ct.fps;
  return (
    <Sequence from={chapter.from} durationInFrames={chapter.dur} premountFor={premount} name={`chapter ${chapter.id}`}>
      <TransitionSeries>
        {chapter.series.map((item) =>
          item.type === "seq" ? (
            <TransitionSeries.Sequence key={`s:${item.clip.id}`} durationInFrames={item.durationInFrames} premountFor={premount} name={item.clip.name || item.clip.id}>
              <VisualClipView seq={item} exit={ct.exits[item.clip.id] ?? null} entry={ct.entries[item.clip.id] ?? null} />
            </TransitionSeries.Sequence>
          ) : (
            <TransitionSeries.Transition key={`t:${item.clipId}`} presentation={overlapPresentation(item)} timing={linearTiming({ durationInFrames: item.durationInFrames })} />
          ),
        )}
      </TransitionSeries>
    </Sequence>
  );
};

/** The whole picture track: one Sequence + TransitionSeries per chapter. */
export const PictureTrack: React.FC<{ ct: ComputedTimeline }> = ({ ct }) => (
  <>
    {ct.chapters.map((ch) => (
      <ChapterSeries key={ch.id} chapter={ch} ct={ct} />
    ))}
  </>
);
