// Vignette (§10.12): radial-gradient(ellipse, transparent radius·100 %, rgba(0,0,0,amount) 100 %) with feather; the
// amount follows grade.byAct[act].vignetteAmount per chapter.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { useDocState } from "../data/env";
import { gradeAt } from "./Grade";

export function vignetteBackground(amount: number, radius: number, feather: number): string | null {
  if (!(amount > 0)) return null;
  // transparent up to radius·(1 − feather/2), full `amount` at the farthest corner (100 %), eased mid stop
  const inner = Math.max(0, Math.min(0.98, radius * (1 - feather / 2))) * 100;
  const outer = 100;
  const a = Math.min(1, amount);
  return `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) ${inner.toFixed(1)}%, rgba(0,0,0,${(a * 0.55).toFixed(3)}) ${((inner + outer) / 2).toFixed(1)}%, rgba(0,0,0,${a.toFixed(3)}) ${outer.toFixed(1)}%)`;
}

export const Vignette: React.FC<{ amount?: number }> = ({ amount }) => {
  const doc = useDocState();
  const f = useCurrentFrame();
  if (!doc) return null;
  const v = doc.t.grade.vignette;
  const bg = vignetteBackground(amount ?? gradeAt(doc.t, f).vignetteAmount, v.radius, v.feather);
  return bg ? <AbsoluteFill style={{ background: bg, pointerEvents: "none" }} /> : null;
};
