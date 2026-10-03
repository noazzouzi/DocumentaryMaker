// Panning for the offline mixer.

/**
 * Equal-power pan normalised to unity at the centre: L = √2·cos θ, R = √2·sin θ with θ = (pan + 1)·π/4.
 * L² + R² = 2 for every pan (constant power), a centred stereo file plays at its own level (the director sets SFX gains
 * from file peaks), and a hard-panned source gains up to +3 dB on its side.
 */
export function equalPowerPan(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  const th = ((p + 1) * Math.PI) / 4;
  return [Math.SQRT2 * Math.cos(th), Math.SQRT2 * Math.sin(th)];
}

/** RL sweep on an LR file → mirror the channels (left/right swapped). */
export function shouldMirror(panSweep: "LR" | "RL" | null, direction: "LR" | "RL" | "none"): boolean {
  return (panSweep === "RL" && direction === "LR") || (panSweep === "LR" && direction === "RL");
}
