// Shared component plumbing: item clock (Sequence-relative), enter/exit progress, zones, continuous push, shakes.
// Components read only their props and Sequence-relative frames — never anchors or program frames (§10.4).
import type React from "react";
import { useCurrentFrame } from "remotion";
import type { OverlayComponentId, OverlayItem, ZoneName } from "@docmaker/core";
import { tokenEase, useEnv, type RenderEnv } from "../data/env";
import { clamp01, type Ease } from "../lib/easing";
import { zoneRect, type Rect } from "../lib/geometry";
import { hashSigned } from "../lib/random";

export type OverlayOf<C extends OverlayComponentId> = Extract<OverlayItem, { component: C }>;
export interface ComponentProps<C extends OverlayComponentId> { item: OverlayOf<C> }
export type AnyComponent = React.FC<{ item: OverlayItem }>;

export interface ItemClock {
  f: number; // frames since the item's from
  dur: number;
  fps: number;
  enter: number; // enterFrames
  exit: number; // exitFrames
  inP: number; // eased entry progress 0..1
  outP: number; // eased exit progress 0..1 (0 until dur − exit)
  hold: number; // 0..1 over the whole item (linear)
  entryEase: Ease;
  exitEase: Ease;
}

export function itemClock(item: Pick<OverlayItem, "dur" | "enterFrames" | "exitFrames">, f: number, env: RenderEnv): ItemClock {
  const entryEase = tokenEase(env.tokens.motion.entryEase);
  const exitEase = tokenEase(env.tokens.motion.exitEase);
  const enter = Math.max(0, item.enterFrames);
  const exit = Math.max(0, Math.min(item.exitFrames, item.dur));
  const inP = enter > 0 ? entryEase(clamp01(f / enter)) : f >= 0 ? 1 : 0;
  const outP = exit > 0 ? exitEase(clamp01((f - (item.dur - exit)) / exit)) : 0;
  return { f, dur: item.dur, fps: env.fps, enter, exit, inP, outP, hold: clamp01(f / Math.max(1, item.dur)), entryEase, exitEase };
}

export function useItemClock(item: Pick<OverlayItem, "dur" | "enterFrames" | "exitFrames">): ItemClock {
  const env = useEnv();
  const f = useCurrentFrame();
  return itemClock(item, f, env);
}

export function useZone(zone: ZoneName): Rect {
  const env = useEnv();
  return zoneRect(env.tokens.tokens, zone);
}

/** Continuous push for cards (1.0 → 1.05 over the hold, linear so it never settles). */
export const pushScale = (c: ItemClock, amount = 0.05): number => 1 + amount * c.hold;

/** Short seeded impact shake (px) during [start, start + frames). */
export function impactShake(seedKey: string, f: number, start: number, frames: number, ampPx: number): { x: number; y: number } {
  const t = f - start;
  if (t < 0 || t >= frames) return { x: 0, y: 0 };
  const k = ampPx * (1 - t / frames);
  return { x: hashSigned(seedKey, "shx", t) * k, y: hashSigned(seedKey, "shy", t) * k };
}

/** Pick the item's own zone when it is valid for the component, else the component default. */
export function zoneFor(item: OverlayItem, allowed: readonly ZoneName[], fallback: ZoneName): ZoneName {
  return allowed.includes(item.zone) ? item.zone : fallback;
}
