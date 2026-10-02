// HeadlineStack (M2): press clippings tilt in one by one (tiltDeg) at their `at` with a 3 f slam, stacked with offsets;
// an impact shake on the last one; the stack keeps pushing in.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { truncate } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { NoiseCanvas } from "../media/NoiseCanvas";
import { impactShake, pushScale, useItemClock, type ComponentProps } from "./shared";

export const HeadlineStack: React.FC<ComponentProps<"HeadlineStack">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const items = item.props.items.slice(0, 5);
  const seed = seedOf(item.id);
  const accent = accentOf(env.tokens);
  const n = items.length;
  const last = items[n - 1]!;
  const shake = impactShake(item.id, c.f, last.at + 3, 6, 10);
  const step = n <= 3 ? 168 : 128; // each clipping leaves its headline readable under the next one
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="darkNoise" seed={seed} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px) scale(${pushScale(c, 0.05).toFixed(5)})` }}>
        <div style={{ position: "relative", width: 1240, height: 200 + (n - 1) * step }}>
          {items.map((h, i) => {
            const t = c.f - h.at;
            if (t < 0) return null;
            const s = expoOut(clamp01(t / 3));
            const scale = 1.3 - 0.3 * s;
            const x = (i - (n - 1) / 2) * 34;
            const y = i * step;
            return (
              <div
                key={i}
                style={{
                  position: "absolute", left: x, top: y, width: 1240, padding: "30px 40px", backgroundColor: "#F4F1E8", color: "#141210",
                  transform: `rotate(${h.tiltDeg.toFixed(3)}deg) scale(${scale.toFixed(5)})`, opacity: clamp01(t / 2 + 0.3), boxShadow: `0 24px 50px ${rgba("#000000", 0.6)}`,
                }}
              >
                <NoiseCanvas seed={seed + i} kind="paper" opacity={0.35} blend="multiply" width={480} height={120} />
                <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <span style={{ fontFamily: fontStack(env.tokens, "serif"), fontSize: 32, letterSpacing: "0.03em", borderBottom: `4px solid ${i === n - 1 ? accent : "transparent"}` }}>{truncate(h.outlet, 40)}</span>
                  <span style={{ fontFamily: fontStack(env.tokens, "mono"), fontSize: 20, color: "#5b554c" }}>{h.dateLabel}</span>
                </div>
                <div style={{ position: "relative", fontFamily: fontStack(env.tokens, "serif"), fontSize: h.headline.length > 70 ? 46 : 58, lineHeight: 1.12 }}>{h.headline}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
