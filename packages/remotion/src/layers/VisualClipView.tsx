// VisualClipView (§10.4): source (StillLayer | VideoLayer | GeneratedBackdrop) × layout (cover | contain-blur | card |
// pip | split) × treatment × camera (keys, kb/monotone ease, origin, blurFromPx, handheld) × velocity exit/entry.
// The camera runs on clip-local frames: localFrame = useCurrentFrame() − headHandle, so keys stay relative to the cut.
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { SeriesSeq, VelocityEdge } from "../compute/types";
import { useEnv } from "../data/env";
import { clipCameraAt } from "../lib/camera";
import { seedOf } from "../lib/random";
import { Treatment } from "../looks/Treatment";
import { CardFrame } from "../media/CardFrame";
import { ContainBlur } from "../media/ContainBlur";
import { PipFrame } from "../media/PipFrame";
import { SourceView } from "../media/SourceView";
import { SplitLayout } from "../media/SplitLayout";
import { NO_VELOCITY, velocityCss, velocityTransform, type VelocityXf } from "../transitions/velocity";

export function cameraCss(cam: { scale: number; x: number; y: number; rot: number; blurPx: number }, origin: { x: number; y: number }): React.CSSProperties {
  const t = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) rotate(${cam.rot.toFixed(4)}deg) scale(${cam.scale.toFixed(5)})`;
  return {
    transform: t,
    transformOrigin: `${(origin.x * 100).toFixed(3)}% ${(origin.y * 100).toFixed(3)}%`,
    filter: cam.blurPx > 0.05 ? `blur(${cam.blurPx.toFixed(2)}px)` : undefined,
  };
}

function combine(a: VelocityXf, b: VelocityXf): VelocityXf {
  if (a === NO_VELOCITY) return b;
  if (b === NO_VELOCITY) return a;
  return {
    scale: a.scale * b.scale, stretchX: a.stretchX * b.stretchX, stretchY: a.stretchY * b.stretchY,
    tx: a.tx + b.tx, ty: a.ty + b.ty, blurPx: a.blurPx + b.blurPx, opacity: a.opacity * b.opacity,
  };
}

export const VisualClipView: React.FC<{ seq: SeriesSeq; exit: VelocityEdge | null; entry: VelocityEdge | null }> = ({ seq, exit, entry }) => {
  const env = useEnv();
  const frame = useCurrentFrame();
  const clip = seq.clip;
  const local = frame - seq.headHandle;
  const cover = clip.layout === "cover" ? { width: env.width, height: env.height } : undefined;
  const cam = clipCameraAt(clip.camera, local, env.tokens.motion, { fps: env.fps, seed: seedOf(clip.id), cover });
  const cameraStyle = cameraCss(cam, clip.camera.origin);
  const fullFrame = clip.layout === "cover" || clip.layout === "contain-blur";
  let vx: VelocityXf = NO_VELOCITY;
  if (exit) vx = combine(vx, velocityTransform(exit, "exit", local - clip.dur, { width: env.width, height: env.height, fullFrame }));
  if (entry) vx = combine(vx, velocityTransform(entry, "entry", local, { width: env.width, height: env.height, fullFrame }));
  const v = velocityCss(vx);

  let body: React.ReactNode;
  switch (clip.layout) {
    case "card":
      body = <CardFrame clip={clip} trimBefore={seq.trimBefore} localFrame={local} cameraStyle={cameraStyle} />;
      break;
    case "contain-blur":
      body = <ContainBlur clip={clip} trimBefore={seq.trimBefore} localFrame={local} cameraStyle={cameraStyle} />;
      break;
    case "pip":
      body = <PipFrame clip={clip} trimBefore={seq.trimBefore} localFrame={local} cameraStyle={cameraStyle} />;
      break;
    case "split-left":
    case "split-right":
      body = <SplitLayout clip={clip} side={clip.layout === "split-left" ? "left" : "right"} trimBefore={seq.trimBefore} localFrame={local} cameraStyle={cameraStyle} />;
      break;
    default:
      body = (
        <AbsoluteFill style={cameraStyle}>
          <Treatment kind={clip.treatment} grade={env.grade} seedKey={clip.id} localFrame={local}>
            <SourceView source={clip.source} trimBefore={seq.trimBefore} />
          </Treatment>
        </AbsoluteFill>
      );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: env.tokens.tokens.palette.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: v.transform, filter: v.filter, opacity: v.opacity }}>{body}</AbsoluteFill>
    </AbsoluteFill>
  );
};
