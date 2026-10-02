// Glitch cover (M1): 4–8 f of seeded noise bars (colour-split slivers, black drop-outs, white sparks) on top of the
// derived fx `glitch` (slice displacement) + `rgb` (chromatic split) that computeTimeline adds for the same window.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { rngOf } from "../../lib/random";
import type { CoverProps } from "./common";

const COLORS = ["#FFFFFF", "#00F0FF", "#FF2BD6", "#000000", "#FFD400"];

export const GlitchCover: React.FC<CoverProps> = ({ w, d, k, seed }) => {
  const inten = Math.max(0, Math.min(1, coverIntensity(w, k, d))) * Math.max(0.4, w.peak);
  if (inten <= 0.01) return null;
  const r = rngOf(seed, `glitch-bars:${k}`);
  const n = 7 + Math.floor(r() * 8);
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const y = r() * 1080;
    const h = 3 + Math.pow(r(), 2) * 70;
    const x = (r() - 0.3) * 1920;
    const wpx = 200 + r() * 1500;
    const color = COLORS[Math.floor(r() * COLORS.length)]!;
    const op = (0.25 + 0.6 * r()) * inten;
    bars.push(
      <div key={i} style={{ position: "absolute", left: x, top: y, width: wpx, height: h, backgroundColor: rgba(color, op), mixBlendMode: color === "#000000" ? "normal" : "screen" }} />,
    );
  }
  // fine scanline noise across the frame
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(0deg, ${rgba("#FFFFFF", 0.07 * inten)} 0px, ${rgba("#FFFFFF", 0.07 * inten)} 1px, transparent 1px, transparent 3px)` }} />
      {bars}
    </AbsoluteFill>
  );
};
