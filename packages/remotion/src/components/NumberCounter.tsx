// NumberCounter (M1): 45–90 f expo.out roll; Intl.NumberFormat(locale, currency incl. NLG → ƒ); odometer digits; the
// font grows with the value; background blur 0→3 px (a derived picture fx, see computeTimeline overlayFx); a slight
// jitter while digits change; label below.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp, clamp01, expoOut } from "../lib/easing";
import { odometerCells } from "../lib/odometer";
import { hashSigned } from "../lib/random";
import { upper } from "../lib/text";
import { textWidth } from "./fit";
import { useItemClock, useZone, zoneFor, type ComponentProps } from "./shared";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export const NumberCounter: React.FC<ComponentProps<"NumberCounter">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const z = useZone(zoneFor(item, ["center", "full"], "center"));
  const ramp = env.tokens.tokens.typeRamp;
  const pal = env.tokens.tokens.palette;
  const roll = clamp(Math.round(c.dur * 0.6), 45, 90);
  const rp = expoOut(clamp01((c.f - 2) / Math.max(1, Math.min(roll, c.dur - c.exit - 4))));
  const current = p.from + (p.value - p.from) * rp;
  const spec = { format: p.format, currency: p.currency, decimals: p.decimals, locale: p.locale } as const;
  const cells = odometerCells(p.value, current, spec);
  const family = familyOf(env.tokens, "headline");
  const size = Math.round(ramp.counter * (0.86 + 0.14 * rp));
  const digitW = Math.max(0.42, Math.min(0.75, textWidth("0", { family, size: 100 }) / 100)) * 1.04;
  const jitter = rp < 0.98 ? hashSigned(item.id, "jit", c.f) * 2.2 * (1 - rp) : 0;
  const enterY = 30 * (1 - c.inP);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ backgroundColor: rgba("#000000", 0.32 * c.inP * (1 - c.outP)) }} />
      <div
        style={{
          position: "absolute", left: z.left, top: z.top, width: z.width, height: z.height, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10, opacity: c.inP * (1 - c.outP),
          transform: `translateY(${(enterY + jitter).toFixed(2)}px) scale(${(1 + 0.03 * c.hold).toFixed(5)})`,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontFamily: fontStack(env.tokens, "headline"), fontSize: size, lineHeight: 1, color: p.color, filter: `drop-shadow(0 8px 26px ${rgba("#000000", 0.6)})`, whiteSpace: "nowrap" }}>
          {cells.map((cell, i) =>
            cell.kind === "digit" ? (
              <span key={i} style={{ display: "inline-block", position: "relative", width: `${(digitW * cell.visible).toFixed(4)}em`, height: "1em", overflow: "hidden", opacity: cell.visible, verticalAlign: "bottom" }}>
                <span style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", flexDirection: "column", alignItems: "center", transform: `translateY(${(-cell.pos).toFixed(4)}em)` }}>
                  {DIGITS.map((d, j) => (
                    <span key={j} style={{ height: "1em", lineHeight: 1 }}>{d}</span>
                  ))}
                </span>
              </span>
            ) : (
              <span key={i} style={{ display: "inline-block", opacity: cell.visible, maxWidth: cell.visible < 1 ? `${cell.visible}em` : undefined, overflow: cell.visible < 1 ? "hidden" : "visible", whiteSpace: "pre", verticalAlign: "bottom", lineHeight: 1 }}>
                {cell.text}
              </span>
            ),
          )}
        </div>
        {p.label ? (
          <div style={{ fontFamily: fontStack(env.tokens, "body"), fontWeight: 800, fontSize: Math.round(ramp.cardBody * 0.9), letterSpacing: "0.12em", color: rgba(pal.text, 0.9), textShadow: `0 4px 18px ${rgba("#000000", 0.6)}` }}>
            {upper(p.label, env.locale)}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
