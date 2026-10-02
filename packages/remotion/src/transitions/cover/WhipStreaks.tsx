// Whip streaks (M3): ≈ 8 f, 15 blurred light bars racing across the frame in the transition direction.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { rngOf } from "../../lib/random";
import type { CoverProps } from "./common";

export const WhipStreaksCover: React.FC<CoverProps> = ({ w, d, k, seed }) => {
  const inten = Math.max(0, coverIntensity(w, k, d));
  if (inten <= 0.01) return null;
  const horizontal = w.direction === "left" || w.direction === "right";
  const sign = w.direction === "left" || w.direction === "up" ? -1 : 1;
  const p = (k + 0.5) / Math.max(1, d);
  const r = rngOf(seed, "streaks");
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < 15; i++) {
    const lane = r();
    const thick = 6 + r() * 46;
    const len = 0.4 + r() * 0.8;
    const speed = 1.4 + r() * 1.2;
    const offset = r();
    const pos = ((offset + sign * speed * p) % 1.6 + 1.6) % 1.6 - 0.3; // wraps, −0.3 … 1.3
    const color = r() < 0.25 ? "#FFD400" : "#FFFFFF";
    const style: React.CSSProperties = horizontal
      ? { left: `${(pos * 100).toFixed(2)}%`, top: `${(lane * 100).toFixed(2)}%`, width: `${(len * 60).toFixed(1)}%`, height: thick }
      : { top: `${(pos * 100).toFixed(2)}%`, left: `${(lane * 100).toFixed(2)}%`, height: `${(len * 60).toFixed(1)}%`, width: thick };
    bars.push(<div key={i} style={{ position: "absolute", ...style, backgroundColor: rgba(color, 0.55 * inten), filter: "blur(8px)", borderRadius: thick }} />);
  }
  return <AbsoluteFill style={{ mixBlendMode: "screen", overflow: "hidden" }}>{bars}</AbsoluteFill>;
};
