// Readability holds per COMPONENT_META.read (§4.11 ReadPolicy, §9.3 step 7).
import { COMPONENT_META, framesAt, secToFrames, type OverlayComponentId } from "@docmaker/core";
import { truncate, type BeatCtx, type Ctx } from "../ctx";

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

/** Longest reading-time (formula) hold of a full-frame graphics card, seconds. */
export const FULL_FRAME_READ_MAX_SEC = 6;
/** A full-frame card may run into the next beat with its own picked asset only up to this many seconds after its entry. */
export const FULL_FRAME_INTO_PICKED_SEC = 4;

const endsSentence = (t: string) => /[.?!…]["»”’)]?$/u.test(t.trim());

/**
 * Bounds the hold of a full-frame graphics card that is not VO-synced (narratedEnd null): it ends at most 0.75 s after the
 * narrated sentence that contains the end of its beat, and runs into the next beat that has its own picked asset only up
 * to FULL_FRAME_INTO_PICKED_SEC after its entry (that asset must be seen). VO-synced cards keep their narrated hold.
 */
export function boundFullFrameHold(ctx: Ctx, b: BeatCtx, component: OverlayComponentId, from: number, dur: number, narratedEnd: number | null): number {
  const m = COMPONENT_META[component];
  if (!m.fullFrame || m.band !== "graphics" || narratedEnd !== null) return dur;
  const minHold = framesAt(ctx.fps, m.minHold30);
  let end = from + dur;
  // end of the sentence that the beat's last word belongs to
  let sentEnd = b.end;
  for (let i = b.wordEnd - 1; b.wordEnd > b.wordStart && i < ctx.words.length && i < b.wordEnd + 60; i++) {
    const w = ctx.words[i]!;
    if (i >= b.wordEnd && w.segmentId !== ctx.words[b.wordEnd - 1]?.segmentId) break;
    sentEnd = w.from + w.dur;
    if (endsSentence(w.text)) break;
  }
  end = Math.min(end, Math.max(from + minHold, sentEnd + ctx.S(0.75)));
  const next = ctx.beats.find((x) => x.from >= b.end && x.from < end && (ctx.picksByBeat.get(x.id)?.length ?? 0) > 0);
  if (next) end = Math.max(next.from, Math.min(end, from + ctx.S(FULL_FRAME_INTO_PICKED_SEC)));
  return Math.max(Math.min(dur, minHold), end - from);
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
  // a full-frame card hides the picture: reading-time holds are capped (the narration has moved on by then)
  const cap = m.fullFrame && m.band === "graphics" ? enter + secToFrames(FULL_FRAME_READ_MAX_SEC, fps) : Infinity;
  const formula = () => Math.min(cap, enter + secToFrames(Math.max(1.5, readSecFormula(texts) + 1.5), fps));
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
