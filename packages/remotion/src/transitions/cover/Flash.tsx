// Flash cover (M1): peak·max(0, 1 − |f − c|/(d/2)), screen blend, colour from the transition (#FFFFFF by default).
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity } from "../../compute/covers";
import type { CoverProps } from "./common";

export const FlashCover: React.FC<CoverProps> = ({ w, d, k }) => {
  const o = coverIntensity(w, k, d);
  if (o <= 0.001) return null;
  return <AbsoluteFill style={{ backgroundColor: w.color || "#FFFFFF", opacity: Math.min(1, o), mixBlendMode: "screen" }} />;
};
