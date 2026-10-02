// Layout geometry (pure): cover/contain fitting with crop + focal, zone rects.
import type { NormPoint, NormRect, StyleTokens, ZoneName } from "@docmaker/core";
import { clamp } from "./easing";

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Placement of a w×h source so that it COVERS a W×H frame. With `crop`, the crop rect (normalised to the source) is
 * what fills the frame (centred, extra source shown only if the crop's aspect differs); else the focal point is kept
 * as close to the centre as the cover constraint allows. Never exposes an edge.
 */
export function coverRect(w: number, h: number, W: number, H: number, crop: NormRect | null, focal: NormPoint): Rect {
  if (!(w > 0 && h > 0)) return { left: 0, top: 0, width: W, height: H };
  let k: number;
  let cx: number;
  let cy: number;
  if (crop && crop.w > 0 && crop.h > 0) {
    k = Math.max(W / (crop.w * w), H / (crop.h * h));
    cx = (crop.x + crop.w / 2) * w;
    cy = (crop.y + crop.h / 2) * h;
  } else {
    k = Math.max(W / w, H / h);
    cx = focal.x * w;
    cy = focal.y * h;
  }
  const width = w * k;
  const height = h * k;
  const left = clamp(W / 2 - cx * k, W - width, 0);
  const top = clamp(H / 2 - cy * k, H - height, 0);
  return { left, top, width, height };
}

/** Placement of a w×h source CONTAINED in a box (centred). */
export function containRect(w: number, h: number, box: Rect): Rect {
  if (!(w > 0 && h > 0)) return box;
  const k = Math.min(box.width / w, box.height / h);
  const width = w * k;
  const height = h * k;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** Card size: image height = heightFrac·H, width from the aspect, both capped inside the safe frame. */
export function cardRect(w: number | null, h: number | null, W: number, H: number, heightFrac: number, borderPx: number): Rect {
  const aspect = w && h && w > 0 && h > 0 ? w / h : 4 / 3;
  let height = clamp(heightFrac, 0.3, 1) * H - 2 * borderPx;
  let width = height * aspect;
  const maxW = W * 0.86 - 2 * borderPx;
  if (width > maxW) {
    width = maxW;
    height = width / aspect;
  }
  return { left: (W - width) / 2, top: (H - height) / 2, width, height };
}

export function zoneRect(tokens: Pick<StyleTokens, "layout">, zone: ZoneName): Rect {
  const z = tokens.layout.zones[zone];
  return { left: z.x, top: z.y, width: z.w, height: z.h };
}

/** CSS percentage object-position for a focal point (fallback when the source size is unknown). */
export const objectPosition = (focal: NormPoint): string => `${(focal.x * 100).toFixed(2)}% ${(focal.y * 100).toFixed(2)}%`;
