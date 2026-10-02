// KineticCaptions (variant "pop", M1, opt-in): ONE line in zones.captionBand; captionDNA.font (Archivo Black) at
// sizePx 78 (70–90 via fitText after FontGate); uppercase; -webkit-text-stroke 9 px; each word pops popFrom 1.18 → 1.0
// over popFrames at its start; tones keyword/money/danger; hero words scaled. Port of the tsc-check KineticCaptions.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { fitFontSize } from "../components/fit";
import { familyStack, useEnv } from "../data/env";
import { zoneRect } from "../lib/geometry";
import { fontWeightFor } from "../fonts/registry";
import { captionText, popScale, relWords, toneColor } from "./common";

export const KineticCaptions: React.FC<{ group: CaptionGroup }> = ({ group }) => {
  const env = useEnv();
  const f = useCurrentFrame();
  const dna = env.tokens.captionDNA;
  const band = zoneRect(env.tokens.tokens, "captionBand");
  const words = relWords(group);
  const line = words.map((w) => captionText(w.text, dna, env.locale)).join(" ");
  const weight = fontWeightFor(dna.font, dna.weight);
  const fitted = fitFontSize(line, { family: dna.font, weight, width: band.width - 40, max: 90, min: 30, letterSpacingEm: dna.letterSpacingEm });
  const size = Math.min(fitted, Math.max(70, Math.min(90, dna.sizePx)));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: band.left, top: band.top, width: band.width, height: band.height, display: "flex", alignItems: "center", justifyContent: "center", gap: `0 ${(size * 0.24).toFixed(1)}px` }}>
        {words.map((w, i) => {
          const t = f - w.at;
          const scale = popScale(dna, t) * (w.hero ? Math.min(dna.heroScale, 1.2) : 1);
          return (
            <span
              key={i}
              style={{
                display: "inline-block", whiteSpace: "pre", fontFamily: familyStack(dna.font), fontWeight: weight, fontSize: size, lineHeight: 1.05,
                letterSpacing: `${dna.letterSpacingEm}em`, color: toneColor(dna, w.tone, w.hero), WebkitTextStroke: `${dna.strokePx}px ${dna.strokeColor}`,
                paintOrder: "stroke fill", transform: `scale(${scale.toFixed(5)})`, opacity: t >= 0 ? 1 : 0,
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
