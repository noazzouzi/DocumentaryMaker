// LowerThird (M1): 10 f mask reveal; name (Inter 800) over role (Inter 600); accent bar; slow 1.02 drift during the
// hold; 8 f exit. Lives in zones.lowerThird (mirrored for align "right").
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { fitFontSize } from "./fit";
import { useItemClock, useZone, type ComponentProps } from "./shared";

export const LowerThird: React.FC<ComponentProps<"LowerThird">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const z = useZone("lowerThird");
  const { name, role, align } = item.props;
  const right = align === "right";
  const pal = env.tokens.tokens.palette;
  const ramp = env.tokens.tokens.typeRamp;
  const bodyFam = familyOf(env.tokens, "body");
  const nameSize = fitFontSize(name, { family: bodyFam, weight: 800, width: z.width - 80, max: ramp.lowerThirdName, min: 28 });
  const roleSize = fitFontSize(role, { family: bodyFam, weight: 600, width: z.width - 80, max: ramp.lowerThirdRole, min: 18 });
  const reveal = clamp01(c.inP) * (1 - c.outP);
  const barGrow = c.entryEase(clamp01(c.f / Math.max(1, Math.round(c.enter * 0.6))));
  const textIn = c.entryEase(clamp01((c.f - 2) / Math.max(1, c.enter)));
  const drift = 1 + 0.02 * c.hold;
  const clip = right ? `inset(0 0 0 ${(100 - reveal * 100).toFixed(2)}%)` : `inset(0 ${(100 - reveal * 100).toFixed(2)}% 0 0)`;
  const left = right ? env.width - z.left - z.width : z.left;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute", left, top: z.top, width: z.width, height: z.height, display: "flex", alignItems: "center",
          justifyContent: right ? "flex-end" : "flex-start", transform: `scale(${drift.toFixed(5)})`, transformOrigin: right ? "100% 50%" : "0% 50%",
          opacity: 1 - c.outP * 0.6,
        }}
      >
        <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "stretch", clipPath: clip, maxWidth: z.width }}>
          <div style={{ width: 10, backgroundColor: accentOf(env.tokens), transform: `scaleY(${barGrow.toFixed(4)})`, transformOrigin: "50% 100%" }} />
          <div
            style={{
              padding: "16px 30px 18px 26px", backgroundColor: rgba(pal.ink, 0.82), display: "flex", flexDirection: "column", gap: 4,
              textAlign: right ? "right" : "left", transform: `translateX(${((right ? 1 : -1) * 24 * (1 - textIn)).toFixed(2)}px)`,
            }}
          >
            <div style={{ fontFamily: fontStack(env.tokens, "body"), fontWeight: 800, fontSize: nameSize, lineHeight: 1.05, color: pal.text, whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{name}</div>
            {role ? (
              <div style={{ fontFamily: fontStack(env.tokens, "body"), fontWeight: 600, fontSize: roleSize, lineHeight: 1.2, color: rgba(pal.text, 0.78), whiteSpace: "nowrap", opacity: textIn }}>{role}</div>
            ) : null}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
