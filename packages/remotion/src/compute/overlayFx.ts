// Picture treatments requested by overlay items, expressed as derived fx cues on the picture (CameraRig blur /
// FxLightLayer dark) instead of CSS backdrop-filter, which headless Chrome does not reproduce bit-exactly.
//   NumberCounter: background blur 0 → 3 px over its entry, held, released over its exit (§10.7)
//   KeywordSlam background "blur": picture blur 18 px + darken .55 for the slam (§10.7)
//   CommentPile: the cards sit over a blur-dim of the picture (blur 8 px; the dim is the component's own overlay)
import type { Anchor, FxCue, OverlayItem } from "@docmaker/core";

const programAnchor = (offset: number): Anchor => ({ ref: "program", edge: "start", offset });

function spanCue(item: OverlayItem, fx: "blur" | "dark", amt: number, fade: number): FxCue {
  return {
    id: `fx:${item.id}:${fx}`, start: programAnchor(item.from), end: programAnchor(item.from + item.dur), from: item.from, dur: item.dur,
    fx, shape: "span", pre: 0, curve: 1, fade: Math.max(1, fade), amt, decay: null, hz: null, ampY: null, rotDeg: null, x: null, y: null,
    color: null, seed: 0, target: "picture",
  };
}

export function derivedOverlayFx(item: OverlayItem): FxCue[] {
  if (item.component === "NumberCounter") return [spanCue(item, "blur", 3, Math.max(item.enterFrames, 4))];
  if (item.component === "KeywordSlam" && item.props.background === "blur") return [spanCue(item, "blur", 18, 2), spanCue(item, "dark", 0.55, 2)];
  if (item.component === "CommentPile") return [spanCue(item, "blur", 8, 6)];
  return [];
}
