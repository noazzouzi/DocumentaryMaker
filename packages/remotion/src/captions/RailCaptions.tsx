// Rail (M2): a quiet single line, 30 px, weight 600, sentence case, at the bottom of the caption band (minimal styles;
// the true-crime preset uses mono). Words appear as spoken; no pop.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { familyStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { zoneRect } from "../lib/geometry";
import { fontWeightFor } from "../fonts/registry";
import { relWords, toneColor } from "./common";

export const RailCaptions: React.FC<{ group: CaptionGroup }> = ({ group }) => {
  const env = useEnv();
  const f = useCurrentFrame();
  const dna = env.tokens.captionDNA;
  const band = zoneRect(env.tokens.tokens, "captionBand");
  const words = relWords(group);
  const weight = fontWeightFor(dna.font, 600);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: band.left, top: band.top + band.height - 48, width: band.width, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ padding: "4px 14px", backgroundColor: rgba("#000000", 0.45), borderRadius: 4, fontFamily: familyStack(dna.font), fontWeight: weight, fontSize: 30, lineHeight: 1.25, whiteSpace: "nowrap" }}>
          {words.map((w, i) => (
            <span key={i} style={{ color: toneColor(dna, w.tone, false), opacity: f >= w.at ? 1 : 0 }}>
              {(i ? " " : "") + w.text}
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
