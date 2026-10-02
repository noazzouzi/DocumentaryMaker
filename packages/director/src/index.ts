// @docmaker/director — public API (packages/director/src/index.ts). PURE: no I/O, no Date, no Math.random.
export { DIRECTOR_VERSION } from "./version";
export type { LayoutInput, DirectorInput, DirectorStats, DirectorOutput } from "./types";
export { layoutProgram } from "./layout";
export { direct } from "./direct";
export { groupCaptions } from "./captions";
export { lintTimeline, LINT_RULES, DIRECTOR_NOTES } from "./lint";
export { applyOverrides } from "./overrides";
export { SAFE_MESSAGING_CARD, SAFE_MESSAGING_TEXT } from "./resources";
