// packages/core/src/util/sfx-density.ts — the SFX counting rule of the density caps (§9.5 step 4, lint DENSITY_MAX),
// shared by the director (selection + lint + stats) and the audio QA report so both count the same events.
import type { SfxCategory } from "../schema/media";
import type { Timeline } from "../schema/timeline";

/** Impact-like categories (the impactsPerMin cap). */
export const SFX_IMPACT_CATEGORIES: ReadonlySet<SfxCategory> = new Set<SfxCategory>(["impact", "impact.soft", "boom.sub", "boom.low", "thud"]);
/** Roll categories: repeats of one source item within 1 s are one density event (a counter's ticks, typing keys…). */
export const SFX_ROLL_CATEGORIES: ReadonlySet<SfxCategory> = new Set<SfxCategory>(["tick", "keys", "pop", "shutter", "click"]);

export const isSfxImpact = (cat: string): boolean => SFX_IMPACT_CATEGORIES.has(cat as SfxCategory);

/**
 * Event frames of the SFX that count towards the density caps, in time order: roll members (a roll-category cue of the
 * same source item and category within 1 s of the previous one) are left out. Priority-5 cues count (§9.5 step 4:
 * the caps hold for them too); bleeps are listed as well, the director keeps them uncapped but counts them as heads.
 */
export function sfxDensityEvents(t: Pick<Timeline, "fps" | "audio">, filter: (cat: SfxCategory) => boolean = () => true): number[] {
  const out: number[] = [];
  const last = new Map<string, number>();
  for (const x of [...t.audio.sfx].sort((a, b) => a.eventFrame - b.eventFrame || (a.id < b.id ? -1 : 1))) {
    if (!filter(x.category)) continue;
    const key = `${x.sourceItemId ?? x.id}|${x.category}`;
    const prev = last.get(key);
    last.set(key, x.eventFrame);
    if (SFX_ROLL_CATEGORIES.has(x.category) && prev !== undefined && x.eventFrame - prev <= t.fps) continue;
    out.push(x.eventFrame);
  }
  return out;
}
