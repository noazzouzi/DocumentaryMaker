// Walking-skeleton fakes (§16.5): implement the §4.19 signatures of packages whose M1 is still being built, with minimal
// valid outputs. The skeleton e2e uses real styles, llm, voice and director; these fakes for assets, audio, export and the
// render client (ffmpeg-written MP4, no Chrome).
import { REAL_DEPS, type EngineDeps } from "../../src/deps";
import { makeFakeAssets } from "./assets";
import { makeFakeAudio } from "./audio";
import { makeFakeExporter } from "./export";

export { makeFakeAssets } from "./assets";
export { makeFakeAudio } from "./audio";
export { makeFakeExporter } from "./export";
export { FakeRenderClient } from "./render";

/** Real packages where they exist; fakes for assets, audio and export. */
export function skeletonDeps(base: EngineDeps = REAL_DEPS): EngineDeps {
  return { ...base, assets: makeFakeAssets(), audio: makeFakeAudio(), exporter: makeFakeExporter() };
}
