// TimelineGraphic (M2): a line draws on (evolvePath) to each event as it pops at its `at`; dates above (viewer-facing
// labels resolved by the director, fitted to one line), labels below;
// the active index is highlighted (accent, larger); the camera tracks the newest event when the line is wider than
// the frame.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import { accentOf, familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp, clamp01, inOutCubic } from "../lib/easing";
import { ease as motionEase } from "../lib/motion";
import { seedOf } from "../lib/random";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { fitFontSize } from "./fit";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export const TimelineGraphic: React.FC<ComponentProps<"TimelineGraphic">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const events = item.props.events.slice(0, 8);
  const active = item.props.activeIndex;
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const n = events.length;
  const spacing = n > 1 ? clamp(1500 / (n - 1), 300, 500) : 0;
  const total = spacing * (n - 1);
  const xs = events.map((_, i) => i * spacing);
  // index of the newest visible event, with a smooth approach between pops
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const p = clamp01((c.f - events[i]!.at + 6) / 12);
    if (p > 0) reach = i - 1 + inOutCubic(p);
  }
  reach = Math.max(0, reach);
  const lineX = n > 1 ? reach * spacing : 0;
  const path = `M 0 0 L ${Math.max(1, total)} 0`;
  const ev = evolvePath(total > 0 ? clamp01(lineX / total) : 1, path);
  const viewW = 1640;
  const camX = total > viewW ? clamp(lineX - viewW * 0.6, 0, total - viewW) : (total - viewW) / 2;
  const y0 = 540;
  // date labels ("5 Feb 1637", "24 sept. 1637") stay on one line inside their slot: shrink to fit, never wrap or overlap
  const family = familyOf(env.tokens, "headline");
  const slotW = Math.min(400, n > 1 ? spacing - 24 : 400);
  const dateSize = (label: string, isActive: boolean) => fitFontSize(label, { family, width: slotW, max: isActive ? 84 : 60, min: 28 });
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="darkNoise" seed={seedOf(item.id)} />
      <AbsoluteFill style={{ transform: `scale(${pushScale(c, 0.04).toFixed(5)})`, opacity: c.inP }}>
        <div style={{ position: "absolute", left: 140 - camX, top: y0, width: Math.max(total, 1) }}>
          <svg width={total + 40} height={20} style={{ position: "absolute", left: -10, top: -10, overflow: "visible" }}>
            <path d={`M 10 10 L ${total + 10} 10`} stroke={rgba(pal.text, 0.18)} strokeWidth={6} strokeLinecap="round" />
            <path d={`M 10 10 L ${total + 10} 10`} stroke={accent} strokeWidth={6} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
          </svg>
          {events.map((e, i) => {
            const t = c.f - e.at;
            if (t < 0) return null;
            const s = motionEase.outBack(clamp01(t / 8));
            const isActive = i === active;
            const size = isActive ? 34 : 24;
            return (
              <div key={i} style={{ position: "absolute", left: xs[i]!, top: 0, width: 0, height: 0 }}>
                <div style={{ position: "absolute", left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: "50%", backgroundColor: isActive ? accent : pal.text, border: `5px solid ${pal.ink}`, transform: `scale(${s.toFixed(4)})` }} />
                <div style={{ position: "absolute", left: -200, width: 400, bottom: 40, textAlign: "center", whiteSpace: "nowrap", fontFamily: fontStack(env.tokens, "headline"), fontSize: dateSize(e.dateLabel, isActive), lineHeight: 1, color: isActive ? accent : pal.text, opacity: clamp01(t / 5), transform: `translateY(${(16 * (1 - clamp01(t / 8))).toFixed(2)}px)` }}>{e.dateLabel}</div>
                <div style={{ position: "absolute", left: -180, width: 360, top: 40, textAlign: "center", fontFamily: fontStack(env.tokens, "body"), fontWeight: 600, fontSize: 30, lineHeight: 1.2, color: rgba(pal.text, isActive ? 1 : 0.8), opacity: clamp01((t - 3) / 6) }}>{e.label}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
