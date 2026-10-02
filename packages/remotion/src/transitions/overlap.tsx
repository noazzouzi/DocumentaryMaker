// Overlap presentations (class 3, §10.5): TransitionSeries.Transition with linearTiming({durationInFrames: d}), d even,
// centred on the cut (computeTimeline adds d/2 handles on both sides). dissolve = fade(); push = slide({direction});
// wipe = wipe({direction}); blurDissolve = opacity + blur 0→8→0 px (custom CSS presentation). All CSS: preview = render.
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide, type SlideDirection } from "@remotion/transitions/slide";
import { wipe, type WipeDirection } from "@remotion/transitions/wipe";
import type { SeriesTrans } from "../compute/types";

type BlurDissolveProps = { maxBlurPx: number };

const BlurDissolveComponent: React.FC<TransitionPresentationComponentProps<BlurDissolveProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const p = Math.max(0, Math.min(1, presentationProgress));
  const blur = passedProps.maxBlurPx * Math.sin(Math.PI * p); // 0 → 8 → 0
  const opacity = presentationDirection === "entering" ? p : 1;
  return (
    <AbsoluteFill style={{ opacity, filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined }}>{children}</AbsoluteFill>
  );
};

export const blurDissolve = (maxBlurPx = 8): TransitionPresentation<BlurDissolveProps> => ({ component: BlurDissolveComponent, props: { maxBlurPx } });

/** Our direction = where the motion goes ("left": the new shot pushes in from the right, moving left). */
const slideDir = (d: SeriesTrans["direction"]): SlideDirection =>
  d === "left" ? "from-right" : d === "right" ? "from-left" : d === "up" ? "from-bottom" : "from-top";
const wipeDir = (d: SeriesTrans["direction"]): WipeDirection =>
  d === "left" ? "from-right" : d === "right" ? "from-left" : d === "up" ? "from-bottom" : "from-top";

type AnyPresentation = TransitionPresentation<Record<string, unknown>>;
// TransitionSeries accepts any presentation; the props generic differs per presentation.
const asAny = (p: unknown): AnyPresentation => p as AnyPresentation;

export function overlapPresentation(tr: SeriesTrans): AnyPresentation {
  switch (tr.presentation) {
    case "push":
      return asAny(slide({ direction: slideDir(tr.direction) }));
    case "wipe":
      return asAny(wipe({ direction: wipeDir(tr.direction) }));
    case "blurDissolve":
      return asAny(blurDissolve(8));
    default:
      return asAny(fade());
  }
}
