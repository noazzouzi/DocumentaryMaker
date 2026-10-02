// Clip treatments (§10.7): bw = grade.treatments.bw CSS (and no split-tone, see SplitTone); archival = sepia/contrast CSS
// + a subtle gate weave (±1 px, seeded per frame); duotone = two-colour gradient map via SVG feComponentTransfer.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { sha8, type Grade } from "@docmaker/core";
import { unitRgb } from "../lib/color";
import { hashSigned } from "../lib/random";
import { gradeFilter } from "./Grade";

export type TreatmentKind = "none" | "bw" | "archival" | "duotone";

export const Treatment: React.FC<{ kind: TreatmentKind; grade: Grade; seedKey: string; localFrame: number; children: React.ReactNode }> = ({ kind, grade, seedKey, localFrame, children }) => {
  if (kind === "none") return <>{children}</>;
  if (kind === "bw" || kind === "archival") {
    const filter = gradeFilter(kind === "bw" ? grade.treatments.bw : grade.treatments.archival) ?? (kind === "bw" ? "grayscale(1)" : undefined);
    const weave = kind === "archival" ? { x: hashSigned(seedKey, "weave-x", localFrame) * 1, y: hashSigned(seedKey, "weave-y", localFrame) * 1 } : null;
    return (
      <AbsoluteFill style={{ filter, transform: weave ? `translate(${weave.x.toFixed(2)}px, ${weave.y.toFixed(2)}px)` : undefined }}>{children}</AbsoluteFill>
    );
  }
  const id = `dm-duo-${sha8(seedKey)}`;
  const [sr, sg, sb] = unitRgb(grade.treatments.duotone.shadows);
  const [hr, hg, hb] = unitRgb(grade.treatments.duotone.highlights);
  return (
    <AbsoluteFill>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <filter id={id} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues={`${sr.toFixed(4)} ${hr.toFixed(4)}`} />
            <feFuncG type="table" tableValues={`${sg.toFixed(4)} ${hg.toFixed(4)}`} />
            <feFuncB type="table" tableValues={`${sb.toFixed(4)} ${hb.toFixed(4)}`} />
          </feComponentTransfer>
        </filter>
      </svg>
      <AbsoluteFill style={{ filter: `url(#${id})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
