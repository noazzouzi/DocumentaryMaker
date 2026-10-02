// TitleSting (M1): the video title — slam (1.4→1.0 over 8 f expo.out) or typewriter (2 f/char); kicker; accent bar;
// drifting backdrop; 90–120 f; 10 f exit.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { upper } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { titleLines } from "./ChapterCard";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export const TitleSting: React.FC<ComponentProps<"TitleSting">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const { lines, size } = titleLines(p.title, familyOf(env.tokens, "headline"), 150, 1640, env.locale);
  const full = lines.join("\n");
  let shown = full;
  let scale = 1;
  let opacity = 1;
  if (p.mode === "type") {
    const n = Math.floor(Math.max(0, c.f) / 2);
    shown = full.slice(0, n);
  } else {
    const s = expoOut(clamp01(c.f / 8));
    scale = 1.4 - 0.4 * s;
    opacity = clamp01(c.f / 3 + 0.15);
  }
  const typing = p.mode === "type" && shown.length < full.length;
  const caretOn = Math.floor(c.f / 8) % 2 === 0;
  const barP = expoOut(clamp01((c.f - 6) / 14));
  const kickerP = expoOut(clamp01((c.f - 4) / 10));
  const push = pushScale(c, 0.04);
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe={p.backdrop} seed={seedOf(item.id)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${(push * (1 + 0.05 * c.outP)).toFixed(5)})` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          {p.kicker ? (
            <div style={{ fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: 30, letterSpacing: "0.3em", color: rgba(pal.text, 0.85), opacity: kickerP, transform: `translateY(${(14 * (1 - kickerP)).toFixed(2)}px)` }}>
              {upper(p.kicker, env.locale)}
            </div>
          ) : null}
          <div style={{ transform: `scale(${scale.toFixed(5)})`, opacity, textAlign: "center" }}>
            {shown.split("\n").map((l, i, arr) => (
              <div key={i} style={{ fontFamily: fontStack(env.tokens, "headline"), fontSize: size, lineHeight: 1.0, color: pal.text, whiteSpace: "pre", textShadow: `0 12px 50px ${rgba("#000000", 0.6)}` }}>
                {l}
                {typing && i === arr.length - 1 ? (
                  <span style={{ display: "inline-block", width: "0.4em", height: "0.78em", marginLeft: "0.06em", backgroundColor: accent, opacity: caretOn ? 1 : 0 }} />
                ) : null}
              </div>
            ))}
          </div>
          <div style={{ width: 420, height: 8, backgroundColor: accent, transform: `scaleX(${barP.toFixed(4)})` }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
