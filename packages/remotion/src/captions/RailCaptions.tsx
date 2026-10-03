// Rail (M2): a quiet single subtitle line for minimal styles — 30 px, weight 600 (nearest available weight of the
// caption font: the true-crime preset's JetBrains Mono → 700), sentence case, on a translucent strip at the bottom of
// zones.captionBand (never a hard-coded y: style keep-outs differ). The whole line shows for the group, fading in and
// out over 3 f; no pop, no per-word reveal.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { fitFontSize } from "../components/fit";
import { familyStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { zoneRect } from "../lib/geometry";
import { fontWeightFor } from "../fonts/registry";
import { relWords, toneColor } from "./common";

const RAIL_PX = 30;
const STRIP_H = 48;

export const RailCaptions: React.FC<{ group: CaptionGroup }> = ({ group }) => {
  const env = useEnv();
  const f = useCurrentFrame();
  const dna = env.tokens.captionDNA;
  const band = zoneRect(env.tokens.tokens, "captionBand");
  const words = relWords(group);
  const weight = fontWeightFor(dna.font, 600);
  const line = words.map((w) => w.text).join(" ");
  const size = fitFontSize(line, { family: dna.font, weight, width: band.width - 48, max: RAIL_PX, min: 20 });
  const fade = clamp01((f + 1) / 3) * (1 - clamp01((f - (group.dur - 3)) / 3));
  const h = Math.min(STRIP_H, band.height);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fade }}>
      <div style={{ position: "absolute", left: band.left, top: band.top + band.height - h, width: band.width, height: h, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ padding: "4px 14px", backgroundColor: rgba("#000000", 0.45), borderRadius: 4, fontFamily: familyStack(dna.font), fontWeight: weight, fontSize: size, lineHeight: 1.25, whiteSpace: "nowrap" }}>
          {words.map((w, i) => (
            <span key={i} style={{ color: toneColor(dna, w.tone, false) }}>
              {(i ? " " : "") + w.text}
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
