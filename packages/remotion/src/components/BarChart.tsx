// BarChart (M2): vertical bars grow (expo.out, stagger ≤ 15 f in total), values count up, the highlighted bar is in the
// accent colour; title, unit and source label. Negative values grow downward from a zero baseline.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { formatNumber, truncate } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export const BarChart: React.FC<ComponentProps<"BarChart">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const bars = p.bars.slice(0, 8);
  const n = bars.length;
  const posMax = Math.max(0, ...bars.map((b) => b.value));
  const negMax = Math.max(0, ...bars.map((b) => -b.value));
  const maxV = Math.max(posMax, negMax, 1e-9);
  const chartH = 560;
  const unit = chartH / Math.max(posMax + negMax, 1e-9); // px per value unit
  const zeroY = posMax * unit;
  const stagger = n > 1 ? Math.min(env.tokens.motion.staggerMaxFrames, 15) / (n - 1) : 0;
  const barW = Math.min(170, (1400 - (n - 1) * 36) / n);
  const fmt = (v: number) => formatNumber(v, { format: Math.abs(maxV) >= 100_000 ? "compact" : "number", currency: null, decimals: Math.abs(maxV) < 10 ? 1 : 0, locale: env.locale as "en-US" | "fr-FR" });
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="darkNoise" seed={seedOf(item.id)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${pushScale(c, 0.04).toFixed(5)})`, opacity: c.inP }}>
        <div style={{ width: 1500, display: "flex", flexDirection: "column", gap: 30 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <span style={{ fontFamily: fontStack(env.tokens, "headline"), fontSize: 72, color: pal.text, lineHeight: 1 }}>{p.title}</span>
            {p.unit ? <span style={{ fontFamily: fontStack(env.tokens, "mono"), fontSize: 26, color: rgba(pal.text, 0.6) }}>({p.unit})</span> : null}
          </div>
          <div style={{ position: "relative", height: chartH + 80, display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 36 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: zeroY, height: 3, backgroundColor: rgba(pal.text, 0.35) }} />
            {bars.map((b, i) => {
              const g = expoOut(clamp01((c.f - c.enter * 0.5 - i * stagger) / 20));
              const h = Math.abs(b.value) * unit * g;
              const color = b.highlight ? accent : rgba(pal.text, 0.78);
              const neg = b.value < 0;
              return (
                <div key={i} style={{ position: "relative", width: barW, height: chartH + 80 }}>
                  <div style={{ position: "absolute", left: 0, width: barW, top: neg ? zeroY + 3 : zeroY - h, height: Math.max(0, h), backgroundColor: color, borderRadius: 6, boxShadow: b.highlight ? `0 0 40px ${rgba(accent, 0.45)}` : undefined }} />
                  <div style={{ position: "absolute", left: -40, width: barW + 80, textAlign: "center", top: neg ? zeroY + h + 12 : zeroY - h - 58, fontFamily: fontStack(env.tokens, "headline"), fontSize: 46, color: b.highlight ? accent : pal.text, opacity: g }}>{fmt(b.value * g)}</div>
                  <div style={{ position: "absolute", left: -30, width: barW + 60, textAlign: "center", top: chartH + 26, fontFamily: fontStack(env.tokens, "body"), fontWeight: 700, fontSize: 26, color: rgba(pal.text, 0.85) }}>{truncate(b.label, 18)}</div>
                </div>
              );
            })}
          </div>
          {p.sourceLabel ? <div style={{ fontFamily: fontStack(env.tokens, "mono"), fontSize: 22, color: rgba(pal.text, 0.6) }}>{p.sourceLabel}</div> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
