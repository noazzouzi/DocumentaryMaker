// Overlay plans (step 7) before they become OverlayItems: creation, validation, ids, cooldowns, people rules.
import {
  COMPONENT_META, OVERLAY_PROPS, framesAt, ids, type ComponentPolicy, type OverlayComponentId, type Person, type ZoneName,
} from "@docmaker/core";
import type { Ctx } from "../ctx";

/** Priority classes for arbitration (higher survives): structural > template > cue component > labels are exempt. */
export const CLS = { structural: 6, template: 5, cue: 4, cueTransition: 3, quota: 2, fill: 1 } as const;

export interface Ov {
  id: string; component: OverlayComponentId; ref: string; beatId: string | null;
  from: number; dur: number; zone: ZoneName; props: Record<string, unknown>;
  cls: number; origin: "structural" | "template" | "cue" | "label" | "clip" | "resource";
  anchorWord: string | null; anchorChapter: string | null; anchorSegment: string | null;
  subBeats: number[]; // absolute frames of VO-synced sub-beats
  readHold: number;
  dropped: boolean;
}

export interface OvState {
  items: Ov[];
  counters: Map<string, number>;
  lastEntry: Map<OverlayComponentId, number>;
  mentioned: Set<string>;
  served: Set<string>; // "<beatId>:<k>" cues already served by (a)–(f)
}

export const newOvState = (): OvState => ({ items: [], counters: new Map(), lastEntry: new Map(), mentioned: new Set(), served: new Set() });

export function policyOf(ctx: Ctx, c: OverlayComponentId): ComponentPolicy | null {
  const p = ctx.style.components.find((x) => x.id === c);
  return p && p.enabled ? p : null;
}

export function cooldownOk(ctx: Ctx, st: OvState, c: OverlayComponentId, f: number): boolean {
  const cd = ctx.Bu.componentCooldownSec[c];
  if (cd === undefined) return true;
  const last = st.lastEntry.get(c);
  return last === undefined || f - last >= ctx.S(cd);
}

export function zoneFor(ctx: Ctx, c: OverlayComponentId, want?: ZoneName): ZoneName {
  const z = want ?? COMPONENT_META[c].defaultZone;
  if (z === "full") return z;
  const r = ctx.tok.tokens.layout.zones[z];
  const hit = ctx.tok.tokens.layout.keepOut.some((k) => r.x < k.x + k.w && k.x < r.x + r.w && r.y < k.y + k.h && k.y < r.y + r.h);
  return hit ? "center" : z;
}

/** Validates props against OVERLAY_PROPS and clamps timing; returns null (with a warning) when unusable. */
/** Overshoot components (Stamp) only when the style's motion tokens allow them (lint OVERSHOOT). */
export const overshootOk = (ctx: Ctx, c: OverlayComponentId) =>
  !COMPONENT_META[c].overshootAllowed || ctx.I.renderTokens.motion.overshootAllowedIn.includes(c);

export function addOv(ctx: Ctx, st: OvState, o: {
  component: OverlayComponentId; ref: string; beatId: string | null; from: number; dur: number; props: Record<string, unknown>;
  cls: number; origin: Ov["origin"]; zone?: ZoneName; anchorWord?: string | null; anchorChapter?: string | null; anchorSegment?: string | null;
  subBeats?: number[]; readHold?: number;
}): Ov | null {
  const parsed = OVERLAY_PROPS[o.component].safeParse(o.props);
  const where = o.beatId ?? o.ref;
  if (!overshootOk(ctx, o.component)) {
    ctx.warn("OVERSHOOT_SKIPPED", where, `${o.component} skipped: the style does not allow overshoot`);
    return null;
  }
  if (!parsed.success) {
    ctx.warn("OVERLAY_PROPS", where, `${o.component} dropped: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ").slice(0, 200)}`);
    return null;
  }
  const from = Math.max(0, Math.min(ctx.N - 1, Math.round(o.from)));
  const dur = Math.min(ctx.N - from, Math.round(o.dur));
  if (dur < 1) return null;
  const key = `${o.ref}|${o.component}`;
  const n = st.counters.get(key) ?? 0;
  st.counters.set(key, n + 1);
  const ov: Ov = {
    id: ids.overlay(o.ref, o.component, n), component: o.component, ref: o.ref, beatId: o.beatId, from, dur,
    zone: zoneFor(ctx, o.component, o.zone), props: parsed.data as Record<string, unknown>, cls: o.cls, origin: o.origin,
    anchorWord: o.anchorWord ?? null, anchorChapter: o.anchorChapter ?? null, anchorSegment: o.anchorSegment ?? null,
    subBeats: (o.subBeats ?? []).filter((f) => f > from && f < from + dur).sort((a, b) => a - b), readHold: o.readHold ?? dur, dropped: false,
  };
  st.items.push(ov);
  st.lastEntry.set(o.component, Math.max(st.lastEntry.get(o.component) ?? -Infinity, from));
  return ov;
}

/** How a person may appear on screen: by name, anonymously, or never (minors and private victims). */
export function personRule(ctx: Ctx, p: Person | undefined): "name" | "anon" | "never" {
  if (!p) return "anon";
  if (p.isMinorOrPrivateVictim) return "never";
  if (!p.publicFigure && !ctx.I.personAcks.includes(p.id)) return "anon";
  return "name";
}
export const personById = (ctx: Ctx, id: string | null | undefined) => (id ? ctx.facts.people.find((p) => p.id === id) : undefined);

/** Portrait asset of a person when they may be shown. */
export function portraitFor(ctx: Ctx, personId: string | null | undefined): string | null {
  const p = personById(ctx, personId);
  if (!p || personRule(ctx, p) !== "name") return null;
  return ctx.portraitOf.get(p.id) ?? null;
}

export const enterOf = (ctx: Ctx, c: OverlayComponentId) => framesAt(ctx.fps, COMPONENT_META[c].enter30);
