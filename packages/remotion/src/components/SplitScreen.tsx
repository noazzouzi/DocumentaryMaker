// SplitScreen (M2, picture band): two stills side by side (cover-fit halves); the right half is revealed by a 10 f
// wipe from the divider, the divider line grows with it; labels in chips at the bottom of each half.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { StillLayer } from "../media/StillLayer";
import { useItemClock, type ComponentProps } from "./shared";

const Half: React.FC<{ assetId: string | null; left: number; width: number; height: number; seed: number }> = ({ assetId, left, width, height, seed }) => {
  const env = useEnv();
  return (
    <div style={{ position: "absolute", left, top: 0, width, height, overflow: "hidden" }}>
      {assetId && env.assets[assetId] ? (
        <StillLayer assetId={assetId} crop={null} focal={{ x: 0.5, y: 0.45 }} box={{ left: 0, top: 0, width, height }} />
      ) : (
        <GeneratedBackdrop recipe="darkNoise" seed={seed} />
      )}
    </div>
  );
};

export const SplitScreen: React.FC<ComponentProps<"SplitScreen">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const W = env.width;
  const H = env.height;
  const half = W / 2;
  const seed = seedOf(item.id);
  const wipe = expoOut(clamp01(c.f / Math.max(1, Math.min(10, c.enter || 10))));
  const labelIn = clamp01((c.f - 6) / 8);
  const chip = (text: string, x: number) =>
    text ? (
      <div style={{ position: "absolute", left: x, top: 96, width: half, display: "flex", justifyContent: "center", opacity: labelIn }}>
        <span style={{ padding: "8px 20px", backgroundColor: rgba(env.tokens.tokens.palette.ink, 0.82), color: env.tokens.tokens.palette.text, fontFamily: fontStack(env.tokens, "headline"), fontSize: 56, letterSpacing: "0.03em", borderBottom: `5px solid ${p.dividerColor}` }}>{text.toLocaleUpperCase(env.locale)}</span>
      </div>
    ) : null;
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <Half assetId={p.left.assetId} left={0} width={half} height={H} seed={seed} />
      <div style={{ position: "absolute", left: half, top: 0, width: half, height: H, clipPath: `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0)` }}>
        <Half assetId={p.right.assetId} left={0} width={half} height={H} seed={seed + 1} />
      </div>
      <div style={{ position: "absolute", left: half - 4, top: 0, width: 8, height: H, backgroundColor: p.dividerColor, transform: `scaleY(${wipe.toFixed(4)})`, transformOrigin: "50% 0%", boxShadow: `0 0 24px ${rgba(p.dividerColor, 0.6)}` }} />
      {chip(p.left.label, 0)}
      {chip(p.right.label, half)}
    </AbsoluteFill>
  );
};
