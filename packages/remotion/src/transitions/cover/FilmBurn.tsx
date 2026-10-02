// Film burn (M3): 15–30 f orange→white radial bloom with a static noise mask (colour-dodge), peaking on the cut.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { hash01 } from "../../lib/random";
import { NoiseCanvas } from "../../media/NoiseCanvas";
import type { CoverProps } from "./common";

export const FilmBurnCover: React.FC<CoverProps> = ({ w, d, k, seed }) => {
  const inten = coverIntensity(w, k, d);
  if (inten <= 0.005) return null;
  const cx = 15 + 70 * hash01(seed, "fb-x");
  const cy = 20 + 60 * hash01(seed, "fb-y");
  const r = 30 + 90 * inten;
  const bg = `radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ${rgba("#FFFFFF", inten)} 0%, ${rgba("#FFD27A", 0.95 * inten)} ${(r * 0.35).toFixed(1)}%, ${rgba("#FF6A00", 0.85 * inten)} ${(r * 0.7).toFixed(1)}%, ${rgba("#7A1500", 0.4 * inten)} ${r.toFixed(1)}%, transparent ${(r + 25).toFixed(1)}%)`;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      <AbsoluteFill style={{ background: bg }} />
      <NoiseCanvas seed={seed} kind="grain" opacity={0.35 * inten} blend="color-dodge" />
    </AbsoluteFill>
  );
};
