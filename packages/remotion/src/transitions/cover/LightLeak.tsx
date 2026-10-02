// Light leak (M2): 15–30 f of warm radial gradients drifting across the frame, screen blend, intensity sin(πp).
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { hash01 } from "../../lib/random";
import type { CoverProps } from "./common";

export const LightLeakCover: React.FC<CoverProps> = ({ w, d, k, seed }) => {
  const inten = coverIntensity(w, k, d);
  if (inten <= 0.005) return null;
  const p = Math.max(0, Math.min(1, (k + 0.5) / d));
  const dir = w.direction === "right" ? -1 : 1;
  const x0 = 20 + 60 * hash01(seed, "ll-x0");
  const y0 = 25 + 40 * hash01(seed, "ll-y0");
  const cx = x0 + dir * (p - 0.5) * 50;
  const cy = y0 + (p - 0.5) * 12;
  const g = [
    `radial-gradient(ellipse 55% 75% at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ${rgba("#FFB45A", 0.95)} 0%, ${rgba("#FF6A2B", 0.55)} 35%, transparent 70%)`,
    `radial-gradient(ellipse 40% 60% at ${(cx + dir * 28).toFixed(1)}% ${(cy + 22).toFixed(1)}%, ${rgba("#FF3B30", 0.6)} 0%, transparent 65%)`,
    `radial-gradient(ellipse 30% 45% at ${(cx - dir * 22).toFixed(1)}% ${(cy - 10).toFixed(1)}%, ${rgba("#FFE7A8", 0.8)} 0%, transparent 60%)`,
  ].join(", ");
  return <AbsoluteFill style={{ background: g, mixBlendMode: "screen", opacity: Math.min(1, inten) }} />;
};
