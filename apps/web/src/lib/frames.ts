// Frame store shared by the Player (writer, ≤ 10 Hz) and the script panel (reader) without re-rendering the Player.
export interface FrameStore { get(): number; set(f: number): void; subscribe(cb: () => void): () => void }

export function createFrameStore(initial = 0): FrameStore {
  let frame = initial;
  const subs = new Set<() => void>();
  return {
    get: () => frame,
    set(f) {
      if (f === frame) return;
      frame = f;
      for (const s of subs) s();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** Index of the word playing at `frame` (words sorted by `from`), else -1 (before the first word or in a gap). */
export function wordIndexAt(words: readonly { from: number; dur: number }[], frame: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.from <= frame) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return -1;
  const w = words[best]!;
  return frame < w.from + w.dur ? best : -1;
}

/** Last word index whose start is ≤ frame (for auto-scroll through pauses), else -1. */
export function lastWordStartedAt(words: readonly { from: number }[], frame: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.from <= frame) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** Throttle helper: returns a function that calls fn at most every `ms` (trailing call kept). */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  return (...a: A) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...a);
    } else {
      pending = a;
      timer ??= setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pending) fn(...pending);
        pending = null;
      }, wait);
    }
  };
}
