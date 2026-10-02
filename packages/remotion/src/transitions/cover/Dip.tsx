// Dip to black / white (M1): out ≈ 0.4·d, hold ≈ 0.2·d, in = rest; the A→B switch happens mid-hold, so the cut is
// never visible.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity } from "../../compute/covers";
import type { CoverProps } from "./common";

export const DipCover: React.FC<CoverProps> = ({ w, d, k }) => {
  const o = coverIntensity(w, k, d);
  if (o <= 0.001) return null;
  const fallback = w.presentation === "dipToWhite" ? "#FFFFFF" : "#000000";
  const color = w.presentation === "dipToWhite" ? (w.color && w.color.toUpperCase() !== "#000000" ? w.color : fallback) : (w.color && w.color.toUpperCase() !== "#FFFFFF" ? w.color : fallback);
  return <AbsoluteFill style={{ backgroundColor: color, opacity: Math.min(1, o) }} />;
};
