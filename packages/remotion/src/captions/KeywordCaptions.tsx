// KeywordCaptions (variant "keywords", drama default, M1): selective kw:* phrases rendered large (keywords.sizePx 96)
// in the caption band; each word pops popFrom (1.18) → 1.0 over popFrames (3 f); hero words scaled heroScale (1.35)
// in the keyword colour; ALL CAPS; stroke strokePx with paint-order stroke fill.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { fitFontSize } from "../components/fit";
import { familyStack, useEnv } from "../data/env";
import { clamp01 } from "../lib/easing";
import { zoneRect } from "../lib/geometry";
import { fontWeightFor } from "../fonts/registry";
import { captionText, popScale, relWords, toneColor } from "./common";

export const KeywordCaptions: React.FC<{ group: CaptionGroup }> = ({ group }) => {
  const env = useEnv();
  const f = useCurrentFrame();
  const dna = env.tokens.captionDNA;
  const band = zoneRect(env.tokens.tokens, "captionBand");
  const words = relWords(group).map((w, i, a) => (i === a.length - 1 ? { ...w, text: w.text.replace(/[,;:.…]+$/u, "") || w.text } : w));
  const line = words.map((w) => captionText(w.text, dna, env.locale)).join(" ");
  const weight = fontWeightFor(dna.font, dna.weight);
  const size = fitFontSize(line, { family: dna.font, weight, width: band.width / Math.max(1, dna.heroScale * 0.92), max: dna.keywords.sizePx, min: 48, letterSpacingEm: dna.letterSpacingEm });
  const fadeOut = 1 - clamp01((f - (group.dur - 3)) / 3);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: band.left, top: band.top, width: band.width, height: band.height, display: "flex", alignItems: "center", justifyContent: "center", gap: `0 ${(size * 0.25).toFixed(1)}px`, opacity: fadeOut }}>
        {words.map((w, i) => {
          const t = f - w.at;
          const visible = t >= 0;
          const scale = popScale(dna, t) * (w.hero ? dna.heroScale : 1);
          return (
            <span
              key={i}
              style={{
                display: "inline-block", fontFamily: familyStack(dna.font), fontWeight: weight, fontSize: size, lineHeight: 1.05, letterSpacing: `${dna.letterSpacingEm}em`,
                color: toneColor(dna, w.tone, w.hero), WebkitTextStroke: `${dna.strokePx}px ${dna.strokeColor}`, paintOrder: "stroke fill",
                transform: `scale(${scale.toFixed(5)})`, opacity: visible ? 1 : 0, whiteSpace: "nowrap",
              }}
            >
              {captionText(w.text, dna, env.locale)}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
