// One VisualSource inside a box: image → StillLayer, video → VideoLayer, generated → GeneratedBackdrop, solid → fill.
import type React from "react";
import type { VisualSource } from "@docmaker/core";
import type { Rect } from "../lib/geometry";
import { GeneratedBackdrop } from "./GeneratedBackdrop";
import { StillLayer } from "./StillLayer";
import { VideoLayer } from "./VideoLayer";

export const SourceView: React.FC<{ source: VisualSource; trimBefore: number; fit?: "cover" | "fill"; box?: Rect; style?: React.CSSProperties }> = ({ source, trimBefore, fit = "cover", box, style }) => {
  switch (source.kind) {
    case "image":
      return <StillLayer assetId={source.assetId} crop={source.crop} focal={source.focal} fit={fit} box={box} style={style} />;
    case "video":
      return <VideoLayer assetId={source.assetId} trimBefore={trimBefore} crop={source.crop} focal={source.focal} fit={fit} box={box} style={style} />;
    case "generated": {
      const inner = <GeneratedBackdrop recipe={source.recipe} seed={source.seed} palette={source.palette} text={source.text} />;
      if (!box) return inner;
      return <div style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, overflow: "hidden", ...style }}>{inner}</div>;
    }
    case "solid":
      return <div style={{ position: "absolute", left: box?.left ?? 0, top: box?.top ?? 0, width: box?.width ?? "100%", height: box?.height ?? "100%", backgroundColor: source.color, ...style }} />;
  }
};

/** Natural size of a source (null for generated/solid or unknown). */
export function sourceAssetId(source: VisualSource): string | null {
  return source.kind === "image" || source.kind === "video" ? source.assetId : null;
}
