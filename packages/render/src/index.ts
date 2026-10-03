// @docmaker/render — public API (packages/render/src/index.ts). Node only; never imported by apps/web.
// §4.19 contract (signatures unchanged); additional exports are additive helpers for the engine, QA and doctor.
export { RenderService, InProcessRenderClient, RENDER_LAYERS, OVERLAY_LAYERS, renderAllowList, chunksInRange, readTimelineFile } from "./service";
export type { RenderServiceOptions } from "./service";
export { createAssetServer, parseRange, resolveRequestPath, mimeFor } from "./assetServer";
export type { AssetServer, AssetServerOptions } from "./assetServer";
export { computeCodeHash } from "./bundle";
export { ensureBrowserExecutable, findBrowserExecutable, browserCandidates, REPO_CHROME_REL } from "./browser";
export { generateLutCube, lutCubeText, cachedLutCube, gradeRgb, LUT_SIZE } from "./lut";
export { loudnessGate, gateGainDb, gatePasses } from "./loudnessGate";
export { PRESETS, presetRenderOptions, presetSize, resolveConcurrency } from "./presets";
export type { PresetSpec, PresetId, GlMode } from "./presets";
export { readGlProbe, chooseGl, parseGlProbeLogs } from "./gl";
export { buildContactSheets, qaSheetPlan, frameLabel, MAX_TILES_PER_SHEET } from "./sheets";
export { postFilter } from "./post";
export { muxArgs } from "./mux";
export { concatListLine } from "./concat";
export { ProgressTracker, PHASE_WEIGHTS } from "./progress";
