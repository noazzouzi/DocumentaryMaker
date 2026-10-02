// PipFrame — layout "pip", the commentary frame (§10.7): the clip at heightFrac of the WIDTH (76 %), 16:9, radius 24 px,
// stroke (4 px accent or white), glow + shadow, tilt ±2°; entry scale (0.9→1, 10 f) / tvOn / slide; backdrop blurSelf /
// gradientGrid / paper; sourceLabel chip bottom-left.
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { LayoutParams, VisualClip } from "@docmaker/core";
import { fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { Treatment } from "../looks/Treatment";
import { frameEntryStyle, LayoutBackdrop } from "./frames";
import { SourceView } from "./SourceView";

export const DEFAULT_PIP: LayoutParams = { backdrop: "blurSelf", heightFrac: 0.76, borderPx: 0, tiltDeg: 0, shadow: true, stroke: null, entry: "scale", backdropSeed: 0 };

export const PipFrame: React.FC<{ clip: VisualClip; trimBefore: number; localFrame: number; cameraStyle: React.CSSProperties }> = ({ clip, trimBefore, localFrame, cameraStyle }) => {
  const env = useEnv();
  const lp = clip.layoutParams ?? { ...DEFAULT_PIP, backdropSeed: clip.from };
  const W = env.width;
  const H = env.height;
  const width = Math.min(0.95, Math.max(0.4, lp.heightFrac)) * W;
  const height = (width * 9) / 16;
  const left = (W - width) / 2;
  const top = Math.max(24, (H - height) / 2 - 10);
  const stroke = lp.stroke ?? "#FFFFFF";
  const tilt = Math.max(-2, Math.min(2, lp.tiltDeg));
  const entry = frameEntryStyle(lp.entry, localFrame);
  const p = env.tokens.tokens.palette;
  return (
    <AbsoluteFill>
      <LayoutBackdrop recipe={lp.backdrop} seed={lp.backdropSeed} source={clip.source} trimBefore={trimBefore} />
      <AbsoluteFill style={{ transform: entry.transform, opacity: entry.opacity, filter: entry.filter }}>
        <div
          style={{
            position: "absolute", left, top, width, height, borderRadius: 24, overflow: "hidden",
            transform: `rotate(${tilt.toFixed(3)}deg)`,
            boxShadow: lp.shadow ? `0 0 0 4px ${stroke}, 0 0 48px ${rgba(stroke, 0.35)}, 0 30px 60px ${rgba("#000000", 0.75)}` : `0 0 0 4px ${stroke}`,
            backgroundColor: "#000",
          }}
        >
          <AbsoluteFill style={cameraStyle}>
            <Treatment kind={clip.treatment} grade={env.grade} seedKey={clip.id} localFrame={localFrame}>
              <SourceView source={clip.source} trimBefore={trimBefore} box={{ left: 0, top: 0, width, height }} />
            </Treatment>
          </AbsoluteFill>
          {clip.sourceLabel ? (
            <div
              style={{
                position: "absolute", left: 20, bottom: 18, padding: "8px 14px", borderRadius: 8, backgroundColor: rgba(p.ink, 0.78),
                color: p.text, fontFamily: fontStack(env.tokens, "mono"), fontSize: 22, letterSpacing: "0.04em", maxWidth: width - 40,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {clip.sourceLabel}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
