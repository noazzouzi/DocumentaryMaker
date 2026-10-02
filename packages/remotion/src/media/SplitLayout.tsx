// SplitLayout — layouts "split-left" / "split-right": the clip cover-fits one half, the other half shows the style
// backdrop (room for a graphic or label); a 4 px divider in the accent colour. The camera moves the clip inside its half.
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { VisualClip } from "@docmaker/core";
import { accentOf, useEnv } from "../data/env";
import { Treatment } from "../looks/Treatment";
import { GeneratedBackdrop } from "./GeneratedBackdrop";
import { SourceView } from "./SourceView";

export const SplitLayout: React.FC<{ clip: VisualClip; side: "left" | "right"; trimBefore: number; localFrame: number; cameraStyle: React.CSSProperties }> = ({ clip, side, trimBefore, localFrame, cameraStyle }) => {
  const env = useEnv();
  const half = env.width / 2;
  const clipLeft = side === "left" ? 0 : half;
  const recipe = env.tokens.tokens.backdrop === "blurSelf" ? "darkNoise" : env.tokens.tokens.backdrop;
  return (
    <AbsoluteFill>
      <GeneratedBackdrop recipe={recipe} seed={clip.layoutParams?.backdropSeed ?? clip.from} />
      <div style={{ position: "absolute", left: clipLeft, top: 0, width: half, height: env.height, overflow: "hidden" }}>
        <AbsoluteFill style={cameraStyle}>
          <Treatment kind={clip.treatment} grade={env.grade} seedKey={clip.id} localFrame={localFrame}>
            <SourceView source={clip.source} trimBefore={trimBefore} box={{ left: 0, top: 0, width: half, height: env.height }} />
          </Treatment>
        </AbsoluteFill>
      </div>
      <div style={{ position: "absolute", left: half - 2, top: 0, width: 4, height: env.height, backgroundColor: accentOf(env.tokens) }} />
    </AbsoluteFill>
  );
};
