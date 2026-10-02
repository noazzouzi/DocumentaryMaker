// P0 PLACEHOLDER Documentary (W7 replaces it): paints palette.ink, the current chapter title and a frame counter
// from a Timeline, so W8 can bundle and render from day one. Deterministic: a pure function of the frame.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { DocProps } from "./index";
import { useTimeline } from "./data/useTimeline";

export const Documentary: React.FC<DocProps> = (props) => {
  const t = useTimeline(props);
  const frame = useCurrentFrame();
  if (!t) return <AbsoluteFill style={{ backgroundColor: "#0B0B0D" }} />;
  const tokens = t.render.tokens;
  const chapter = t.chapters.find((c) => frame >= c.from && frame < c.from + c.dur) ?? t.chapters[0];
  const index = chapter ? t.chapters.indexOf(chapter) + 1 : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: tokens.palette.ink, color: tokens.palette.text, alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: `"${tokens.fonts.body}", sans-serif`, fontSize: 36, letterSpacing: "0.2em", color: tokens.palette.accent }}>
        {chapter ? `CHAPTER ${index} · ${chapter.id}` : t.title}
      </div>
      <div style={{ fontFamily: `"${tokens.fonts.headline}", sans-serif`, fontSize: 120, lineHeight: 1.1, textAlign: "center", padding: "0 120px" }}>
        {chapter?.title ?? t.title}
      </div>
      <div style={{ position: "absolute", right: 48, bottom: 36, fontFamily: `"${tokens.fonts.mono}", monospace`, fontSize: 40, color: tokens.palette.muted }}>
        {`${frame} / ${t.durationInFrames}`}
      </div>
      {props.scratchBanner && t.takeKind === "scratch" ? (
        <div style={{ position: "absolute", left: 48, top: 36, fontFamily: `"${tokens.fonts.mono}", monospace`, fontSize: 28, color: tokens.palette.danger }}>SCRATCH VO</div>
      ) : null}
    </AbsoluteFill>
  );
};
