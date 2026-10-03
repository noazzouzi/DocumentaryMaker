// Iris (M3): ≈ 12 f; an iris in the transition colour (black unless a dark colour is given) closes on the frame centre,
// is fully closed on the two frames around the cut, then re-opens; a thin light ring rides its edge.
// Geometry: compute/covers.ts irisRadius/coverAmount.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverAmount, irisRadius } from "../../compute/covers";
import { luminance, rgba } from "../../lib/color";
import type { CoverProps } from "./common";

export const IrisCover: React.FC<CoverProps> = ({ w, k }) => {
  const amount = coverAmount(w, k);
  if (amount <= 0.001) return null;
  const r = irisRadius(amount);
  const color = w.color && luminance(w.color) < 0.5 ? w.color : "#000000";
  if (r < 0.5) return <AbsoluteFill style={{ backgroundColor: color }} />;
  const ring = 0.55 * Math.sin(Math.PI * Math.min(1, amount));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, transparent ${r.toFixed(1)}px, ${color} ${(r + 1.5).toFixed(1)}px)` }}>
      {ring > 0.02 ? (
        <div style={{ position: "absolute", left: 960 - r, top: 540 - r, width: 2 * r, height: 2 * r, borderRadius: "50%", boxShadow: `0 0 0 3px ${rgba("#FFFFFF", ring)}, 0 0 18px 4px ${rgba("#FFFFFF", ring * 0.35)}` }} />
      ) : null}
    </AbsoluteFill>
  );
};
