// CensorBar (M2, picture band — moves with the picture fx): hides a normalised rect with a black bar, a pixel mosaic
// (the source drawn at 1/16 scale into a CPU canvas and scaled up with image-rendering: pixelated) or a heavy blur of
// the current shot. Mosaic needs an image source; other sources fall back to blur. Optional label.
import type React from "react";
import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame } from "remotion";
import type { VisualClip } from "@docmaker/core";
import { partIndexAt } from "../compute/computeTimeline";
import { fontStack, useAsset, useDocState, useEnv } from "../data/env";
import { coverRect } from "../lib/geometry";
import { SourceView } from "../media/SourceView";
import { useItemClock, type ComponentProps } from "./shared";

const MOSAIC = 16;

/** The picture clip under the item at its current frame (null outside a Documentary). */
function useClipUnder(itemFrom: number): VisualClip | null {
  const doc = useDocState();
  const f = useCurrentFrame();
  if (!doc) return null;
  return doc.parts[partIndexAt(doc.parts, itemFrom + f)] ?? null;
}

const Mosaic: React.FC<{ url: string; srcW: number; srcH: number; clip: VisualClip; rect: { x: number; y: number; w: number; h: number } }> = ({ url, srcW, srcH, clip, rect }) => {
  const env = useEnv();
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = Math.max(1, Math.round(rect.w / MOSAIC));
  const ch = Math.max(1, Math.round(rect.h / MOSAIC));
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const handle = delayRender(`censor mosaic ${url}`);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ctx = cv.getContext("2d", { willReadFrequently: true }); // software canvas: bit-reproducible
      if (ctx) {
        const src = clip.source.kind === "image" ? clip.source : null;
        const r = coverRect(srcW, srcH, env.width, env.height, src?.crop ?? null, src?.focal ?? { x: 0.5, y: 0.5 });
        const k = r.width / srcW;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (rect.x - r.left) / k, (rect.y - r.top) / k, rect.w / k, rect.h / k, 0, 0, cw, ch);
      }
      finish();
    };
    img.onerror = finish;
    img.src = url;
    return finish;
  }, [url, srcW, srcH, clip, rect.x, rect.y, rect.w, rect.h, cw, ch, env.width, env.height]);
  return <canvas ref={ref} width={cw} height={ch} style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, imageRendering: "pixelated" }} />;
};

export const CensorBar: React.FC<ComponentProps<"CensorBar">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const rect = { x: p.rect.x * env.width, y: p.rect.y * env.height, w: Math.max(1, p.rect.w * env.width), h: Math.max(1, p.rect.h * env.height) };
  const clip = useClipUnder(item.from);
  const imgAsset = useAsset(clip?.source.kind === "image" ? clip.source.assetId : null);
  let mode = p.mode;
  if (mode === "pixelate" && !(imgAsset.url && imgAsset.width && imgAsset.height && clip)) mode = "blur";
  if (mode === "blur" && !clip) mode = "bar";
  const trimBefore = clip && clip.source.kind === "video" ? clip.source.sourceInFrames + (item.from - clip.from) : 0;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {mode === "bar" ? <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, backgroundColor: "#000000" }} /> : null}
      {mode === "pixelate" && clip && imgAsset.url ? <Mosaic url={imgAsset.url} srcW={imgAsset.width!} srcH={imgAsset.height!} clip={clip} rect={rect} /> : null}
      {mode === "blur" && clip ? (
        <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: -rect.x, top: -rect.y, width: env.width, height: env.height, filter: "blur(28px) brightness(0.9)" }}>
            <SourceView source={clip.source} trimBefore={trimBefore} />
          </div>
        </div>
      ) : null}
      {p.label ? (
        <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: Math.max(16, Math.min(40, rect.h * 0.35)), color: "#FFFFFF", letterSpacing: "0.14em", textShadow: "0 0 8px #000", opacity: c.inP }}>
            {p.label.toLocaleUpperCase(env.locale)}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
