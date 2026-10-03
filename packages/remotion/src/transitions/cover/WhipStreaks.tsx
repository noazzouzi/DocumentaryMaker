// Whip streaks (M3): ≈ 8 f. 15 blurred light bars race across the frame in the transition direction, over a
// motion-smear wash (seeded streak bands across the motion axis) that peaks on the two frames around the cut, so the
// switch reads as one fast pan. Wash: compute/covers.ts whipWash.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity, whipWash } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { rngOf } from "../../lib/random";
import type { CoverProps } from "./common";

/** Seeded streak bands (CSS stops) perpendicular to the motion: the frame smeared along it. */
function smear(seed: number, alpha: number, horizontal: boolean): string {
  const r = rngOf(seed, "smear");
  const stops: string[] = [];
  let pos = 0;
  while (pos < 100) {
    const h = 0.6 + r() * 4.5;
    const a = alpha * (0.45 + 0.55 * r());
    const c = r() < 0.15 ? "#FFE680" : r() < 0.5 ? "#FFFFFF" : "#DCE6F0";
    stops.push(`${rgba(c, a)} ${pos.toFixed(2)}%`, `${rgba(c, a)} ${Math.min(100, pos + h).toFixed(2)}%`);
    pos += h;
  }
  return `linear-gradient(${horizontal ? "180deg" : "90deg"}, ${stops.join(", ")})`;
}

export const WhipStreaksCover: React.FC<CoverProps> = ({ w, d, k, seed }) => {
  const inten = Math.max(0, coverIntensity(w, k, d));
  const wash = whipWash(w, k);
  if (inten <= 0.01 && wash <= 0.01) return null;
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
    const pos = (((offset + sign * speed * p) % 1.6) + 1.6) % 1.6 - 0.3; // wraps, −0.3 … 1.3
    const color = r() < 0.25 ? "#FFD400" : "#FFFFFF";
    const style: React.CSSProperties = horizontal
      ? { left: `${(pos * 100).toFixed(2)}%`, top: `${(lane * 100).toFixed(2)}%`, width: `${(len * 60).toFixed(1)}%`, height: thick }
      : { top: `${(pos * 100).toFixed(2)}%`, left: `${(lane * 100).toFixed(2)}%`, height: `${(len * 60).toFixed(1)}%`, width: thick };
    bars.push(<div key={i} style={{ position: "absolute", ...style, backgroundColor: rgba(color, 0.55 + 0.35 * inten), filter: "blur(8px)", borderRadius: thick, opacity: Math.min(1, inten + wash) }} />);
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {wash > 0.01 ? <AbsoluteFill style={{ background: smear(seed, 0.92, horizontal), opacity: wash }} /> : null}
      <AbsoluteFill style={{ mixBlendMode: "screen" }}>{bars}</AbsoluteFill>
    </AbsoluteFill>
  );
};
