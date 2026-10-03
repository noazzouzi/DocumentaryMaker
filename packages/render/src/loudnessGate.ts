// Post-AAC true-peak gate (§11.5, §12.3): measure ebur128 (true peak) on the final MP4; above the gate → re-mux the
// audio with volume=(gate − TP − 0.3) dB (video copied), ≤ 2 attempts. ok also requires integrated loudness within
// ±1 LU of the target.
import type { RuntimeConfig } from "@docmaker/core";
import { measureEbur128 } from "@docmaker/core/node";
import { ffAtomic } from "./ff";

export const GATE_MARGIN_DB = 0.3;
export const GATE_MAX_ATTEMPTS = 2;
export const LUFS_TOLERANCE = 1;

/** Gain (dB, ≤ 0) that brings a true peak under the gate with the safety margin; 0 when already under. */
export function gateGainDb(truePeakDbtp: number, gateDbtp: number): number {
  if (!(truePeakDbtp > gateDbtp)) return 0;
  return Math.round((gateDbtp - truePeakDbtp - GATE_MARGIN_DB) * 100) / 100;
}

export const gatePasses = (m: { integratedLufs: number; truePeakDbtp: number }, gateDbtp: number, targetLufs: number): boolean =>
  m.truePeakDbtp <= gateDbtp && Math.abs(m.integratedLufs - targetLufs) <= LUFS_TOLERANCE;

export async function loudnessGate(mp4: string, o: { gateDbtp: number; targetLufs: number; config: RuntimeConfig; signal: AbortSignal }): Promise<{ integratedLufs: number; truePeakDbtp: number; attempts: number; ok: boolean }> {
  let m = await measureEbur128(mp4, { config: o.config, signal: o.signal });
  let attempts = 0;
  while (m.truePeakDbtp > o.gateDbtp && attempts < GATE_MAX_ATTEMPTS) {
    attempts++;
    const gain = gateGainDb(m.truePeakDbtp, o.gateDbtp);
    await ffAtomic([
      "-i", mp4, "-map", "0:v?", "-map", "0:a:0", "-c:v", "copy", "-af", `volume=${gain.toFixed(2)}dB`,
      "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", "-f", "mp4",
    ], mp4, { config: o.config, signal: o.signal });
    m = await measureEbur128(mp4, { config: o.config, signal: o.signal });
  }
  return { integratedLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, attempts, ok: gatePasses(m, o.gateDbtp, o.targetLufs) };
}
