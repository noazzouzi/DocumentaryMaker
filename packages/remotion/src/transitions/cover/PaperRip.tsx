// Paper rip (M3): 10–15 f. A paper sheet with a torn (seeded jagged) leading edge slides in against the motion
// direction and covers the frame on the frames around the cut; after the cut it rips along a jagged middle line and the
// two halves pull apart (with a slight swing), revealing B. Torn edges show a white fibre rim and a soft drop shadow.
// Geometry: compute/covers.ts paperRipState; polygons are CSS clip-paths in motion coordinates (u along the motion,
// v across it).
import type React from "react";
import { AbsoluteFill } from "remotion";
import { PAPER_EDGE_JAG, PAPER_TEAR_JAG, paperRipState } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { rngOf } from "../../lib/random";
import { NoiseCanvas } from "../../media/NoiseCanvas";
import type { CoverProps } from "./common";

const N = 28; // edge vertices
const PAPER = "#EFE9DC";
const RIM = 0.007; // fibre rim width (motion units)

/** Seeded jagged edge: N+1 offsets in [−amp, amp], mixing a slow wobble with sharp tears. */
function jag(seed: number, key: string, amp: number): number[] {
  const r = rngOf(seed, key);
  const slow = [r(), r(), r(), r()].map((x) => (x - 0.5) * 2);
  return Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    const wobble = slow[0]! * Math.sin(Math.PI * (t * 1.3 + slow[1]!)) * 0.45 + slow[2]! * Math.sin(Math.PI * (t * 3.1 + slow[3]!)) * 0.25;
    const sharp = (r() - 0.5) * 0.6;
    return Math.max(-amp, Math.min(amp, amp * (wobble + sharp)));
  });
}

type UV = [number, number];
/** Motion coordinates → CSS percentages ("left": the sheet enters from the right and moves left). */
function toXY(direction: string, [u, v]: UV): [number, number] {
  switch (direction) {
    case "right":
      return [1 - u, v];
    case "up":
      return [v, u];
    case "down":
      return [v, 1 - u];
    default:
      return [u, v];
  }
}
function clip(direction: string, pts: UV[]): string {
  return `polygon(${pts.map((p) => toXY(direction, p)).map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(", ")})`;
}
const vAt = (i: number) => -0.02 + (1.04 * i) / N;

interface Swing { deg: number; origin: string }

/** One paper piece: shadow, fibre rim and the textured sheet, all clipped to the same outline. */
const Piece: React.FC<{ direction: string; outline: UV[]; rim: UV[]; seed: number; swing: Swing | null }> = ({ direction, outline, rim, seed, swing }) => (
  <AbsoluteFill style={swing ? { transform: `rotate(${swing.deg.toFixed(3)}deg)`, transformOrigin: swing.origin } : undefined}>
    <AbsoluteFill style={{ clipPath: clip(direction, outline), backgroundColor: rgba("#000000", 0.32), transform: "translate(8px, 12px)" }} />
    <AbsoluteFill style={{ clipPath: clip(direction, rim), backgroundColor: "#FFFFFF" }} />
    <AbsoluteFill style={{ clipPath: clip(direction, outline), backgroundColor: PAPER }}>
      <NoiseCanvas seed={seed} kind="paper" opacity={0.55} blend="multiply" />
    </AbsoluteFill>
  </AbsoluteFill>
);

export const PaperRipCover: React.FC<CoverProps> = ({ w, k, seed }) => {
  const st = paperRipState(w, k);
  if (!st) return null;
  const dir = w.direction;
  const rimR = rngOf(seed, "rip-rim");
  const rimW = Array.from({ length: N + 1 }, () => RIM * (0.4 + 1.2 * rimR()));
  const far: UV[] = [[1.3, 1.02], [1.3, -0.02]];
  if (st.phase === "in") {
    if (st.lead >= 1 + PAPER_EDGE_JAG) return null;
    const edge = jag(seed, "rip-lead", PAPER_EDGE_JAG);
    const lead: UV[] = edge.map((e, i) => [st.lead + e, vAt(i)]);
    const rim: UV[] = edge.map((e, i) => [st.lead + e - rimW[i]!, vAt(i)]);
    return <Piece direction={dir} outline={[...lead, ...far]} rim={[...rim, ...far]} seed={seed} swing={null} />;
  }
  // out: the sheet rips along u ≈ 0.5; the near half (u < tear) leaves along the motion, the far half against it,
  // each swinging slightly about its outer edge (small angles: the torn edge moves across the motion, never back in)
  const tear = jag(seed, "rip-tear", PAPER_TEAR_JAG);
  const o = st.open;
  const at = (u: number, i: number): UV => [u, vAt(i)];
  const nearEdge = tear.map((e, i) => at(0.5 + e - o, i));
  const nearRim = tear.map((e, i) => at(0.5 + e - o + rimW[i]!, i));
  const nearOuter: UV[] = [[-0.3 - o, 1.02], [-0.3 - o, -0.02]];
  const farEdge = tear.map((e, i) => at(0.5 + e + o, i));
  const farRim = tear.map((e, i) => at(0.5 + e + o - rimW[N - i]!, i));
  const farOuter: UV[] = [[1.3 + o, 1.02], [1.3 + o, -0.02]];
  const swing = (sign: number, originU: number): Swing | null => {
    if (st.rotDeg <= 0.01) return null;
    const [x, y] = toXY(dir, [originU, 0.5]);
    return { deg: sign * st.rotDeg, origin: `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%` };
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Piece direction={dir} outline={[...nearEdge, ...nearOuter]} rim={[...nearRim, ...nearOuter]} seed={seed} swing={swing(-1, -o)} />
      <Piece direction={dir} outline={[...farEdge, ...farOuter]} rim={[...farRim, ...farOuter]} seed={(seed ^ 0x5bd1e995) >>> 0} swing={swing(1, 1 + o)} />
    </AbsoluteFill>
  );
};
