// AudioLayer (preview only, §10.4/§4.18): @remotion/media <Audio> with the SAME gain tables as the offline mixer.
// voProgram at 0 dB × G.vo; music sections (loop, trimBefore); SFX (loop, fades); clip audio (ducked when duckUnderVo,
// silences such as bleeps always):
// volume(f) = table[min(N−1, item.from + f)] · dbToGain(item.gainDb) · itemEnvelope(item, f).
// Pan is not available in @remotion/media: SFX pans and RL sweeps are heard only in the final mix.
import type React from "react";
import { useMemo } from "react";
import { Sequence } from "remotion";
import { Audio } from "@remotion/media";
import { computeGainTables, dbToGain, itemEnvelope } from "@docmaker/core";
import { useDocState, useEnv } from "../data/env";
import { assetUrl } from "../lib/assetUrl";

const clampVol = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export const AudioLayer: React.FC = () => {
  const doc = useDocState();
  const env = useEnv();
  const gains = useMemo(() => (doc ? computeGainTables(doc.t) : null), [doc]);
  if (!doc || !gains) return null;
  const t = doc.t;
  const N = Math.max(1, gains.length);
  const at = (table: Float32Array, i: number) => table[Math.min(N - 1, Math.max(0, i))] ?? 1;
  const url = (id: string) => assetUrl(t, id, env.base);
  const vo = url(t.audio.voProgram.assetId);
  return (
    <>
      {vo ? (
        <Sequence durationInFrames={N} name="vo program">
          <Audio src={vo} volume={(f) => clampVol(at(gains.vo, f))} />
        </Sequence>
      ) : null}
      {t.audio.music.map((m) => {
        const src = url(m.assetId);
        if (!src || m.dur <= 0) return null;
        return (
          <Sequence key={m.id} from={m.from} durationInFrames={m.dur} premountFor={env.fps} name={m.id}>
            <Audio src={src} trimBefore={m.sourceInFrames} loop={m.loop} volume={(f) => clampVol(at(gains.music, m.from + f) * dbToGain(m.gainDb) * itemEnvelope(m, f))} />
          </Sequence>
        );
      })}
      {t.audio.sfx.map((s) => {
        const src = url(s.assetId);
        if (!src || s.dur <= 0) return null;
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.dur} premountFor={env.fps} name={s.id}>
            <Audio src={src} loop={s.loop} volume={(f) => clampVol(at(gains.sfx, s.from + f) * dbToGain(s.gainDb) * itemEnvelope(s, f))} />
          </Sequence>
        );
      })}
      {t.audio.clip.map((c) => {
        const src = url(c.assetId);
        if (!src || c.dur <= 0) return null;
        return (
          <Sequence key={c.id} from={c.from} durationInFrames={c.dur} premountFor={env.fps} name={c.id}>
            {/* not ducked: only the silence mask applies (silences are exact zeros in the table; ducking never reaches 0) */}
            <Audio src={src} trimBefore={c.sourceInFrames} volume={(f) => {
              const g = at(gains.clip, c.from + f);
              return clampVol((c.duckUnderVo ? g : g === 0 ? 0 : 1) * dbToGain(c.gainDb));
            }} />
          </Sequence>
        );
      })}
    </>
  );
};
