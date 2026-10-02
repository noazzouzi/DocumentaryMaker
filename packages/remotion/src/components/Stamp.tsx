// Stamp (M1, overshoot allowed): 2.6×→1× over 0.09 s ease-in; bounce 1 + .05·sin(30t)·e^(−9t); rotation ±10° from
// props; opacity .93; 3 f shake on impact; inked rubber look (double border + seeded ink-wear filter).
import type React from "react";
import { AbsoluteFill } from "remotion";
import { familyOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, inCubic } from "../lib/easing";
import { seedOf } from "../lib/random";
import { upper } from "../lib/text";
import { fitFontSize } from "./fit";
import { impactShake, useItemClock, type ComponentProps } from "./shared";

/** Stamp scale at time t (s) after its start: slam-in then a damped bounce. */
export function stampScale(tSec: number): number {
  const slamSec = 0.09;
  if (tSec < 0) return 2.6;
  if (tSec < slamSec) return 2.6 - 1.6 * inCubic(tSec / slamSec);
  const t = tSec - slamSec;
  return 1 + 0.05 * Math.sin(30 * t) * Math.exp(-9 * t);
}

export const Stamp: React.FC<ComponentProps<"Stamp">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const text = upper(p.text, env.locale);
  const family = familyOf(env.tokens, "slam");
  const size = fitFontSize(text, { family, width: 900, max: 150, min: 50 }) * p.scale;
  const tSec = c.f / env.fps;
  const scale = stampScale(tSec);
  const landed = Math.ceil(0.09 * env.fps);
  const shake = impactShake(item.id, c.f, landed, 3, 9);
  const id = `dm-ink-${seedOf(item.id).toString(36)}`;
  const opacity = 0.93 * clamp01(c.f / 2 + 0.5) * (1 - c.outP);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={seedOf(item.id) % 1000} result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -9 0 0 0 6.9" result="mask" />
          <feComposite in="SourceGraphic" in2="mask" operator="in" />
        </filter>
      </svg>
      <div
        style={{
          position: "absolute", left: `${(p.x * 100).toFixed(3)}%`, top: `${(p.y * 100).toFixed(3)}%`,
          transform: `translate(-50%, -50%) translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px) rotate(${p.rotationDeg.toFixed(3)}deg) scale(${scale.toFixed(5)})`,
          opacity,
        }}
      >
        <div style={{ filter: `url(#${id})`, padding: Math.round(size * 0.08) }}>
          <div
            style={{
              border: `${Math.round(size * 0.07)}px solid ${p.color}`, outline: `${Math.round(size * 0.025)}px solid ${p.color}`, outlineOffset: Math.round(size * 0.05),
              padding: `${Math.round(size * 0.06)}px ${Math.round(size * 0.22)}px`, borderRadius: Math.round(size * 0.08),
              fontFamily: fontStack(env.tokens, "slam"), fontSize: size, lineHeight: 1.05, color: p.color, whiteSpace: "nowrap", letterSpacing: "0.04em",
              backgroundColor: rgba(p.color, 0.06),
            }}
          >
            {text}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
