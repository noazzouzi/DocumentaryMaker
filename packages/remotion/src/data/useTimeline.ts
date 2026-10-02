// Loads the Timeline for a Documentary: inline (Player) or from timelineUrl (render worker; asset server).
// The only remotion/src file (with Root.tsx) allowed to fetch and to hold React state (eslint.determinism.js).
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import type { Timeline } from "@docmaker/core";
import type { DocProps } from "../index";

export function useTimeline(p: DocProps): Timeline | null {
  const [fetched, setFetched] = useState<Timeline | null>(null);
  const [handle] = useState<number | null>(() => (p.timeline || !p.timelineUrl ? null : delayRender(`timeline ${p.timelineUrl}`)));
  useEffect(() => {
    if (handle === null || !p.timelineUrl) return;
    let alive = true;
    fetch(p.timelineUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`timeline fetch failed: HTTP ${r.status}`);
        return r.json() as Promise<Timeline>;
      })
      .then((t) => {
        if (!alive) return;
        setFetched(t);
        continueRender(handle);
      })
      .catch((e: unknown) => cancelRender(e));
    return () => {
      alive = false;
    };
  }, [handle, p.timelineUrl]);
  return p.timeline ?? fetched;
}
