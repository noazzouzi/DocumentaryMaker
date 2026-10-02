// Paper rip (M3): 10–15 f; a paper sheet with a torn (seeded jagged) edge sweeps in, covers the frame on the cut, then
// tears away on the other side.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverPhase } from "../../compute/covers";
import { darken } from "../../lib/color";
import { rngOf } from "../../lib/random";
import { NoiseCanvas } from "../../media/NoiseCanvas";
import type { CoverProps } from "./common";

function tornEdge(seed: number, n: number): number[] {
  const r = rngOf(seed, "rip-edge");
  return Array.from({ length: n + 1 }, () => (r() - 0.5) * 0.06);
}

export const PaperRipCover: React.FC<CoverProps> = ({ w, k, seed }) => {
  const ph = coverPhase(w, k); // −1 … 0 (cut) … 1
  const edge = tornEdge(seed, 24);
  // sheet spans [a, b] along x (fraction of width): slides in from the right before the cut, leaves to the left after
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const a = ph < 0 ? 1.1 * ease(-ph) : -1.15 * ease(ph);
  const b = a + 1.15;
  if (b <= 0 || a >= 1) return null;
  const pts: string[] = [];
  edge.forEach((e, i) => pts.push(`${((a + e) * 100).toFixed(2)}% ${((i / 24) * 100).toFixed(2)}%`));
  const right = [...edge].reverse().map((e, i) => `${((b - e * 0.6) * 100).toFixed(2)}% ${(((24 - i) / 24) * 100).toFixed(2)}%`);
  const clip = `polygon(${[...pts, ...right].join(", ")})`;
  const paper = "#F1EEE6";
  return (
    <AbsoluteFill style={{ clipPath: clip, backgroundColor: paper, boxShadow: `0 0 40px ${darken(paper, 0.6)}` }}>
      <NoiseCanvas seed={seed} kind="paper" opacity={0.6} blend="multiply" />
    </AbsoluteFill>
  );
};
