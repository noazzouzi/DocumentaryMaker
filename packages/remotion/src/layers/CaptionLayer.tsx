// CaptionLayer (§10.8): burned groups only (srt groups are never rendered), one Sequence per group, by variant.
import type React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import type { CaptionGroup } from "@docmaker/core";
import { ClipSubtitles } from "../captions/ClipSubtitles";
import { KaraokeCaptions } from "../captions/KaraokeCaptions";
import { KeywordCaptions } from "../captions/KeywordCaptions";
import { KineticCaptions } from "../captions/KineticCaptions";
import { RailCaptions } from "../captions/RailCaptions";
import { useEnv } from "../data/env";

const VARIANT: Record<string, React.FC<{ group: CaptionGroup }>> = {
  keywords: KeywordCaptions, pop: KineticCaptions, karaoke: KaraokeCaptions, rail: RailCaptions, clip: ClipSubtitles, translation: ClipSubtitles,
};

export const CaptionLayer: React.FC<{ groups: readonly CaptionGroup[] }> = ({ groups }) => {
  const env = useEnv();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {groups.map((g) => {
        if (!g.burn || g.variant === "srt") return null;
        const C = VARIANT[g.variant] ?? KineticCaptions;
        return (
          <Sequence key={g.id} from={g.from} durationInFrames={Math.max(1, g.dur)} premountFor={env.fps} name={g.id}>
            <C group={g} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
