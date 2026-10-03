// Dot wipe (M3): an 80 px grid of dots in the transition colour that grow (staggered along the direction) until they
// cover the frame on the two frames around the cut, then shrink away with the wave continuing in the same direction.
// ≈ 13 f. Geometry: compute/covers.ts dotRadius/dotPos/coverAmount.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverAmount, DOT_GRID_PX, dotPos, dotRadius } from "../../compute/covers";
import type { CoverProps } from "./common";

const W = 1920;
const H = 1080;

export const DotWipeCover: React.FC<CoverProps> = ({ w, k }) => {
  const amount = coverAmount(w, k);
  if (amount <= 0.001) return null;
  const closing = k < w.cut;
  const color = w.color || "#000000";
  const cols = Math.ceil(W / DOT_GRID_PX);
  const rows = Math.ceil(H / DOT_GRID_PX);
  const dots: React.ReactNode[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const rad = dotRadius(amount, dotPos(i, j, cols, rows, w.direction), closing);
      if (rad < 0.5) continue;
      const cx = i * DOT_GRID_PX + DOT_GRID_PX / 2;
      const cy = j * DOT_GRID_PX + DOT_GRID_PX / 2;
      dots.push(<div key={`${i}-${j}`} style={{ position: "absolute", left: cx - rad, top: cy - rad, width: rad * 2, height: rad * 2, borderRadius: "50%", backgroundColor: color }} />);
    }
  }
  return <AbsoluteFill style={{ overflow: "hidden" }}>{dots}</AbsoluteFill>;
};
