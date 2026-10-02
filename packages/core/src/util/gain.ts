// packages/core/src/util/gain.ts — gain tables shared by the Remotion preview and the offline mixer (preview parity).
import type { Timeline } from "../schema/timeline";

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9));
export interface GainTables { fps: number; length: number; music: Float32Array; sfx: Float32Array; clip: Float32Array; vo: Float32Array }

/** Max-accumulates a trapezoid (attack ramp → 1 on [s, e) → release ramp) into env. */
function addTrapezoid(env: Float32Array, s: number, e: number, attack: number, release: number): void {
  const N = env.length;
  const a0 = s - attack;
  const r1 = e + release;
  const k0 = Math.max(0, Math.ceil(a0));
  const k1 = Math.min(N, Math.ceil(r1)); // exclusive
  for (let k = k0; k < k1; k++) {
    let v: number;
    if (k < s) v = attack > 0 ? (k - a0) / attack : 1;
    else if (k < e) v = 1;
    else v = release > 0 ? 1 - (k - e) / release : 0;
    if (v <= 0) continue;
    if (v > 1) v = 1;
    if (v > env[k]!) env[k] = v;
  }
}

/** §4.18 computeGainTables (normative). Tables are evaluated at integer program frames [0, durationInFrames). */
export function computeGainTables(t: Timeline): GainTables {
  const N = t.durationInFrames;
  const fps = t.fps;
  const d = t.audio.ducking;
  const F = (ms: number) => (ms * fps) / 1000;
  const envVo = new Float32Array(N);
  for (const [a, b] of t.audio.voSpans) addTrapezoid(envVo, a - F(d.padBeforeMs), b + F(d.padAfterMs), F(d.attackMs), F(d.releaseMs));
  const envClip = new Float32Array(N);
  for (const c of t.audio.clip) addTrapezoid(envClip, c.from, c.from + c.dur, F(d.attackMs), F(d.releaseMs));

  const music = new Float32Array(N);
  const sfx = new Float32Array(N);
  const clip = new Float32Array(N);
  const vo = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    music[k] = dbToGain(Math.min(d.musicDuckDb * envVo[k]!, d.musicUnderClipDb * envClip[k]!));
    sfx[k] = dbToGain(d.sfxDuckDb * envVo[k]!);
    clip[k] = dbToGain(d.clipDuckDb * envVo[k]!);
    vo[k] = 1;
  }
  const tables = { music, sfx, clip, vo } as const;
  for (const s of t.audio.silences) {
    const k0 = Math.max(0, s.from);
    const k1 = Math.min(N, s.from + s.dur);
    for (const which of s.affects) tables[which].fill(0, k0, Math.max(k0, k1));
  }
  return { fps, length: N, music, sfx, clip, vo };
}

/** Per-item envelope (fades) as linear gain for an item-local frame. Loops do not reset the envelope. */
export function itemEnvelope(item: { dur: number; fadeInFrames?: number; fadeOutFrames?: number }, localFrame: number): number {
  if (localFrame < 0 || localFrame >= item.dur) return 0;
  let g = 1;
  const fi = item.fadeInFrames ?? 0;
  const fo = item.fadeOutFrames ?? 0;
  if (fi > 0 && localFrame < fi) g = Math.min(g, localFrame / fi);
  if (fo > 0 && localFrame >= item.dur - fo) g = Math.min(g, (item.dur - localFrame) / fo);
  return Math.max(0, Math.min(1, g));
}
