// Karaoke (M2): the whole group visible; done / active / todo colours, the active word heavier (keyword colour, slight
// 1.04 lift from the baseline) with an underline that grows with outCubic across the word. The word gap includes both
// strokes and the lift, so neighbours never touch.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { fitFontSize } from "../components/fit";
import { familyStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, outCubic } from "../lib/easing";
import { zoneRect } from "../lib/geometry";
import { fontWeightFor } from "../fonts/registry";
import { captionText, relWords, toneColor, wordGap } from "./common";

export const KaraokeCaptions: React.FC<{ group: CaptionGroup }> = ({ group }) => {
  const env = useEnv();
  const f = useCurrentFrame();
  const dna = env.tokens.captionDNA;
  const band = zoneRect(env.tokens.tokens, "captionBand");
  const words = relWords(group);
  const weight = fontWeightFor(dna.font, dna.weight);
  const line = words.map((w) => captionText(w.text, dna, env.locale)).join(" ");
  const size = fitFontSize(line, { family: dna.font, weight, width: (band.width - 40 - (words.length - 1) * dna.strokePx) / 1.06, max: dna.sizePx, min: 30, letterSpacingEm: dna.letterSpacingEm });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: band.left, top: band.top, width: band.width, height: band.height, display: "flex", alignItems: "center", justifyContent: "center", gap: `0 ${wordGap(size, dna.strokePx, 0.3).toFixed(1)}px` }}>
        {words.map((w, i) => {
          const t = f - w.at;
          const state = t < 0 ? "todo" : t < w.dur ? "active" : "done";
          const color = state === "todo" ? rgba(dna.color, 0.5) : state === "active" ? toneColor(dna, w.tone === "normal" ? "keyword" : w.tone, true) : toneColor(dna, w.tone, false);
          const u = state === "active" ? outCubic(clamp01(t / w.dur)) : state === "done" ? 1 : 0;
          return (
            <span key={i} style={{ position: "relative", display: "inline-block", whiteSpace: "pre", transform: state === "active" ? "scale(1.04)" : undefined, transformOrigin: "50% 100%" }}>
              <span style={{ fontFamily: familyStack(dna.font), fontWeight: weight, fontSize: size, lineHeight: 1.1, letterSpacing: `${dna.letterSpacingEm}em`, color, WebkitTextStroke: `${dna.strokePx}px ${dna.strokeColor}`, paintOrder: "stroke fill" }}>
                {captionText(w.text, dna, env.locale)}
              </span>
              <span style={{ position: "absolute", left: 0, bottom: -6, height: 6, width: "100%", backgroundColor: dna.keywordColor, transform: `scaleX(${(state === "active" ? u : 0).toFixed(4)})`, transformOrigin: "0 50%", borderRadius: 3 }} />
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
