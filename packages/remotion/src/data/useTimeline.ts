// Loads the Timeline for a Documentary (§10.2): props.timeline if set (Player); else a module-level promise cache keyed
// by URL (delayRender("timeline") → fetch → continueRender), so each render tab fetches and parses once.
// With Root.tsx, FontGate.tsx and styleFonts.ts, the only remotion/src files allowed to fetch / hold state.
import { useEffect, useRef, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import type { Timeline } from "@docmaker/core";
import type { DocProps } from "../index";

interface Entry { promise: Promise<Timeline>; value: Timeline | null; error: unknown }
const cache = new Map<string, Entry>();

/** Minimal structural check (the director validates the full schema; this catches wrong URLs / truncated files). */
export function assertTimelineShape(v: unknown, url: string): Timeline {
  const t = v as Partial<Timeline> | null;
  if (!t || typeof t !== "object" || typeof t.durationInFrames !== "number" || typeof t.fps !== "number" || !Array.isArray(t.video) || !t.render) {
    throw new Error(`timeline at ${url} is not a Timeline document`);
  }
  return t as Timeline;
}

/** Fetches (once per URL per tab) and parses a timeline. */
export function fetchTimeline(url: string, signal?: AbortSignal): Promise<Timeline> {
  let e = cache.get(url);
  if (!e) {
    const entry: Entry = { promise: Promise.resolve(null as unknown as Timeline), value: null, error: null };
    entry.promise = fetch(url, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`timeline fetch failed: HTTP ${r.status} (${url})`);
        return r.json() as Promise<unknown>;
      })
      .then((json) => {
        entry.value = assertTimelineShape(json, url);
        return entry.value;
      })
      .catch((err: unknown) => {
        entry.error = err;
        cache.delete(url); // allow a retry (e.g. calculateMetadata aborted)
        throw err;
      });
    cache.set(url, entry);
    e = entry;
  }
  return e.promise;
}

export function useTimeline(p: DocProps): Timeline | null {
  const url = p.timeline ? null : p.timelineUrl;
  const cached = url ? cache.get(url)?.value ?? null : null;
  const [fetched, setFetched] = useState<Timeline | null>(cached);
  const [handle] = useState<number | null>(() => (url && !cached ? delayRender(`timeline ${url}`) : null));
  const released = useRef(false);
  useEffect(() => {
    if (!url || handle === null) return;
    let alive = true;
    const release = () => {
      if (!released.current) {
        released.current = true;
        continueRender(handle);
      }
    };
    fetchTimeline(url)
      .then((t) => {
        if (alive) setFetched(t);
        release();
      })
      .catch((e: unknown) => cancelRender(e instanceof Error ? e : new Error(String(e))));
    return () => {
      alive = false;
      release();
    };
  }, [url, handle]);
  return p.timeline ?? fetched ?? cached;
}
