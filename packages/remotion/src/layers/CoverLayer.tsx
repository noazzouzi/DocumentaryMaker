// CoverLayer (§10.5 class 2): every cover window as a Sequence centred on its cut; presentations not implemented are
// already mapped by computeTimeline (DEFERRED_TRANSITIONS chain).
import type React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import type { CoverWindow } from "../compute/types";
import { useDocState, useEnv } from "../data/env";
import { seedOf } from "../lib/random";
import type { CoverProps } from "../transitions/cover/common";
import { DipCover } from "../transitions/cover/Dip";
import { DotWipeCover } from "../transitions/cover/DotWipe";
import { FilmBurnCover } from "../transitions/cover/FilmBurn";
import { FlashCover } from "../transitions/cover/Flash";
import { GlitchCover } from "../transitions/cover/Glitch";
import { IrisCover } from "../transitions/cover/Iris";
import { LightLeakCover } from "../transitions/cover/LightLeak";
import { PaperRipCover } from "../transitions/cover/PaperRip";
import { WhipStreaksCover } from "../transitions/cover/WhipStreaks";

export const COVER_COMPONENTS: Record<string, React.FC<CoverProps>> = {
  flash: FlashCover, dipToBlack: DipCover, dipToWhite: DipCover, glitch: GlitchCover, lightLeak: LightLeakCover,
  filmBurn: FilmBurnCover, whipStreaks: WhipStreaksCover, paperRip: PaperRipCover, dotWipe: DotWipeCover, iris: IrisCover,
};

const CoverItem: React.FC<{ w: CoverWindow; d: number }> = ({ w, d }) => {
  const k = useCurrentFrame();
  const C = COVER_COMPONENTS[w.presentation] ?? FlashCover;
  const rel: CoverWindow = { ...w, from: 0, cut: w.cut - w.from };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <C w={rel} d={d} k={k} seed={seedOf(w.clipId)} />
    </AbsoluteFill>
  );
};

export const CoverLayer: React.FC<{ covers: readonly CoverWindow[] }> = ({ covers }) => {
  const doc = useDocState();
  const env = useEnv();
  const nominal = (w: CoverWindow): number => {
    const clip = doc?.parts.find((c) => c.id === w.clipId);
    return clip && clip.transitionIn.kind === "cover" ? Math.max(2, clip.transitionIn.durationFrames) : w.dur;
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {covers.map((w) => (
        <Sequence key={w.id} from={w.from} durationInFrames={w.dur} premountFor={env.fps} name={w.id}>
          <CoverItem w={w} d={nominal(w)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
