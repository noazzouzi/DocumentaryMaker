// ClipSubtitles (M2): subtitles for third-party clip speech ("clip") and translations ("translation"): sentence case,
// clipStyle (smaller, boxed), translation groups carry a TRANSLATED / TRADUCTION chip. Shown for the whole group.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { accentOf, familyStack, fontStack, useEnv } from "../data/env";
import { onColor } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { zoneRect } from "../lib/geometry";
import { TRANSLATED_LABEL, wrapText } from "../lib/text";
import { fontWeightFor } from "../fonts/registry";

export const ClipSubtitles: React.FC<{ group: CaptionGroup }> = ({ group }) => {
  const env = useEnv();
  const f = useCurrentFrame();
  const cs = env.tokens.captionDNA.clipStyle;
  const band = zoneRect(env.tokens.tokens, "captionBand");
  const text = group.words.map((w) => w.text).join(" ");
  const lines = wrapText(text, Math.max(20, Math.floor(band.width / (cs.sizePx * 0.55))), 2);
  const fade = clamp01(f / 3) * (1 - clamp01((f - (group.dur - 3)) / 3));
  const accent = accentOf(env.tokens);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fade }}>
      <div style={{ position: "absolute", left: band.left, top: band.top, width: band.width, height: band.height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        {group.variant === "translation" ? (
          <div style={{ padding: "3px 10px", backgroundColor: accent, color: onColor(accent), fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: 18, letterSpacing: "0.1em" }}>{TRANSLATED_LABEL[env.lang]}</div>
        ) : null}
        <div style={{ padding: "8px 18px", backgroundColor: cs.background, color: cs.color, fontFamily: familyStack(cs.font), fontWeight: fontWeightFor(cs.font, 600), fontSize: cs.sizePx, lineHeight: 1.25, textAlign: "center", borderRadius: 6 }}>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
