// Shared types for cover presentations. Covers render inside a Sequence at the window start, so every value here is
// window-relative (k = local frame, cutAt = cut − from): shift-invariant for chunk slice hashes.
import type { CoverWindow } from "../../compute/types";

export interface CoverProps {
  /** Window with `from = 0` and `cut = cut − from` (window-relative). */
  w: CoverWindow;
  /** Nominal duration (before clamping at the program edges). */
  d: number;
  /** Local frame inside the window. */
  k: number;
  seed: number;
}
