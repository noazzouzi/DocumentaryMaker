// packages/core/src/util/time.ts — frame/ms conversions (integer frames everywhere in timelines). Isomorphic.
export const msToFrame = (ms: number, fps: number): number => Math.round((ms * fps) / 1000);
export const frameToMs = (f: number, fps: number): number => Math.round((f * 1000) / fps);
export const secToFrames = (s: number, fps: number): number => Math.round(s * fps);
export const framesAt = (fps: number, frames30: number): number => Math.round((frames30 * fps) / 30);
/** Sample index of a frame at 48 kHz: exact integer for 24, 25 and 30 fps. */
export const frameToSample48k = (f: number, fps: number): number => (f * 48000) / fps;

const p2 = (n: number) => String(n).padStart(2, "0");

/** "HH:MM:SS:FF" non-drop-frame. */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const r = Math.round(fps);
  const ff = f % r;
  const totalSec = Math.floor(f / r);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${p2(hh)}:${p2(mm)}:${p2(ss)}:${p2(ff)}`;
}

/** "HH:MM:SS,mmm" (SRT). */
export function srtTime(frame: number, fps: number): string {
  const ms = Math.max(0, frameToMs(frame, fps));
  const mmm = ms % 1000;
  const totalSec = Math.floor(ms / 1000);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${p2(hh)}:${p2(mm)}:${p2(ss)},${String(mmm).padStart(3, "0")}`;
}
