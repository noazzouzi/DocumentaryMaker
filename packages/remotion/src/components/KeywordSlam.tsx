// KeywordSlam (M1): 12–20 f full-frame on black / blur / transparent; 1.6→1.0 in 6 f expo.out; 3 f shake ±0.55 % of
// the width; ALL CAPS Anton in the given colour. The "blur" background is a derived picture fx (blur 18 px + dark .55,
// computeTimeline overlayFx) — never backdrop-filter, which is not bit-reproducible in headless Chrome.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { headlineLineHeight } from "../lib/legibility";
import { upper } from "../lib/text";
import { fitFontSize } from "./fit";
import { impactShake, useItemClock, type ComponentProps } from "./shared";

export const KeywordSlam: React.FC<ComponentProps<"KeywordSlam">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const text = upper(p.text, env.locale);
  const size = fitFontSize(text, { family: familyOf(env.tokens, "headline"), width: 1720, max: env.tokens.tokens.typeRamp.slam, min: 80 });
  const s = expoOut(clamp01(c.f / 6));
  const scale = 1.6 - 0.6 * s;
  const shake = impactShake(item.id, c.f, 6, 3, env.width * 0.0055);
  const bg = p.background === "black" ? <AbsoluteFill style={{ backgroundColor: "#000000" }} />
    : p.background === "blur" ? <AbsoluteFill style={{ backgroundColor: rgba("#000000", 0.2) }} /> // the picture blur + darkening are derived fx (computeTimeline)
    : null;
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      {bg}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: fontStack(env.tokens, "headline"), fontSize: size, lineHeight: headlineLineHeight(text, 1), color: p.color, whiteSpace: "nowrap",
            transform: `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px) scale(${scale.toFixed(5)})`, opacity: clamp01(c.f / 2 + 0.4),
            textShadow: p.background === "transparent" ? `0 10px 50px ${rgba("#000000", 0.7)}` : undefined,
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
