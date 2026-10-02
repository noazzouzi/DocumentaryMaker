// ChapterCard (M1): full-frame textured backdrop (never flat ink — QA blackdetect), optional letterbox in over 20 f,
// mono kicker ("CHAPTER 3") with a mask reveal, Anton title slam (3 f), chapter progress dots; continuous push
// 1.0→1.05 + backdrop drift; 10 f exit revealing the picture.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { upper, wrapText } from "../lib/text";
import { LetterboxBars } from "../looks/Letterbox";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { fitFontSize } from "./fit";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export function titleLines(title: string, family: string, max: number, width: number, locale: string, maxLines = 2): { lines: string[]; size: number } {
  const t = upper(title, locale);
  const one = fitFontSize(t, { family, width, max });
  if (one >= max * 0.72 || maxLines === 1) return { lines: [t], size: one };
  const lines = wrapText(t, Math.ceil(t.length / maxLines) + 4, maxLines);
  const size = Math.min(...lines.map((l) => fitFontSize(l, { family, width, max })));
  return { lines, size };
}

export const ChapterCard: React.FC<ComponentProps<"ChapterCard">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const pal = env.tokens.tokens.palette;
  const ramp = env.tokens.tokens.typeRamp;
  const accent = accentOf(env.tokens);
  const { lines, size } = titleLines(p.title, familyOf(env.tokens, "headline"), ramp.chapterTitle, 1500, env.locale);
  const slam = expoOut(clamp01(c.f / 3));
  const titleScale = 1.25 - 0.25 * slam;
  const kickerReveal = expoOut(clamp01((c.f - 1) / 8));
  const letterbox = p.letterbox ? expoOut(clamp01(c.f / 20)) * (1 - c.outP) : 0;
  const push = pushScale(c);
  const exitScale = 1 + 0.06 * c.outP;
  const total = Math.max(1, Math.min(12, p.total));
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe={p.backdrop} seed={seedOf(item.id)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${(push * exitScale).toFixed(5)})` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, maxWidth: 1600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, clipPath: `inset(0 ${(100 - kickerReveal * 100).toFixed(2)}% 0 0)` }}>
            <div style={{ width: 56, height: 4, backgroundColor: accent }} />
            <div style={{ fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: ramp.chapterKicker, letterSpacing: "0.35em", color: accent }}>{upper(p.kicker, env.locale)}</div>
            <div style={{ width: 56, height: 4, backgroundColor: accent }} />
          </div>
          <div style={{ transform: `scale(${titleScale.toFixed(5)})`, opacity: clamp01(c.f / 2 + 0.2), textAlign: "center" }}>
            {lines.map((l, i) => (
              <div key={i} style={{ fontFamily: fontStack(env.tokens, "headline"), fontSize: size, lineHeight: 1.02, color: pal.text, textShadow: `0 10px 40px ${rgba("#000000", 0.55)}`, whiteSpace: "nowrap" }}>
                {l}
              </div>
            ))}
          </div>
          {p.total > 1 ? (
            <div style={{ display: "flex", gap: 12, marginTop: 6, opacity: kickerReveal }}>
              {Array.from({ length: total }, (_, i) => (
                <div key={i} style={{ width: i + 1 === p.index ? 34 : 12, height: 6, borderRadius: 3, backgroundColor: i + 1 === p.index ? accent : rgba(pal.text, i + 1 < p.index ? 0.7 : 0.28) }} />
              ))}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
      <LetterboxBars ratio={2.39} progress={letterbox} />
    </AbsoluteFill>
  );
};
