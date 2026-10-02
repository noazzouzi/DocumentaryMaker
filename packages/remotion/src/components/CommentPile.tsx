// CommentPile (M2): 3–10 short comment cards pop at `at` (4–8 f apart) with ±5° jitter over a dimmed picture (`dim`;
// the blur is a derived picture fx, see compute/overlayFx); light or dark cards; generic (no platform marks).
import type React from "react";
import { AbsoluteFill } from "remotion";
import { fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { ease as motionEase } from "../lib/motion";
import { truncate } from "../lib/text";
import { Avatar } from "./parts";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export const CommentPile: React.FC<ComponentProps<"CommentPile">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const dark = p.theme === "dark";
  const bg = dark ? "#16191D" : "#FFFFFF";
  const fg = dark ? "#EEF1F3" : "#14171A";
  const muted = dark ? "#8B98A5" : "#657786";
  const dim = Math.max(0, Math.min(1, p.dim));
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <AbsoluteFill style={{ backgroundColor: rgba("#000000", dim * clamp01(c.f / 6)) }} />
      <AbsoluteFill style={{ transform: `scale(${pushScale(c, 0.04).toFixed(5)})` }}>
        {p.items.slice(0, 10).map((it, i) => {
          const t = c.f - it.at;
          if (t < 0) return null;
          const s = 0.7 + 0.3 * motionEase.outBack(clamp01(t / 6));
          return (
            <div
              key={i}
              style={{
                position: "absolute", left: it.x * env.width, top: it.y * env.height, width: 640, transform: `translate(-50%, -50%) rotate(${it.rotDeg.toFixed(2)}deg) scale(${s.toFixed(4)})`,
                opacity: clamp01(t / 2 + 0.3), backgroundColor: bg, color: fg, borderRadius: 22, padding: "22px 26px", boxShadow: `0 20px 44px ${rgba("#000000", 0.5)}`,
                fontFamily: fontStack(env.tokens, "body"), display: "flex", gap: 18,
              }}
            >
              <Avatar assetId={null} name={it.displayName} size={58} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", whiteSpace: "nowrap", overflow: "hidden" }}>
                  <span style={{ fontWeight: 800, fontSize: 26 }}>{truncate(it.displayName, 24)}</span>
                  <span style={{ fontSize: 22, color: muted }}>{truncate(it.handle, 20)}</span>
                </div>
                <div style={{ fontSize: 30, lineHeight: 1.3 }}>{it.body}</div>
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
