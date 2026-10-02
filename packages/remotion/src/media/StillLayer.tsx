// StillLayer (§10.7): <Img> cover-fit on the source crop rect (else around the focal point) inside a box. With unknown
// source dimensions it falls back to CSS object-fit/object-position.
import type React from "react";
import { Img } from "remotion";
import type { NormPoint, NormRect } from "@docmaker/core";
import { useAsset, useEnv } from "../data/env";
import { coverRect, objectPosition, type Rect } from "../lib/geometry";

export interface StillLayerProps {
  assetId: string;
  crop: NormRect | null;
  focal: NormPoint;
  /** "cover": fill the box (crop/focal); "fill": the box already has the image aspect (cards, frames). */
  fit?: "cover" | "fill";
  box?: Rect;
  style?: React.CSSProperties;
}

export const StillLayer: React.FC<StillLayerProps> = ({ assetId, crop, focal, fit = "cover", box, style }) => {
  const env = useEnv();
  const a = useAsset(assetId);
  const b = box ?? { left: 0, top: 0, width: env.width, height: env.height };
  if (!a.url) return <div style={{ position: "absolute", left: b.left, top: b.top, width: b.width, height: b.height, backgroundColor: env.tokens.tokens.palette.ink }} />;
  const onImageError = env.mode === "preview" ? () => undefined : undefined;
  let img: React.ReactNode;
  if (fit === "fill") {
    img = <Img src={a.url} onImageError={onImageError} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: objectPosition(focal) }} />;
  } else if (a.width && a.height) {
    const r = coverRect(a.width, a.height, b.width, b.height, crop, focal);
    img = <Img src={a.url} onImageError={onImageError} style={{ position: "absolute", left: r.left, top: r.top, width: r.width, height: r.height, maxWidth: "none" }} />;
  } else {
    img = <Img src={a.url} onImageError={onImageError} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: objectPosition(focal) }} />;
  }
  return <div style={{ position: "absolute", left: b.left, top: b.top, width: b.width, height: b.height, overflow: "hidden", ...style }}>{img}</div>;
};
