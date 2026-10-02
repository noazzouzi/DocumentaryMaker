// Step 7 — OVERLAYS orchestration (§9.3): (h)–(j) structural, (a) templates, (b) person intros, (c)/(d) date stamps and
// slams, (e) clips, (f) labels, (g) cue → component pass, then conflicts.
import type { Ctx, Shot } from "../ctx";
import { resolveConflicts } from "./conflicts";
import { clipOverlays, dateStampsAndSlams, labelOverlays, personIntros, structuralOverlays } from "./cues";
import { cueComponents, type Bleep } from "./derive";
import { templateOverlays } from "./fromMotion";
import { newOvState, type OvState } from "./state";

export function buildOverlays(ctx: Ctx, shots: readonly Shot[]): { st: OvState; bleeps: Bleep[] } {
  const st = newOvState();
  structuralOverlays(ctx, st);
  templateOverlays(ctx, st);
  personIntros(ctx, st, shots);
  dateStampsAndSlams(ctx, st);
  clipOverlays(ctx, st, shots);
  labelOverlays(ctx, st, shots);
  const bleeps = cueComponents(ctx, st, shots);
  resolveConflicts(ctx, st);
  return { st, bleeps };
}

export type { Ov, OvState } from "./state";
export type { Bleep } from "./derive";
