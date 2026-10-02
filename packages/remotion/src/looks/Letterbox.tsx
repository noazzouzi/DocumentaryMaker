// Letterbox bars for an aspect ratio (2.39 → ≈ 138 px each at 1920×1080). Used by grade.letterbox (static, HUD level)
// and by the Letterbox overlay component (20 f in/out).
import type React from "react";
import { AbsoluteFill } from "remotion";

export const letterboxBarPx = (ratio: number, width = 1920, height = 1080): number =>
  ratio > 0 ? Math.max(0, Math.round((height - width / ratio) / 2)) : 0;

export const LetterboxBars: React.FC<{ ratio: number; progress?: number; color?: string }> = ({ ratio, progress = 1, color = "#000000" }) => {
  const h = letterboxBarPx(ratio) * Math.max(0, Math.min(1, progress));
  if (h <= 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, backgroundColor: color }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, backgroundColor: color }} />
    </AbsoluteFill>
  );
};
