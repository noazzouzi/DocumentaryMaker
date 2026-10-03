// KineticText (M1): lines of big headline type, each word slides up through a mask, staggered over ≤ staggerMaxFrames
// (15 f) in total (function words enter with their content word, so a lone "THE" never shows); emphasis words in the accent colour; slow 1.02 drift; exit 6 f. Also the FallbackCard text look.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { isEmphasis, revealSlots, splitWords, upper } from "../lib/text";
import { fitFontSize } from "./fit";
import { useItemClock, useZone, zoneFor, type ComponentProps, type ItemClock } from "./shared";

export interface KineticBlockProps {
  lines: readonly string[];
  emphasis: readonly string[];
  align: "left" | "center";
  clock: ItemClock;
  box: { left: number; top: number; width: number; height: number };
  maxSize?: number;
  scrim?: boolean;
}

/** The kinetic type block (shared with FallbackCard). */
export const KineticBlock: React.FC<KineticBlockProps> = ({ lines, emphasis, align, clock: c, box, maxSize = 120, scrim = true }) => {
  const env = useEnv();
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const family = familyOf(env.tokens, "headline");
  const shown = lines.slice(0, 4).map((l) => upper(l, env.locale));
  const lineH = 1.02;
  const byHeight = Math.floor(box.height / Math.max(1, shown.length) / lineH);
  const size = Math.min(byHeight, ...shown.map((l) => fitFontSize(l, { family, width: box.width - 40, max: maxSize, min: 40 })));
  const words = shown.map((l) => splitWords(l));
  // reveal slots per word: a function word ("THE") enters with the next content word, never alone
  const lang = env.lang === "fr" ? "fr" : "en";
  const slotOf: number[][] = [];
  let total = 0;
  for (const ws of words) {
    const r = revealSlots(ws, lang, total);
    slotOf.push(r.slots);
    total += r.count;
  }
  const stagger = Math.max(1, env.tokens.motion.staggerMaxFrames);
  const step = total > 1 ? Math.min(4, stagger / (total - 1)) : 0;
  const wordFrames = Math.max(4, Math.min(env.tokens.motion.entryMaxFrames, c.enter || 8));
  const drift = 1 + 0.02 * c.hold;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 1 - c.outP }}>
      {scrim ? <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 55% at 50% 45%, ${rgba("#000000", 0.5 * c.inP)} 0%, transparent 100%)` }} /> : null}
      <div
        style={{
          position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, display: "flex", flexDirection: "column",
          justifyContent: "center", alignItems: align === "center" ? "center" : "flex-start", transform: `scale(${drift.toFixed(5)}) translateY(${(-18 * c.outP).toFixed(2)}px)`,
          filter: `drop-shadow(0 6px 22px ${rgba("#000000", 0.55)})`,
        }}
      >
        {words.map((ws, li) => (
          <div key={li} style={{ display: "flex", flexWrap: "nowrap", gap: `0 ${(size * 0.22).toFixed(1)}px`, justifyContent: align === "center" ? "center" : "flex-start" }}>
            {ws.map((w, wi) => {
              const start = slotOf[li]![wi]! * step;
              const p = c.entryEase(clamp01((c.f - start) / wordFrames));
              const em = isEmphasis(w, emphasis);
              return (
                <span key={wi} style={{ display: "inline-block", overflow: "hidden", lineHeight: lineH, paddingBottom: "0.04em" }}>
                  <span
                    style={{
                      display: "inline-block", fontFamily: fontStack(env.tokens, "headline"), fontSize: size, color: em ? accent : pal.text,
                      transform: `translateY(${((1 - p) * 105).toFixed(2)}%)`,
                    }}
                  >
                    {w}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const KineticText: React.FC<ComponentProps<"KineticText">> = ({ item }) => {
  const c = useItemClock(item);
  const z = useZone(zoneFor(item, ["center", "full", "lowerThird"], "center"));
  return <KineticBlock lines={item.props.lines} emphasis={item.props.emphasis} align={item.props.align} clock={c} box={z} />;
};
