// CardFrame — layout "card" (§10.7): the photo contain-fit at heightFrac·1080 px, borderPx white border, tiltDeg, shadow
// (offsetY 35, blur 60, opacity .9) over a backdrop that drifts on its own; the camera keys move the CARD, not the
// backdrop (parallax for free).
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { LayoutParams, VisualClip } from "@docmaker/core";
import { useAsset, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { cardRect } from "../lib/geometry";
import { Treatment } from "../looks/Treatment";
import { frameEntryStyle, LayoutBackdrop } from "./frames";
import { SourceView, sourceAssetId } from "./SourceView";

export const DEFAULT_CARD: LayoutParams = { backdrop: "gradientGrid", heightFrac: 0.78, borderPx: 12, tiltDeg: -1.5, shadow: true, stroke: null, entry: "scale", backdropSeed: 0 };

export const CardFrame: React.FC<{ clip: VisualClip; trimBefore: number; localFrame: number; cameraStyle: React.CSSProperties }> = ({ clip, trimBefore, localFrame, cameraStyle }) => {
  const env = useEnv();
  const lp = clip.layoutParams ?? { ...DEFAULT_CARD, backdropSeed: clip.from };
  const a = useAsset(sourceAssetId(clip.source));
  const border = Math.max(0, lp.borderPx);
  const r = cardRect(a.width, a.height, env.width, env.height, lp.heightFrac, border);
  const sh = env.tokens.stills.shadow;
  const entry = frameEntryStyle(lp.entry, localFrame);
  return (
    <AbsoluteFill>
      <LayoutBackdrop recipe={lp.backdrop} seed={lp.backdropSeed} source={clip.source} trimBefore={trimBefore} />
      <AbsoluteFill style={cameraStyle}>
        <AbsoluteFill style={{ transform: entry.transform, opacity: entry.opacity, filter: entry.filter }}>
          <div
            style={{
              position: "absolute",
              left: r.left - border,
              top: r.top - border,
              width: r.width + 2 * border,
              height: r.height + 2 * border,
              backgroundColor: "#FFFFFF",
              transform: `rotate(${lp.tiltDeg.toFixed(3)}deg)`,
              boxShadow: lp.shadow ? `0 ${sh.offsetY}px ${sh.blurPx}px ${rgba("#000000", sh.opacity)}` : undefined,
            }}
          >
            <div style={{ position: "absolute", left: border, top: border, width: r.width, height: r.height, overflow: "hidden", backgroundColor: "#111" }}>
              <Treatment kind={clip.treatment} grade={env.grade} seedKey={clip.id} localFrame={localFrame}>
                <SourceView source={clip.source} trimBefore={trimBefore} fit="fill" box={{ left: 0, top: 0, width: r.width, height: r.height }} />
              </Treatment>
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
