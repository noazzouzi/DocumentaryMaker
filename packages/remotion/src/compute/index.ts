// @docmaker/remotion/compute — PURE, no React, no node:* (used by calculateMetadata, the Player, render chunk planning, tests).
// Public contract: §4.19 compute stub (types verbatim in ./types; signatures unchanged). Extra exports are additive.
export type { ComputedChapter, ComputedTimeline, CoverWindow, SeriesSeq, SeriesTrans, VelocityEdge } from "./types";
export { computeTimeline, fillerClip, partIndexAt, pictureParts } from "./computeTimeline";
export { planChunks } from "./planChunks";
export { SLICE_HASH_VERSION, sliceHash } from "./sliceHash";
export { IMPLEMENTED_COVERS, coverCutOffset, coverIntensity, coverPhase, coverWindow, derivedCoverFx, dipPhases, resolveCover } from "./covers";
export { IMPLEMENTED_VELOCITY, PUSH_CUT_FLASH_COLOR, velocityPair } from "./velocity";
