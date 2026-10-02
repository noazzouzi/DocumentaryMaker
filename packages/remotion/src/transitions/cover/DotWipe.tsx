// Dot wipe (M3): an 80 px grid of dots that grow to cover the frame before the cut (staggered along the direction)
// and shrink away after it. ~13 f.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverPhase } from "../../compute/covers";
import { clamp01 } from "../../lib/easing";
import type { CoverProps } from "./common";

const GRID = 80;
const R_FULL = (GRID * Math.SQRT2) / 2 + 1;

export const DotWipeCover: React.FC<CoverProps> = ({ w, k }) => {
  const ph = coverPhase(w, k);
  const cover = 1 - Math.abs(ph); // 0 → 1 (cut) → 0
  if (cover <= 0.001) return null;
  const color = w.color || "#000000";
  const cols = Math.ceil(1920 / GRID);
  const rows = Math.ceil(1080 / GRID);
  const horizontal = w.direction === "left" || w.direction === "right";
  const flip = w.direction === "left" || w.direction === "up";
  const dots: React.ReactNode[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const along = horizontal ? i / (cols - 1) : j / (rows - 1);
      const pos = flip ? 1 - along : along;
      // stagger: leading edge fills first on the way in, empties first on the way out
      const local = clamp01(cover * 1.6 - (ph < 0 ? pos : 1 - pos) * 0.6);
      const rad = R_FULL * local;
      if (rad < 0.5) continue;
      dots.push(
        <div key={`${i}-${j}`} style={{ position: "absolute", left: i * GRID + GRID / 2 - rad, top: j * GRID + GRID / 2 - rad, width: rad * 2, height: rad * 2, borderRadius: "50%", backgroundColor: color }} />,
      );
    }
  }
  return <AbsoluteFill style={{ overflow: "hidden" }}>{dots}</AbsoluteFill>;
};
