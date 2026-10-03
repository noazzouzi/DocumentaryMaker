// Small shared helpers for the writers (number formatting, rational time, colours, sorting). Pure.
import type { ExportTimeline, MarkerColor } from "@docmaker/core";

/** Compact decimal: at most `digits` decimals, no trailing zeros, never "-0". */
export function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "0";
  const r = Number(n.toFixed(digits));
  if (Object.is(r, -0) || r === 0) return "0";
  return String(r);
}

/** FCPXML rational time of an integer frame count: "0s" | "<f·den>/<num>s". */
export function rationalTime(frames: number, fps: ExportTimeline["fps"]): string {
  const f = Math.round(frames);
  if (f === 0) return "0s";
  return `${f * fps.den}/${fps.num}s`;
}

/** Nominal integer rate (timebase) of a rational frame rate: 30000/1001 → 30. */
export function timebase(fps: ExportTimeline["fps"]): number {
  return Math.round(fps.num / fps.den);
}

export const fpsValue = (fps: ExportTimeline["fps"]): number => fps.num / fps.den;

/** "HH:MM:SS:FF" NDF from a frame count at an integer timebase. */
export function tcNdf(frame: number, tb: number): string {
  const f = Math.max(0, Math.round(frame));
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ff = f % tb;
  const s = Math.floor(f / tb);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}:${p2(ff)}`;
}

export const RESOLVE_COLOR: Record<MarkerColor, string> = {
  red: "ResolveColorRed", blue: "ResolveColorBlue", green: "ResolveColorGreen", yellow: "ResolveColorYellow",
  purple: "ResolveColorPurple", cyan: "ResolveColorCyan", orange: "ResolveColorOrange",
};

export const OTIO_COLOR: Record<MarkerColor, string> = {
  red: "RED", blue: "BLUE", green: "GREEN", yellow: "YELLOW", purple: "PURPLE", cyan: "CYAN", orange: "ORANGE",
};

/** Removes control characters (XML 1.0 forbids most of them; NLE marker fields are single-line). */
export function cleanText(s: string, singleLine = true): string {
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return singleLine ? t.replace(/\s*[\r\n]+\s*/g, " ").trim() : t;
}

/** dB → linear gain clamped to the xmeml Audio Levels maximum (+12 dB = 3.98109). */
export const XMEML_MAX_LEVEL = 3.98109;
export function dbToLevel(db: number): number {
  if (db <= -96) return 0.000016;
  return Math.min(XMEML_MAX_LEVEL, Math.pow(10, db / 20));
}

/** Basename without extension. */
export function stem(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
