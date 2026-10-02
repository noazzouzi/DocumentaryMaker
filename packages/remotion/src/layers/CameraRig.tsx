// CameraRig (§10.6): ONE transform on the picture subtree from every live fx cue (punch/zoom/shake/blur) and the cut
// pulses. Origins per cue = (x, y) when set, else the current clip's camera origin. A timeline without fx renders
// like a plain render (identity → no transform, no filter).
import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { FxCue, VisualClip } from "@docmaker/core";
import { partIndexAt } from "../compute/computeTimeline";
import { useDocState, useEnv } from "../data/env";
import { cameraMatrix, cameraStateAt, isIdentity, type CameraSample, type CuePart, type Origin } from "../fx/cameraState";

export function originLookup(parts: readonly VisualClip[]): (f: number) => Origin {
  return (f: number) => {
    const c = parts[partIndexAt(parts, f)];
    return c ? c.camera.origin : { x: 0.5, y: 0.5 };
  };
}

/** Which cue parts reach each target (§10.6). */
export const SELECT = {
  picture: (_c: FxCue): CuePart | null => "all",
  followers: (c: FxCue): CuePart | null => (c.target === "picture+followers" ? "zoomOnly" : null),
  graphicsLayer: (c: FxCue): CuePart | null => (c.target === "all" ? "all" : null),
};

export function sampleStyle(s: CameraSample, width: number, height: number): React.CSSProperties | undefined {
  if (isIdentity(s) && s.blurPx <= 0.05) return undefined;
  return {
    transform: isIdentity(s) ? undefined : cameraMatrix(s, width, height),
    transformOrigin: "0 0",
    filter: s.blurPx > 0.05 ? `blur(${s.blurPx.toFixed(2)}px)` : undefined,
  };
}

export function useCameraSample(select: (c: FxCue) => CuePart | null, withPulses: boolean): CameraSample | null {
  const doc = useDocState();
  const env = useEnv();
  const f = useCurrentFrame();
  const originAt = useMemo(() => (doc ? originLookup(doc.parts) : () => ({ x: 0.5, y: 0.5 })), [doc]);
  if (!doc) return null;
  return cameraStateAt({ fx: doc.ct.fx, pulses: withPulses ? doc.ct.pulses : undefined, f, fps: env.fps, width: env.width, height: env.height, originAt, select });
}

export const CameraRig: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const env = useEnv();
  const s = useCameraSample(SELECT.picture, true);
  const style = s ? sampleStyle(s, env.width, env.height) : undefined;
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
