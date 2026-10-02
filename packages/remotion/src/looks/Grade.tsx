// Looks (§10.12): CSS grade on the picture subtree (overridden per chapter by grade.byAct[act]); split-tone = two
// full-frame colour layers (shadows soft-light at amount·0.5, highlights overlay at amount·0.35), skipped on bw clips.
// Grain and LUT are never rendered in the browser (master post, §12.3).
import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Grade, Timeline } from "@docmaker/core";
import { partIndexAt } from "../compute/computeTimeline";
import { useDocState } from "../data/env";

type GradeCss = Grade["css"];

export function gradeFilter(css: Partial<GradeCss>): string | undefined {
  const parts: string[] = [];
  const add = (name: string, v: number | undefined, neutral: number, unit = "") => {
    if (v === undefined || !Number.isFinite(v) || Math.abs(v - neutral) < 1e-4) return;
    parts.push(`${name}(${Number(v.toFixed(4))}${unit})`);
  };
  add("contrast", css.contrast, 1);
  add("saturate", css.saturate, 1);
  add("brightness", css.brightness, 1);
  add("sepia", css.sepia, 0);
  add("hue-rotate", css.hueRotateDeg, 0, "deg");
  return parts.length ? parts.join(" ") : undefined;
}

export function chapterAt(chapters: Timeline["chapters"], f: number): Timeline["chapters"][number] | null {
  for (const c of chapters) if (f >= c.from && f < c.from + c.dur) return c;
  return null;
}

/** Effective grade for a frame: base css merged with the chapter act's override. */
export function gradeAt(t: Pick<Timeline, "grade" | "chapters">, f: number): { css: GradeCss; vignetteAmount: number } {
  const ch = chapterAt(t.chapters, f);
  const by = ch ? t.grade.byAct[ch.act] : undefined;
  return { css: { ...t.grade.css, ...(by?.css ?? {}) }, vignetteAmount: by?.vignetteAmount ?? t.grade.vignette.amount };
}

export const GradeLayer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const doc = useDocState();
  const f = useCurrentFrame();
  const filter = doc ? gradeFilter(gradeAt(doc.t, f).css) : undefined;
  return <AbsoluteFill style={{ filter, overflow: "hidden" }}>{children}</AbsoluteFill>;
};

export const SplitTone: React.FC = () => {
  const doc = useDocState();
  const f = useCurrentFrame();
  if (!doc) return null;
  const st = doc.t.grade.splitTone;
  if (!(st.amount > 0)) return null;
  const clip = doc.parts[partIndexAt(doc.parts, f)];
  if (clip?.treatment === "bw") return null;
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: st.shadows, mixBlendMode: "soft-light", opacity: Math.min(1, st.amount * 0.5) }} />
      <AbsoluteFill style={{ backgroundColor: st.highlights, mixBlendMode: "overlay", opacity: Math.min(1, st.amount * 0.35) }} />
    </>
  );
};
