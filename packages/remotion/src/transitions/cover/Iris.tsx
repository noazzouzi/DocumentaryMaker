// Iris (M3): ≈ 12 f; a black iris closes on the frame centre before the cut and re-opens after it, with a thin ring.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverPhase } from "../../compute/covers";
import { rgba } from "../../lib/color";
import type { CoverProps } from "./common";

export const IrisCover: React.FC<CoverProps> = ({ w, k }) => {
  const ph = coverPhase(w, k);
  const open = Math.abs(ph); // 1 (open) → 0 (closed, cut) → 1
  const ease = open * open * (3 - 2 * open);
  const R = 1110; // half diagonal of 1920×1080
  const r = R * ease;
  if (r >= R - 1) return null;
  const color = w.color && w.color.toUpperCase() !== "#FFFFFF" ? w.color : "#000000";
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, transparent ${r.toFixed(1)}px, ${color} ${(r + 1.5).toFixed(1)}px)` }}>
      {r > 4 ? (
        <div style={{ position: "absolute", left: 960 - r, top: 540 - r, width: 2 * r, height: 2 * r, borderRadius: "50%", boxShadow: `0 0 0 3px ${rgba("#FFFFFF", 0.5 * (1 - ease))}` }} />
      ) : null}
    </AbsoluteFill>
  );
};
