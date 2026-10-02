// Readability holds per COMPONENT_META.read (§4.11 ReadPolicy, §9.3 step 7).
import { COMPONENT_META, framesAt, secToFrames, type OverlayComponentId } from "@docmaker/core";
import { truncate } from "../ctx";

/** Strings at dotted paths ("items.headline", "lines", "left.label") of a props object. */
export function textAt(props: unknown, path: string): string[] {
  const [head, ...rest] = path.split(".");
  if (props === null || typeof props !== "object" || head === undefined) return [];
  const v = (props as Record<string, unknown>)[head];
  const step = (x: unknown): string[] => (rest.length ? textAt(x, rest.join(".")) : typeof x === "string" ? [x] : []);
  if (Array.isArray(v)) return v.flatMap(step);
  return step(v);
}

export function readText(component: OverlayComponentId, props: unknown): string[] {
  return COMPONENT_META[component].read.textFields.flatMap((f) => textAt(props, f));
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** Reading seconds for formula mode: chars/15 (CJK chars/4.5). */
function readSecFormula(texts: string[]): number {
  const s = texts.join(" ");
  const cjk = (s.match(CJK) ?? []).length;
  const latin = [...s].length - cjk;
  return latin / 15 + cjk / 4.5;
}

export interface Hold { readHold: number; minHold: number; maxHold: number; enter: number; exit: number; dur: number; over: boolean }

/**
 * readHold per mode; dur = clamp(readHold, minHold, maxHold). `narratedEnd` = last narrated word end − item.from when
 * VO-synced; `typeFrames` = DateStamp typing time; `contentFrames` = a component-specific floor (sub-beats + dwell).
 */
export function holdOf(component: OverlayComponentId, props: unknown, fps: number, o: { narratedEnd?: number | null; typeFrames?: number; contentFrames?: number } = {}): Hold {
  const m = COMPONENT_META[component];
  const enter = framesAt(fps, m.enter30), exit = framesAt(fps, m.exit30);
  const minHold = framesAt(fps, m.minHold30), maxHold = framesAt(fps, m.maxHold30);
  const texts = readText(component, props);
  const formula = () => enter + secToFrames(Math.max(1.5, readSecFormula(texts) + 1.5), fps);
  let readHold: number;
  switch (m.read.mode) {
    case "formula": readHold = formula(); break;
    case "glance": readHold = component === "DateStamp" ? enter + (o.typeFrames ?? 0) + framesAt(fps, 30) : enter + secToFrames(0.4, fps); break;
    case "title": readHold = enter + secToFrames(Math.max(1.2, [...texts.join(" ")].length / 20 + 0.8), fps); break;
    case "narrated": readHold = o.narratedEnd !== null && o.narratedEnd !== undefined ? o.narratedEnd + secToFrames(0.6, fps) : formula(); break;
    case "none": readHold = minHold; break;
  }
  if (o.contentFrames !== undefined) readHold = Math.max(readHold, o.contentFrames);
  const dur = Math.min(maxHold, Math.max(minHold, readHold));
  return { readHold, minHold, maxHold, enter, exit, dur, over: readHold > maxHold };
}

/**
 * Formula components whose text cannot be read within maxHold: truncate the longest text field on a word boundary
 * until it fits (returns the patched props and whether something was cut).
 */
export function fitFormula(component: OverlayComponentId, props: Record<string, unknown>, fps: number): { props: Record<string, unknown>; truncated: boolean } {
  const m = COMPONENT_META[component];
  if (m.read.mode !== "formula") return { props, truncated: false };
  let p = structuredClone(props);
  let truncated = false;
  for (let guard = 0; guard < 60 && holdOf(component, p, fps).over; guard++) {
    // the longest top-level string (or string inside a top-level array) shrinks by ~15 %
    let bestKey: string | null = null, bestIdx = -1, bestLen = 0;
    for (const f of m.read.textFields) {
      const key = f.split(".")[0]!;
      const v = p[key];
      if (typeof v === "string" && v.length > bestLen) { bestKey = key; bestIdx = -1; bestLen = v.length; }
      if (Array.isArray(v)) v.forEach((x, k) => { if (typeof x === "string" && x.length > bestLen) { bestKey = key; bestIdx = k; bestLen = x.length; } });
    }
    if (bestKey === null || bestLen <= 4) break;
    const target = Math.max(4, Math.floor(bestLen * 0.85));
    if (bestIdx < 0) p = { ...p, [bestKey]: truncate(p[bestKey] as string, target) };
    else {
      const arr = [...(p[bestKey] as string[])];
      arr[bestIdx] = truncate(arr[bestIdx]!, target);
      p = { ...p, [bestKey]: arr };
    }
    truncated = true;
  }
  return { props: p, truncated };
}
