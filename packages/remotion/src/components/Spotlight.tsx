// Spotlight (M2, picture band): everything outside a feathered ellipse dims (to `dim`); an optional hand-drawn ellipse
// is drawn on with evolvePath over 9 f. 9 f in, 6 f out.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import { useEnv } from "../data/env";
import { clamp01, expoOut } from "../lib/easing";
import { useItemClock, type ComponentProps } from "./shared";

export function ellipsePath(cx: number, cy: number, rx: number, ry: number, turns = 1.08): string {
  const steps = 64;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI * 0.6 + (i / steps) * turns * Math.PI * 2;
    const wob = 1 + 0.025 * Math.sin(i * 0.9);
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rx * wob).toFixed(1)} ${(cy + Math.sin(a) * ry * wob).toFixed(1)} `;
  }
  return d.trim();
}

export const Spotlight: React.FC<ComponentProps<"Spotlight">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const W = env.width;
  const H = env.height;
  const vis = c.inP * (1 - c.outP);
  const cx = p.cx * W;
  const cy = p.cy * H;
  const rx = Math.max(8, p.rx * W);
  const ry = Math.max(8, p.ry * H);
  const dim = Math.max(0, Math.min(1, p.dim)) * vis;
  const d = ellipsePath(cx, cy, rx * 1.08, ry * 1.08);
  const ev = evolvePath(expoOut(clamp01((c.f - 2) / 9)), d);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse ${rx.toFixed(1)}px ${ry.toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px, rgba(0,0,0,0) 70%, rgba(0,0,0,${dim.toFixed(3)}) 100%)` }}
      />
      {p.drawCircle ? (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 1 - c.outP }}>
          <path d={d} fill="none" stroke={p.color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};
