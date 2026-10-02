// Documentary (§10.4): the full layer tree driven by one Timeline.
//   picture (grade → signal damage → camera rig → chapter TransitionSeries + picture-band overlays; split-tone, vignette;
//   flash/dark) → covers → graphics (+ target-"all" light) → captions (burn) → HUD → [preview] scratch banner, audio.
// DocumentaryOverlay = the same tree with layers.picture = false on a transparent background. With `itemId` set, only
// that overlay item renders (OverlayItem composition, ProRes 4444 export, M3).
import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import type { Timeline } from "@docmaker/core";
import { computeTimeline, pictureParts } from "./compute/computeTimeline";
import { DocProvider, EnvProvider, envFromTimeline, type DocState } from "./data/env";
import { useTimeline } from "./data/useTimeline";
import { FontGate } from "./fonts/FontGate";
import type { DocProps } from "./index";
import { AudioLayer } from "./layers/AudioLayer";
import { CameraRig } from "./layers/CameraRig";
import { CaptionLayer } from "./layers/CaptionLayer";
import { PictureTrack } from "./layers/ChapterSeries";
import { CoverLayer } from "./layers/CoverLayer";
import { FxLightAllLayer, FxLightLayer, SignalDamage } from "./layers/FxLightLayer";
import { GraphicsLayer, HudLayer, OverlayBand } from "./layers/GraphicsLayer";
import { OverlayItemView } from "./layers/OverlayItemView";
import { ScratchBanner } from "./layers/ScratchBanner";
import { GradeLayer, SplitTone } from "./looks/Grade";
import { Vignette } from "./looks/Vignette";

export const DEFAULT_LAYERS: DocProps["layers"] = { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: true };
const EMPTY_BG = "#0B0B0D";

const DocumentaryBody: React.FC<{ t: Timeline; props: DocProps }> = ({ t, props }) => {
  const ct = useMemo(() => computeTimeline(t), [t]);
  const doc = useMemo((): DocState => ({ t, ct, parts: pictureParts(ct) }), [t, ct]);
  const env = useMemo(() => envFromTimeline(t, props.assetBaseUrl ?? "", props.mode === "preview" ? "preview" : "render"), [t, props.assetBaseUrl, props.mode]);
  const L = { ...DEFAULT_LAYERS, ...(props.layers ?? {}) };
  const preview = env.mode === "preview";

  if (props.itemId) {
    const item = t.overlays.find((o) => o.id === props.itemId) ?? null;
    return (
      <EnvProvider value={env}>
        <DocProvider value={doc}>
          <AbsoluteFill>
            <FontGate styleFonts={t.render.fonts} base={env.base}>
              {item ? <OverlayItemView item={item} premount={env.fps} from={0} /> : null}
            </FontGate>
          </AbsoluteFill>
        </DocProvider>
      </EnvProvider>
    );
  }

  return (
    <EnvProvider value={env}>
      <DocProvider value={doc}>
        <AbsoluteFill style={{ backgroundColor: L.picture ? t.render.tokens.palette.ink : undefined }}>
          <FontGate styleFonts={t.render.fonts} base={env.base}>
            {L.picture ? (
              <GradeLayer>
                <SignalDamage>
                  <CameraRig>
                    <PictureTrack ct={ct} />
                    <OverlayBand items={ct.overlays.picture} />
                  </CameraRig>
                  <SplitTone />
                  <Vignette />
                </SignalDamage>
                <FxLightLayer />
              </GradeLayer>
            ) : null}
            {L.covers ? <CoverLayer covers={ct.covers} /> : null}
            {L.graphics ? <GraphicsLayer items={ct.overlays.graphics} /> : null}
            {L.graphics || L.picture ? <FxLightAllLayer /> : null}
            {L.captions && t.captionsMode === "burn" ? <CaptionLayer groups={ct.captions} /> : null}
            {L.hud ? <HudLayer items={ct.overlays.hud} /> : null}
            {preview && props.scratchBanner ? <ScratchBanner /> : null}
            {preview && L.audio ? <AudioLayer /> : null}
          </FontGate>
        </AbsoluteFill>
      </DocProvider>
    </EnvProvider>
  );
};

export const Documentary: React.FC<DocProps> = (props) => {
  const t = useTimeline(props);
  if (!t) return <AbsoluteFill style={{ backgroundColor: props.layers?.picture === false ? undefined : EMPTY_BG }} />;
  return <DocumentaryBody t={t} props={props} />;
};
