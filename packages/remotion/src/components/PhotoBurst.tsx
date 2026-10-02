// PhotoBurst (M2): framed photos land at items[].at (accelerating 8→5 f apart), each tilted and placed at (x, y); the
// whole group scales scaleFrom → scaleTo over the item; the last photo holds; optional caption chip.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { FramedPhoto, useAspect } from "./parts";
import { useItemClock, type ComponentProps } from "./shared";

const Card: React.FC<{ assetId: string; x: number; y: number; tilt: number; t: number; seed: number }> = ({ assetId, x, y, tilt, t, seed }) => {
  const aspect = useAspect(assetId, 4 / 3);
  const h = aspect >= 1 ? 470 : 560;
  const w = Math.min(820, h * aspect);
  const p = expoOut(clamp01(t / 5));
  return (
    <div style={{ position: "absolute", left: x - w / 2 - 12, top: y - h / 2 - 12, transform: `translateY(${(-40 * (1 - p)).toFixed(2)}px) scale(${(1.18 - 0.18 * p).toFixed(5)})`, opacity: clamp01(t / 2 + 0.2) }}>
      <FramedPhoto assetId={assetId} width={w} height={(w / aspect) | 0} border={12} tiltDeg={tilt} seed={seed} />
    </div>
  );
};

export const PhotoBurst: React.FC<ComponentProps<"PhotoBurst">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const seed = seedOf(item.id);
  const scale = p.scaleFrom + (p.scaleTo - p.scaleFrom) * c.hold;
  const last = p.items[p.items.length - 1];
  const captionIn = last ? clamp01((c.f - last.at - 4) / 8) : 0;
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="gradientGrid" seed={seed} />
      <AbsoluteFill style={{ transform: `scale(${scale.toFixed(5)})` }}>
        {p.items.map((it, i) => {
          const t = c.f - it.at;
          if (t < 0) return null;
          return <Card key={i} assetId={it.assetId} x={it.x * env.width} y={it.y * env.height} tilt={it.tiltDeg} t={t} seed={seed + i} />;
        })}
      </AbsoluteFill>
      {p.caption ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 150, display: "flex", justifyContent: "center", opacity: captionIn }}>
          <span style={{ padding: "10px 26px", backgroundColor: rgba(env.tokens.tokens.palette.ink, 0.85), color: env.tokens.tokens.palette.text, fontFamily: fontStack(env.tokens, "headline"), fontSize: 60, borderLeft: `6px solid ${accentOf(env.tokens)}` }}>
            {p.caption.toLocaleUpperCase(env.locale)}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
