"use client";
// P0 client component: imports @docmaker/remotion (".") and "./compute" plus @docmaker/core, all browser-safe.
import { useMemo } from "react";
import { COMPOSITION_IDS, Documentary, IMPLEMENTED_COMPONENTS } from "@docmaker/remotion";
import { computeTimeline } from "@docmaker/remotion/compute";
import { hashJson, isDocmakerError, type Timeline } from "@docmaker/core";

export function Hello({ timeline = null }: { timeline?: Timeline | null }) {
  const status = useMemo(() => {
    if (!timeline) return "no timeline loaded";
    try {
      return `${computeTimeline(timeline).chapters.length} chapters`;
    } catch (e) {
      return isDocmakerError(e) ? e.message : "computeTimeline failed";
    }
  }, [timeline]);
  return (
    <section className="mt-8 rounded-lg border border-neutral-800 p-6">
      <p>Remotion compositions: {Object.values(COMPOSITION_IDS).join(", ")}</p>
      <p>Documentary component: {typeof Documentary === "function" ? "ready" : "missing"} · implemented overlay components: {IMPLEMENTED_COMPONENTS.size}</p>
      <p>Timeline: {status}</p>
      <p className="font-mono text-xs text-neutral-500">ids hash {hashJson(COMPOSITION_IDS).slice(0, 12)}</p>
    </section>
  );
}
