// "SCRATCH VO" banner (preview only): the timeline was built from a scratch take; the narration is a placeholder.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";

export const ScratchBanner: React.FC = () => {
  const env = useEnv();
  const label = env.lang === "fr" ? "VOIX TÉMOIN · SCRATCH VO" : "SCRATCH VO";
  return (
    <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center" }}>
      <div
        style={{
          marginTop: 18, padding: "6px 16px", borderRadius: 6, backgroundColor: rgba(env.tokens.tokens.palette.danger, 0.9), color: "#FFFFFF",
          fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: 22, letterSpacing: "0.18em",
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
