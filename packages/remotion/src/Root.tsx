// Remotion root (§10.2): every COMPOSITION_IDS entry. Documentary compositions size themselves from the Timeline (inline
// or timelineUrl) in calculateMetadata — which, with a timelineUrl, fetches the timeline ONLY to compute the duration and
// never returns it in props (inputProps stay tiny and identical across chunks).
import type React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import type { Timeline } from "@docmaker/core";
import "./fonts/fonts.css";
import { computeTimeline } from "./compute/computeTimeline";
import { fetchTimeline } from "./data/useTimeline";
import { DEFAULT_LAYERS, Documentary } from "./Documentary";
import { COMPOSITION_IDS, type DocProps } from "./index";
import { FontSpecimen, GeneratedStill, GlProbe, StyleSpecimen, STYLE_SPECIMEN_FRAMES, type GeneratedStillProps, type StyleSpecimenProps } from "./specimen/compositions";

/** DocProps as a type literal (Remotion props must be a Record<string, unknown>). */
type DocPropsShape = Pick<DocProps, keyof DocProps>;

export const DEFAULT_DOC_PROPS: DocPropsShape = {
  timeline: null,
  timelineUrl: null,
  assetBaseUrl: "",
  mode: "render",
  layers: DEFAULT_LAYERS,
  itemId: null,
  scratchBanner: false,
};

/** Metadata for a timeline (shared by the three Documentary compositions). */
export function docMetadata(t: Timeline | null, itemId: string | null): { durationInFrames: number; fps: number; width: number; height: number; defaultCodec: "h264" } {
  if (!t) return { durationInFrames: 1, fps: 30, width: 1920, height: 1080, defaultCodec: "h264" };
  let durationInFrames = computeTimeline(t).durationInFrames;
  if (itemId) {
    const item = t.overlays.find((o) => o.id === itemId);
    durationInFrames = item ? Math.max(1, item.dur + item.enterFrames + item.exitFrames) : 1;
  }
  return { durationInFrames, fps: t.fps, width: 1920, height: 1080, defaultCodec: "h264" };
}

export const calculateDocMetadata: CalculateMetadataFunction<DocPropsShape> = async ({ props, abortSignal }) => {
  const t = props.timeline ?? (props.timelineUrl ? await fetchTimeline(props.timelineUrl, abortSignal) : null);
  return docMetadata(t, props.itemId);
};

const DocumentaryComposition: React.FC<DocPropsShape> = (p) => <Documentary {...p} />;
const GeneratedStillComposition: React.FC<GeneratedStillProps> = (p) => <GeneratedStill {...p} />;
const StyleSpecimenComposition: React.FC<StyleSpecimenProps> = (p) => <StyleSpecimen {...p} />;
const FontSpecimenComposition: React.FC<Record<string, unknown>> = () => <FontSpecimen />;
const GlProbeComposition: React.FC<Record<string, unknown>> = () => <GlProbe />;

export const Root: React.FC = () => (
  <>
    <Composition id={COMPOSITION_IDS.doc} component={DocumentaryComposition} defaultProps={DEFAULT_DOC_PROPS} calculateMetadata={calculateDocMetadata} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition
      id={COMPOSITION_IDS.overlay}
      component={DocumentaryComposition}
      defaultProps={{ ...DEFAULT_DOC_PROPS, layers: { ...DEFAULT_LAYERS, picture: false, audio: false } }}
      calculateMetadata={calculateDocMetadata}
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition id={COMPOSITION_IDS.item} component={DocumentaryComposition} defaultProps={{ ...DEFAULT_DOC_PROPS, layers: { ...DEFAULT_LAYERS, picture: false, audio: false } }} calculateMetadata={calculateDocMetadata} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.still} component={GeneratedStillComposition} defaultProps={{ source: null, tokens: null } as GeneratedStillProps} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.gl} component={GlProbeComposition} defaultProps={{}} durationInFrames={1} fps={30} width={640} height={360} />
    <Composition id={COMPOSITION_IDS.fonts} component={FontSpecimenComposition} defaultProps={{}} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id={COMPOSITION_IDS.specimen} component={StyleSpecimenComposition} defaultProps={{ render: null, lang: "en" } as StyleSpecimenProps} durationInFrames={STYLE_SPECIMEN_FRAMES} fps={30} width={1920} height={1080} />
  </>
);
