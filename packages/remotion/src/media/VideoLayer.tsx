// VideoLayer (§10.7): @remotion/media <Video muted trimBefore> (frame-perfect, needs CORS + Range from the asset
// server). Clip video is ALWAYS muted; its audio is played by ClipAudio (preview) or the offline mixer (render).
import type React from "react";
import { Video } from "@remotion/media";
import type { NormPoint, NormRect } from "@docmaker/core";
import { useAsset, useEnv } from "../data/env";
import { coverRect, type Rect } from "../lib/geometry";

export interface VideoLayerProps {
  assetId: string;
  trimBefore: number;
  crop: NormRect | null;
  focal: NormPoint;
  fit?: "cover" | "fill";
  box?: Rect;
  style?: React.CSSProperties;
}

export const VideoLayer: React.FC<VideoLayerProps> = ({ assetId, trimBefore, crop, focal, fit = "cover", box, style }) => {
  const env = useEnv();
  const a = useAsset(assetId);
  const b = box ?? { left: 0, top: 0, width: env.width, height: env.height };
  if (!a.url) return <div style={{ position: "absolute", left: b.left, top: b.top, width: b.width, height: b.height, backgroundColor: env.tokens.tokens.palette.ink }} />;
  const r = fit === "cover" && a.width && a.height ? coverRect(a.width, a.height, b.width, b.height, crop, focal) : { left: 0, top: 0, width: b.width, height: b.height };
  const objectFit = fit === "cover" && !(a.width && a.height) ? "cover" : "fill";
  return (
    <div style={{ position: "absolute", left: b.left, top: b.top, width: b.width, height: b.height, overflow: "hidden", ...style }}>
      <Video
        src={a.url}
        muted
        trimBefore={Math.max(0, Math.round(trimBefore))}
        objectFit={objectFit}
        style={{ position: "absolute", left: r.left, top: r.top, width: r.width, height: r.height }}
      />
    </div>
  );
};
