// ContainBlur — layout "contain-blur" (§10.7): the same source at 1.2× with blur(30px) brightness(.4) behind a
// contain-fit copy (portraits, odd aspect ratios, footage that must not be cropped). The camera moves the sharp copy.
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { VisualClip } from "@docmaker/core";
import { useAsset, useEnv } from "../data/env";
import { containRect } from "../lib/geometry";
import { Treatment } from "../looks/Treatment";
import { BlurSelf } from "./frames";
import { SourceView, sourceAssetId } from "./SourceView";

export const ContainBlur: React.FC<{ clip: VisualClip; trimBefore: number; localFrame: number; cameraStyle: React.CSSProperties }> = ({ clip, trimBefore, localFrame, cameraStyle }) => {
  const env = useEnv();
  const a = useAsset(sourceAssetId(clip.source));
  const box = { left: 0, top: 0, width: env.width, height: env.height };
  const r = a.width && a.height ? containRect(a.width, a.height, box) : box;
  return (
    <AbsoluteFill style={{ backgroundColor: env.tokens.tokens.palette.ink }}>
      <BlurSelf source={clip.source} trimBefore={trimBefore} />
      <AbsoluteFill style={cameraStyle}>
        <Treatment kind={clip.treatment} grade={env.grade} seedKey={clip.id} localFrame={localFrame}>
          <SourceView source={clip.source} trimBefore={trimBefore} fit="fill" box={r} />
        </Treatment>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
