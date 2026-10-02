// Remotion root (P0 skeleton; W7 owns it from P1). Registers every COMPOSITION_IDS entry; the Documentary
// compositions size themselves from the Timeline (inline or timelineUrl) in calculateMetadata.
import type React from "react";
import { AbsoluteFill, Composition, type CalculateMetadataFunction } from "remotion";
import { BUILTIN_FONTS, FONT_TEST_STRING, type Timeline } from "@docmaker/core";
import "./fonts/fonts.css";
import { Documentary } from "./Documentary";
import { COMPOSITION_IDS, type DocProps } from "./index";

/** DocProps as a type literal (Remotion props must be a Record<string, unknown>). */
type DocPropsShape = Pick<DocProps, keyof DocProps>;

export const DEFAULT_DOC_PROPS: DocPropsShape = {
  timeline: null,
  timelineUrl: null,
  assetBaseUrl: "",
  mode: "render",
  layers: { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: true },
  itemId: null,
  scratchBanner: false,
};

export const calculateDocMetadata: CalculateMetadataFunction<DocPropsShape> = async ({ props, abortSignal }) => {
  let t: Timeline | null = props.timeline;
  if (!t && props.timelineUrl) {
    const r = await fetch(props.timelineUrl, { signal: abortSignal });
    if (!r.ok) throw new Error(`timeline fetch failed: HTTP ${r.status}`);
    t = (await r.json()) as Timeline;
  }
  if (!t) return { durationInFrames: 1, fps: 30, width: 1920, height: 1080 };
  return { durationInFrames: t.durationInFrames, fps: t.fps, width: t.width, height: t.height };
};

const DocumentaryComposition: React.FC<DocPropsShape> = (p) => <Documentary {...p} />;

const Placeholder: React.FC<{ label: string }> = ({ label }) => (
  <AbsoluteFill style={{ backgroundColor: "#0B0B0D", color: "#F5F1E8", alignItems: "center", justifyContent: "center", fontSize: 64 }}>{label}</AbsoluteFill>
);

const FontSpecimen: React.FC<Record<string, unknown>> = () => (
  <AbsoluteFill style={{ backgroundColor: "#F5F1E8", color: "#0B0B0D", padding: 48, gap: 12 }}>
    {BUILTIN_FONTS.flatMap((f) =>
      f.weights.map((w) => (
        <div key={`${f.family}-${w}`} style={{ fontFamily: `"${f.family}"`, fontWeight: w, fontSize: 44 }}>{`${f.family} ${w} — ${FONT_TEST_STRING}`}</div>
      )),
    )}
  </AbsoluteFill>
);

export const Root: React.FC = () => (
  <>
    <Composition id={COMPOSITION_IDS.doc} component={DocumentaryComposition} defaultProps={DEFAULT_DOC_PROPS} calculateMetadata={calculateDocMetadata} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.overlay} component={DocumentaryComposition} defaultProps={{ ...DEFAULT_DOC_PROPS, layers: { ...DEFAULT_DOC_PROPS.layers, picture: false } }} calculateMetadata={calculateDocMetadata} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.item} component={DocumentaryComposition} defaultProps={DEFAULT_DOC_PROPS} calculateMetadata={calculateDocMetadata} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.still} component={Placeholder} defaultProps={{ label: "GeneratedStill" }} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.gl} component={Placeholder} defaultProps={{ label: "GlProbe" }} durationInFrames={1} fps={30} width={640} height={360} />
    <Composition id={COMPOSITION_IDS.fonts} component={FontSpecimen} defaultProps={{}} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.specimen} component={Placeholder} defaultProps={{ label: "StyleSpecimen" }} durationInFrames={1} fps={30} width={1920} height={1080} />
  </>
);
