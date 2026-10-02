// Velocity cut transforms (§10.5, 30 fps numbers scale with the edge's frame counts). Pure; VisualClipView applies them
// on top of the clip camera. Exit runs on the last `frames` frames of A, entry on the first `frames` frames of B.
//   zoomThrough        exit power3.in: scale 1→1.2, blur 0→10 px (20 full-frame), opacity → .15; entry expo.out: .75→1, blur 10→0, .15→1
//   zoomThroughInverse exit 1→0.8; entry 1.25→1 (same blur/opacity curves)
//   whip               power3.inOut over exit+entry; one frame width of travel split across the cut (A 0→−W/2, B +W/2→0);
//                      directional blur ≤ 16 px (CSS blur + axis stretch 1→1.06)
//   cutTheCurve        exit power4.in ±230 px, opacity 0 by 30 % of the travel; entry power4.out from the other side
//   pushCut            A 1→1.04 (in quad), B 1.04→1.07 (out quad) then a short release to 1 (no pop); flash via cutFlashes
import type { VelocityEdge } from "../compute/types";
import { clamp01, expoOut, mix, power3, power4, smoothstep } from "../lib/easing";

export interface VelocityXf { scale: number; stretchX: number; stretchY: number; tx: number; ty: number; blurPx: number; opacity: number }
export const NO_VELOCITY: VelocityXf = { scale: 1, stretchX: 1, stretchY: 1, tx: 0, ty: 0, blurPx: 0, opacity: 1 };

const PUSH_SETTLE = 8;
const axis = (direction: string): { x: number; y: number } =>
  direction === "right" ? { x: 1, y: 0 } : direction === "up" ? { x: 0, y: -1 } : direction === "down" ? { x: 0, y: 1 } : { x: -1, y: 0 };

/** Frames after the entry window during which the entry still transforms B (pushCut release). */
export const entryTailFrames = (edge: VelocityEdge): number => (edge.preset === "pushCut" ? PUSH_SETTLE : 0);

/**
 * @param r exit: frames relative to the cut (−frames … −1); entry: frames since the cut (0 … frames + tail − 1)
 */
export function velocityTransform(edge: VelocityEdge, role: "exit" | "entry", r: number, o: { width: number; height: number; fullFrame: boolean }): VelocityXf {
  const n = Math.max(1, edge.frames);
  if (role === "exit" && (r < -n || r >= 0)) return NO_VELOCITY;
  if (role === "entry" && (r < 0 || r >= n + entryTailFrames(edge))) return NO_VELOCITY;
  // exit progress reaches 1 on the last frame before the cut; entry progress is 0 on the first frame after it
  const pe = clamp01((r + n + 1) / n);
  const pi = clamp01(r / n);
  const blurMax = o.fullFrame ? 20 : 10;
  const ax = axis(edge.direction);
  switch (edge.preset) {
    case "zoomThrough":
    case "zoomThroughInverse": {
      const inv = edge.preset === "zoomThroughInverse";
      if (role === "exit") {
        const e = power3.in(pe);
        return { ...NO_VELOCITY, scale: mix(1, inv ? 0.8 : 1.2, e), blurPx: blurMax * e, opacity: mix(1, 0.15, e) };
      }
      const e = expoOut(pi);
      return { ...NO_VELOCITY, scale: mix(inv ? 1.25 : 0.75, 1, e), blurPx: blurMax * (1 - e), opacity: mix(0.15, 1, e) };
    }
    case "whip": {
      // global progress u over exit+entry (each side owns one half of the inOut curve)
      const u = role === "exit" ? 0.5 * clamp01((r + n) / n) : 0.5 + 0.5 * pi;
      const e = power3.inOut(u);
      const travelX = o.width * ax.x;
      const travelY = o.height * ax.y;
      const pos = role === "exit" ? e : e - 1; // A: 0 → ½ (moving with the whip); B: −½ → 0
      const speed = 4 * u * (1 - u); // peaks at the cut
      const stretch = 1 + 0.06 * speed;
      return {
        ...NO_VELOCITY,
        tx: travelX * pos,
        ty: travelY * pos,
        blurPx: 16 * speed,
        stretchX: ax.x !== 0 ? stretch : 1,
        stretchY: ax.y !== 0 ? stretch : 1,
      };
    }
    case "cutTheCurve": {
      const D = 230;
      if (role === "exit") {
        const e = power4.in(pe);
        return { ...NO_VELOCITY, tx: ax.x * D * e, ty: ax.y * D * e, opacity: 1 - clamp01(e / 0.3) };
      }
      const e = power4.out(pi);
      return { ...NO_VELOCITY, tx: -ax.x * D * (1 - e), ty: -ax.y * D * (1 - e), opacity: clamp01(e / 0.3) };
    }
    case "pushCut": {
      if (role === "exit") return { ...NO_VELOCITY, scale: mix(1, 1.04, pe * pe) };
      if (r < n) {
        const q = 1 - (1 - pi) * (1 - pi);
        return { ...NO_VELOCITY, scale: mix(1.04, 1.07, q) };
      }
      const s = smoothstep((r - n + 1) / PUSH_SETTLE);
      return { ...NO_VELOCITY, scale: mix(1.07, 1, s) };
    }
    default:
      return NO_VELOCITY;
  }
}

/** CSS for a velocity transform about the frame centre. */
export function velocityCss(x: VelocityXf): { transform: string | undefined; filter: string | undefined; opacity: number | undefined } {
  const identity = x.scale === 1 && x.stretchX === 1 && x.stretchY === 1 && x.tx === 0 && x.ty === 0;
  return {
    transform: identity ? undefined : `translate(${x.tx.toFixed(2)}px, ${x.ty.toFixed(2)}px) scale(${(x.scale * x.stretchX).toFixed(5)}, ${(x.scale * x.stretchY).toFixed(5)})`,
    filter: x.blurPx > 0.05 ? `blur(${x.blurPx.toFixed(2)}px)` : undefined,
    opacity: x.opacity < 1 ? Math.max(0, x.opacity) : undefined,
  };
}
