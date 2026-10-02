// DateStamp (M1): typewriter 2 f/char, mono, top-left (or top-right); blinking block caret; fades out over exitFrames.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { upper } from "../lib/text";
import { useItemClock, useZone, type ComponentProps } from "./shared";

export const TYPE_FRAMES_PER_CHAR = 2;

export const DateStamp: React.FC<ComponentProps<"DateStamp">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const z = useZone(p.zone);
  const pal = env.tokens.tokens.palette;
  const text = upper(p.text, env.locale);
  const n = Math.min(text.length, Math.floor(Math.max(0, c.f) / TYPE_FRAMES_PER_CHAR) + 1);
  const typing = n < text.length;
  const caret = typing || Math.floor(c.f / 9) % 2 === 0;
  const right = p.zone === "topRight";
  const size = Math.round(env.tokens.tokens.typeRamp.label * 1.55);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 1 - c.outP }}>
      <div style={{ position: "absolute", left: z.left, top: z.top, width: z.width, height: z.height, display: "flex", alignItems: "center", justifyContent: right ? "flex-end" : "flex-start" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", backgroundColor: rgba(pal.ink, 0.72),
            borderLeft: right ? undefined : `4px solid ${accentOf(env.tokens)}`, borderRight: right ? `4px solid ${accentOf(env.tokens)}` : undefined,
          }}
        >
          <span style={{ fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: size, letterSpacing: "0.08em", color: pal.text, whiteSpace: "pre", display: "flex", alignItems: "center" }}>
            {text.slice(0, n)}
            <span style={{ display: "inline-block", width: Math.round(size * 0.55), height: Math.round(size * 0.9), marginLeft: 4, backgroundColor: accentOf(env.tokens), opacity: caret ? 1 : 0 }} />
            <span style={{ visibility: "hidden" }}>{text.slice(n)}</span>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
