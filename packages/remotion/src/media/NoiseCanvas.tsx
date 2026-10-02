// Seeded grain/paper texture drawn ONCE per mount into a small canvas and scaled up by CSS: deterministic (mulberry32)
// and cheap at render time (a full-frame SVG feTurbulence per frame is too slow under swangle).
import type React from "react";
import { useLayoutEffect, useRef } from "react";
import { mulberry32 } from "@docmaker/core";

export interface NoiseCanvasProps {
  seed: number;
  /** Texture resolution (scaled to fill the parent). */
  width?: number;
  height?: number;
  /** "grain": neutral luminance noise; "paper": warm fibres + blotches; "dust": sparse specks. */
  kind?: "grain" | "paper" | "dust";
  opacity?: number;
  blend?: React.CSSProperties["mixBlendMode"];
  style?: React.CSSProperties;
}

export const NoiseCanvas: React.FC<NoiseCanvasProps> = ({ seed, width = 960, height = 540, kind = "grain", opacity = 0.15, blend = "normal", style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const r = mulberry32((seed >>> 0) ^ 0x9e3779b9);
    const img = ctx.createImageData(width, height);
    const d = img.data;
    if (kind === "dust") {
      for (let i = 0; i < d.length; i += 4) d[i + 3] = 0;
      const n = Math.round(width * height * 0.004);
      for (let k = 0; k < n; k++) {
        const x = Math.floor(r() * width);
        const y = Math.floor(r() * height);
        const o = (y * width + x) * 4;
        const v = r() < 0.5 ? 0 : 255;
        d[o] = v;
        d[o + 1] = v;
        d[o + 2] = v;
        d[o + 3] = 120 + Math.floor(r() * 135);
      }
    } else {
      for (let i = 0; i < d.length; i += 4) {
        const v = r();
        if (kind === "paper") {
          // warm low-contrast fibres: mostly mid values with occasional darker specks
          const base = 200 + v * 40 - (r() < 0.02 ? 70 : 0);
          d[i] = base;
          d[i + 1] = base * 0.96;
          d[i + 2] = base * 0.88;
        } else {
          const g = Math.floor(v * 255);
          d[i] = g;
          d[i + 1] = g;
          d[i + 2] = g;
        }
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (kind === "paper") {
      // fibres: short faint strokes
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = "#5a4a32";
      for (let k = 0; k < 160; k++) {
        const x = r() * width;
        const y = r() * height;
        const a = r() * Math.PI;
        const len = 4 + r() * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }, [seed, width, height, kind]);
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, mixBlendMode: blend, pointerEvents: "none", ...style }}
    />
  );
};
