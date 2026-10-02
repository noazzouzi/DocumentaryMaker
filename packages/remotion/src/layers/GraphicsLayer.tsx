// GraphicsLayer / OverlayBand / HudLayer (§10.4).
//  - graphics: NOT shaken by the camera, except followsCamera items get the punch/zoom part of "picture+followers" cues
//    and cues with target "all" (impact shakes on slams) move the whole layer;
//  - picture band (SplitScreen, Spotlight, CensorBar, FreezeLabel): rendered inside the camera rig and the grade;
//  - hud (SourceLabel, Letterbox, grade.letterbox bars): never moved by fx.
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { OverlayItem } from "@docmaker/core";
import { useEnv, useDocState } from "../data/env";
import { LetterboxBars } from "../looks/Letterbox";
import { sampleStyle, SELECT, useCameraSample } from "./CameraRig";
import { OverlayItemView } from "./OverlayItemView";

export const GraphicsLayer: React.FC<{ items: readonly OverlayItem[] }> = ({ items }) => {
  const env = useEnv();
  const layer = useCameraSample(SELECT.graphicsLayer, false);
  const follow = useCameraSample(SELECT.followers, false);
  const layerStyle = layer ? sampleStyle(layer, env.width, env.height) : undefined;
  const followStyle = follow ? sampleStyle(follow, env.width, env.height) : undefined;
  return (
    <AbsoluteFill style={layerStyle}>
      {items.map((it) => (
        <OverlayItemView key={it.id} item={it} premount={env.fps} wrapStyle={it.followsCamera ? followStyle : undefined} />
      ))}
    </AbsoluteFill>
  );
};

export const OverlayBand: React.FC<{ items: readonly OverlayItem[] }> = ({ items }) => {
  const env = useEnv();
  return (
    <AbsoluteFill>
      {items.map((it) => (
        <OverlayItemView key={it.id} item={it} premount={env.fps} />
      ))}
    </AbsoluteFill>
  );
};

export const HudLayer: React.FC<{ items: readonly OverlayItem[] }> = ({ items }) => {
  const env = useEnv();
  const doc = useDocState();
  const lb = doc?.t.grade.letterbox ?? null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {lb ? <LetterboxBars ratio={lb} /> : null}
      {items.map((it) => (
        <OverlayItemView key={it.id} item={it} premount={env.fps} />
      ))}
    </AbsoluteFill>
  );
};
