// EvidenceBoard (M2): a 3840 × 2160 board (cork / paper / dark) with pinned photo cards and typewriter labels; a virtual
// camera moves (moves[], ease-in-out over `frames`, then dwells) between the overview (focus −1) and single items;
// items pop at `at`; red-string links draw on with evolvePath once both ends are pinned.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import { fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, inOutCubic } from "../lib/easing";
import { ease as motionEase } from "../lib/motion";
import { seedOf } from "../lib/random";
import { NoiseCanvas } from "../media/NoiseCanvas";
import { FramedPhoto } from "./parts";
import { useItemClock, type ComponentProps } from "./shared";

const WORLD_W = 3840;
const WORLD_H = 2160;
const STRING = "#B3201A";

interface Cam { cx: number; cy: number; s: number }
const OVERVIEW: Cam = { cx: WORLD_W / 2, cy: WORLD_H / 2, s: 0.5 };

/** Camera on a board item (fills ≈ 62 % of the frame height). */
function focusCam(it: { x: number; y: number; w: number }): Cam {
  const h = it.w * 0.8 + 90;
  return { cx: it.x, cy: it.y, s: Math.max(0.5, Math.min(1.4, (1080 * 0.62) / h)) };
}

/** Camera at local frame f from the sorted moves (each move eases from where the previous one left the camera). */
export function boardCamera(moves: readonly { at: number; focus: number; frames: number }[], items: readonly { x: number; y: number; w: number }[], f: number): Cam {
  let cam = OVERVIEW;
  for (const m of [...moves].sort((a, b) => a.at - b.at)) {
    if (f < m.at) break;
    const target = m.focus >= 0 && items[m.focus] ? focusCam(items[m.focus]!) : OVERVIEW;
    const p = inOutCubic(clamp01((f - m.at) / Math.max(1, m.frames)));
    cam = { cx: cam.cx + (target.cx - cam.cx) * p, cy: cam.cy + (target.cy - cam.cy) * p, s: Math.exp(Math.log(cam.s) + (Math.log(target.s) - Math.log(cam.s)) * p) };
  }
  return cam;
}

export const EvidenceBoard: React.FC<ComponentProps<"EvidenceBoard">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const seed = seedOf(item.id);
  const items = p.items.slice(0, 6);
  const cam = boardCamera(p.moves, items, c.f);
  const tx = env.width / 2 - cam.cx * cam.s;
  const ty = env.height / 2 - cam.cy * cam.s;
  const bg = p.backdrop === "cork" ? "#8B5E3C" : p.backdrop === "paper" ? "#E9E3D3" : "#16181B";
  const centre = (i: number) => ({ x: items[i]!.x, y: items[i]!.y - (items[i]!.w * 0.8) / 2 + 20 });
  return (
    <AbsoluteFill style={{ opacity: c.inP * (1 - c.outP), backgroundColor: bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: WORLD_W, height: WORLD_H, transformOrigin: "0 0", transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${cam.s.toFixed(5)})`, backgroundColor: bg }}>
        <NoiseCanvas seed={seed} kind={p.backdrop === "dark" ? "grain" : "paper"} opacity={p.backdrop === "cork" ? 0.55 : 0.4} blend={p.backdrop === "dark" ? "screen" : "multiply"} />
        {p.backdrop === "cork" ? <NoiseCanvas seed={seed + 7} kind="dust" opacity={0.5} blend="multiply" width={480} height={270} /> : null}
        <svg width={WORLD_W} height={WORLD_H} style={{ position: "absolute", left: 0, top: 0 }}>
          {p.links.map(([a, b], i) => {
            if (!items[a] || !items[b]) return null;
            const start = Math.max(items[a]!.at, items[b]!.at) + 6;
            const prog = clamp01((c.f - start) / 15);
            if (prog <= 0) return null;
            const A = centre(a);
            const B = centre(b);
            const sag = Math.min(160, Math.hypot(B.x - A.x, B.y - A.y) * 0.12);
            const d = `M ${A.x} ${A.y} Q ${(A.x + B.x) / 2} ${(A.y + B.y) / 2 + sag} ${B.x} ${B.y}`;
            const ev = evolvePath(prog, d);
            return <path key={i} d={d} fill="none" stroke={STRING} strokeWidth={7} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
          })}
        </svg>
        {items.map((it, i) => {
          const t = c.f - it.at;
          if (t < 0) return null;
          const s = motionEase.outBack(clamp01(t / 7));
          const ph = Math.round(it.w * 0.8);
          return (
            <div key={i} style={{ position: "absolute", left: it.x - it.w / 2, top: it.y - ph / 2 - 50, transform: `rotate(${it.rotDeg}deg) scale(${s.toFixed(4)})`, transformOrigin: "50% 0%" }}>
              <FramedPhoto assetId={it.assetId} width={it.w} height={ph} border={16} seed={seed + i} style={{ boxShadow: `0 30px 50px ${rgba("#000000", 0.55)}` }}>
                <div style={{ position: "absolute", left: "50%", top: -14, width: 34, height: 34, marginLeft: -17, borderRadius: "50%", backgroundColor: STRING, boxShadow: `0 6px 10px ${rgba("#000000", 0.5)}` }} />
              </FramedPhoto>
              <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
                <span style={{ padding: "6px 18px", backgroundColor: "#F4EFE2", color: "#1A1714", fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: Math.max(30, Math.min(54, it.w / 10)), transform: `rotate(${(-it.rotDeg * 0.6).toFixed(2)}deg)` }}>
                  {it.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
