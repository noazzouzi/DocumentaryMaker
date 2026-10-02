// FreezeLabel (M2, picture band, self-contained): the asset's frame `sourceFrame` frozen full-frame (cover); over 3 f it
// desaturates (`desaturate`) and darkens (`darken`); the name slams in with a spring (damping 14, stiffness 220), the
// role below; held 45–90 f with a slow push.
import type React from "react";
import { AbsoluteFill, Freeze, spring } from "remotion";
import { accentOf, familyOf, fontStack, useAsset, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01 } from "../lib/easing";
import { seedOf } from "../lib/random";
import { upper } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { StillLayer } from "../media/StillLayer";
import { VideoLayer } from "../media/VideoLayer";
import { fitFontSize } from "./fit";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

export const FreezeLabel: React.FC<ComponentProps<"FreezeLabel">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const asset = env.assets[p.assetId];
  const a = useAsset(p.assetId);
  const k = clamp01(c.f / 3);
  const sat = 1 - Math.max(0, Math.min(1, p.desaturate)) * k;
  const bright = 1 - Math.max(0, Math.min(1, p.darken)) * k;
  const pop = spring({ frame: c.f - 2, fps: env.fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
  const name = upper(p.name, env.locale);
  const size = fitFontSize(name, { family: familyOf(env.tokens, "headline"), width: 1300, max: 128, min: 56 });
  const accent = accentOf(env.tokens);
  let frozen: React.ReactNode;
  if (asset && a.url && asset.kind === "video") {
    frozen = (
      <Freeze frame={0}>
        <VideoLayer assetId={p.assetId} trimBefore={p.sourceFrame} crop={null} focal={{ x: 0.5, y: 0.45 }} />
      </Freeze>
    );
  } else if (asset && a.url) {
    frozen = <StillLayer assetId={p.assetId} crop={null} focal={{ x: 0.5, y: 0.4 }} />;
  } else {
    frozen = <GeneratedBackdrop recipe="darkNoise" seed={seedOf(item.id)} />;
  }
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <AbsoluteFill style={{ filter: `saturate(${sat.toFixed(4)}) brightness(${bright.toFixed(4)}) contrast(${(1 + 0.12 * k).toFixed(4)})`, transform: `scale(${pushScale(c, 0.04).toFixed(5)})` }}>{frozen}</AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(0deg, ${rgba("#000000", 0.55 * k)} 0%, transparent 55%)` }} />
      <div style={{ position: "absolute", left: 110, bottom: 210, display: "flex", flexDirection: "column", gap: 8, transformOrigin: "0% 100%", transform: `scale(${(0.6 + 0.4 * pop).toFixed(5)}) rotate(-2deg)`, opacity: clamp01(pop * 2) }}>
        <div style={{ fontFamily: fontStack(env.tokens, "headline"), fontSize: size, lineHeight: 1, color: "#FFFFFF", filter: `drop-shadow(0 6px 24px ${rgba("#000000", 0.6)})` }}>{name}</div>
        {p.role ? (
          <div style={{ alignSelf: "flex-start", padding: "6px 16px", backgroundColor: accent, color: "#111", fontFamily: fontStack(env.tokens, "body"), fontWeight: 800, fontSize: 36 }}>{p.role}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
