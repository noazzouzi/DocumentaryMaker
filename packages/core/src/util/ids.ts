// packages/core/src/util/ids.ts — the ONE place item ids are built (content-stable where possible). Normative.
import type { SfxCategory } from "../schema/media";
import type { OverlayComponentId } from "../schema/components";
import type { FxKind } from "../schema/timeline";

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const ids = {
  chapter: (n: number) => `CH${n}`,
  segment: (chapterId: string, n: number) => `${chapterId}-S${pad(n, 2)}`,
  beat: (chapterId: string, seq: number) => `${chapterId}-B${pad(seq, 3)}`, // assigned in code after validation
  clipBeat: (segmentId: string) => `${segmentId}-CLIP`,
  breathBeat: (segmentId: string) => `${segmentId}-BR`,
  word: (segmentId: string, idx: number) => `${segmentId}:${idx}`,
  clipWord: (segmentId: string, n: number) => `clip:${segmentId}:${n}`,
  trWord: (segmentId: string, page: number, n: number) => `tr:${segmentId}:${page}:${n}`,
  // timeline items
  shot: (beatId: string, shot: number) => `v:${beatId}:${shot}`, // positional within a beat (overrides are fingerprinted)
  overlay: (ref: string, component: OverlayComponentId, n: number) => `ov:${ref}:${component}:${n}`,
  caption: (segmentId: string, n: number) => `cap:${segmentId}:${n}`,
  keywordCaption: (segmentId: string, n: number) => `kw:${segmentId}:${n}`,
  translationCaption: (segmentId: string, page: number) => `capt:${segmentId}:${page}`,
  fx: (sourceId: string, kind: FxKind) => `fx:${sourceId}:${kind}`,
  sfx: (sourceItemId: string, category: SfxCategory, n?: number) => (n === undefined ? `sfx:${sourceItemId}:${category}` : `sfx:${sourceItemId}:${category}:${n}`),
  music: (chapterId: string, restart?: number) => (restart === undefined ? `mus:${chapterId}` : `mus:${chapterId}:r${restart}`),
  silence: (reason: "reveal" | "chapter" | "drop_out" | "irony" | "bleep" | "user", ref: string) => `sil:${reason}:${ref}`,
  vo: (segmentId: string, part?: "b") => (part ? `vo:${segmentId}:${part}` : `vo:${segmentId}`),
  clipAudio: (segmentId: string) => `ca:${segmentId}`,
  marker: (kind: string, ref: string) => `mk:${kind}:${ref}`,
} as const;
