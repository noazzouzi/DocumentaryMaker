// QuoteCard (M2): B&W portrait (if any); serif italic quote; words appear at words[].at (static text when words is
// empty); a highlighter sweep on emphasis words; TRANSLATED / TRADUCTION chip; speaker + source; card push 1.0→1.05.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { seedOf } from "../lib/random";
import { splitWords, TRANSLATED_LABEL, truncate } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { Chip, FramedPhoto, Highlight } from "./parts";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export const QuoteCard: React.FC<ComponentProps<"QuoteCard">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const seed = seedOf(item.id);
  const hasPortrait = !!(p.portraitAssetId && env.assets[p.portraitAssetId]);
  const words = p.words.length ? p.words : splitWords(p.text).map((text) => ({ text, at: 0, emphasis: false }));
  const timed = p.words.length > 0;
  const chars = p.text.length;
  const size = Math.round(Math.max(38, Math.min(76, 76 - (chars - 60) * 0.12)));
  const width = hasPortrait ? 1040 : 1360;
  const enterY = 50 * (1 - c.inP);
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="darkNoise" seed={seed} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(${enterY.toFixed(2)}px) scale(${pushScale(c).toFixed(5)})`, opacity: c.inP }}>
        <div style={{ display: "flex", alignItems: "center", gap: 64 }}>
          {hasPortrait ? <FramedPhoto assetId={p.portraitAssetId} width={400} height={500} border={12} tiltDeg={-2} filter="grayscale(1) contrast(1.1)" seed={seed} /> : null}
          <div style={{ width, display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ fontFamily: fontStack(env.tokens, "serif"), fontSize: 140, lineHeight: 0.5, height: 56, color: accent }}>“</div>
            <div style={{ fontFamily: fontStack(env.tokens, "serif"), fontStyle: "italic", fontSize: size, lineHeight: 1.22, color: pal.text }}>
              {words.map((w, i) => {
                const vis = timed ? clamp01((c.f - w.at) / 4) : 1;
                const node = w.emphasis ? (
                  <Highlight f={c.f} start={timed ? w.at : c.enter} frames={10} color={rgba(accent, 0.85)}>
                    <span style={{ color: "#111" }}>{w.text}</span>
                  </Highlight>
                ) : (
                  w.text
                );
                return (
                  <span key={i} style={{ opacity: timed ? 0.18 + 0.82 * vis : 1 }}>
                    {node}
                    {i < words.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6 }}>
              <div style={{ width: 48, height: 4, backgroundColor: accent }} />
              <div style={{ fontFamily: fontStack(env.tokens, "body"), fontWeight: 800, fontSize: 34, color: pal.text }}>{p.speaker}</div>
              {p.sourceLabel ? <div style={{ fontFamily: fontStack(env.tokens, "mono"), fontSize: 22, color: rgba(pal.text, 0.65) }}>{truncate(p.sourceLabel, 60)}</div> : null}
              {p.translated ? <Chip text={TRANSLATED_LABEL[env.lang]} /> : null}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
