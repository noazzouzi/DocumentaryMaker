// FxLightLayer + SignalDamage (§10.6): light (flash, screen blend, min(cap, Σ amt·e)) → signal damage (rgb split:
// two tinted copies ±Σ amt·e px via an SVG filter, only ≥ .5 px; glitch: horizontal slice displacement) → dark.
// Quiet frames are untouched (no filter, no overlay).
import type React from "react";
import { useId } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { FxCue } from "@docmaker/core";
import { useDocState, useEnv } from "../data/env";
import { lightStateAt, NO_LIGHT, type LightSample } from "../fx/cameraState";

const pictureLight = (c: FxCue) => c.target !== "all";
const allLight = (c: FxCue) => c.target === "all";

export function useLight(select: (c: FxCue) => boolean, withCutFlashes: boolean): LightSample {
  const doc = useDocState();
  const env = useEnv();
  const f = useCurrentFrame();
  if (!doc) return NO_LIGHT;
  return lightStateAt({ fx: doc.ct.fx, cutFlashes: withCutFlashes ? doc.ct.cutFlashes : undefined, f, fps: env.fps, select });
}

const cleanId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");

/** Wraps the picture: applies rgb split / glitch filters only on frames that need them. */
export const SignalDamage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const light = useLight(pictureLight, false);
  const uid = cleanId(useId());
  const rgbId = `dm-rgb-${uid}`;
  const glitchId = `dm-glitch-${uid}`;
  const filters: string[] = [];
  if (light.glitchPx > 0) filters.push(`url(#${glitchId})`);
  if (light.rgbPx > 0) filters.push(`url(#${rgbId})`);
  // the element tree stays identical on quiet frames (no remount of videos/canvases), only the filter changes
  const d = light.rgbPx;
  const glitchScale = light.glitchPx / 0.35;
  return (
    <AbsoluteFill>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        {light.rgbPx > 0 ? (
          <filter id={rgbId} x="-2%" y="0%" width="104%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={-d} dy={0} result="r2" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={d} dy={0} result="b2" />
            <feBlend in="r2" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b2" mode="screen" />
          </filter>
        ) : null}
        {light.glitchPx > 0 ? (
          <filter id={glitchId} x="-3%" y="0%" width="106%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0 0.03" numOctaves={1} seed={light.glitchSeed % 10000} result="n" />
            <feComponentTransfer in="n" result="bands">
              <feFuncR type="discrete" tableValues="0.5 0.5 0.15 0.5 0.85 0.5 0.5 0.3 0.5 0.72 0.5 0.5" />
              <feFuncG type="linear" slope={0} intercept={0.5} />
              <feFuncB type="linear" slope={0} intercept={0.5} />
            </feComponentTransfer>
            <feDisplacementMap in="SourceGraphic" in2="bands" scale={glitchScale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        ) : null}
      </svg>
      <AbsoluteFill style={{ filter: filters.length ? filters.join(" ") : undefined }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const LightOverlay: React.FC<{ light: LightSample }> = ({ light }) => (
  <>
    {light.flash > 0.001 ? <AbsoluteFill style={{ backgroundColor: light.flashColor, opacity: light.flash, mixBlendMode: "screen", pointerEvents: "none" }} /> : null}
    {light.dark > 0.001 ? <AbsoluteFill style={{ backgroundColor: "#000000", opacity: light.dark, pointerEvents: "none" }} /> : null}
  </>
);

/** Flash + dark over the picture (cues targeting the picture, plus cut-accent flashes). */
export const FxLightLayer: React.FC = () => <LightOverlay light={useLight(pictureLight, true)} />;
/** Flash + dark of target-"all" cues, above the graphics layer (below captions and HUD). */
export const FxLightAllLayer: React.FC = () => <LightOverlay light={useLight(allLight, false)} />;
