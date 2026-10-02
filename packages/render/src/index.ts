// @docmaker/render — public API (packages/render/src/index.ts). Node only; never imported by apps/web.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type {
  GeneratedStillsRequest, GlProbe, Logger, LutParams, OverlayRenderRequest, RenderClient, RenderHandlers, RenderRequest, RenderResult,
  RuntimeConfig, StillsRequest,
} from "@docmaker/core";

export interface RenderServiceOptions { config: RuntimeConfig; logger: Logger; enableBundleCache?: boolean /* tests: false */ }
export class RenderService {
  /** P0 stub: constructor arguments are kept for inspection in tests. */
  readonly stubArgs: readonly unknown[];
  constructor(o: RenderServiceOptions) {
    this.stubArgs = [o];
  }
  /** codeHash = sha256(sorted path+sha of packages/remotion/src/**, packages/core/src/** + pinned remotion/@fontsource versions). */
  ensureBundle(signal: AbortSignal): Promise<{ serveUrl: string; codeHash: string }> {
    throw notImplemented("render.RenderService.ensureBundle");
  }
  render(req: RenderRequest, h: RenderHandlers): Promise<RenderResult> {
    throw notImplemented("render.RenderService.render");
  }
  renderStills(req: StillsRequest, h: RenderHandlers): Promise<string[]> {
    throw notImplemented("render.RenderService.renderStills");
  }
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]> {
    throw notImplemented("render.RenderService.renderOverlays");
  }
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]> {
    throw notImplemented("render.RenderService.renderGeneratedStills");
  }
  probeGl(force?: boolean): Promise<GlProbe> {
    throw notImplemented("render.RenderService.probeGl");
  }
  close(): Promise<void> {
    throw notImplemented("render.RenderService.close");
  }
}
/** Same semantics as RenderService; used by the CLI, the job worker and tests. */
export class InProcessRenderClient implements RenderClient {
  /** P0 stub: constructor arguments are kept for inspection in tests. */
  readonly stubArgs: readonly unknown[];
  constructor(o: RenderServiceOptions) {
    this.stubArgs = [o];
  }
  render(req: RenderRequest, h: RenderHandlers): Promise<RenderResult> {
    throw notImplemented("render.InProcessRenderClient.render");
  }
  renderStills(req: StillsRequest, h: RenderHandlers): Promise<string[]> {
    throw notImplemented("render.InProcessRenderClient.renderStills");
  }
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]> {
    throw notImplemented("render.InProcessRenderClient.renderOverlays");
  }
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]> {
    throw notImplemented("render.InProcessRenderClient.renderGeneratedStills");
  }
  probeGl(force?: boolean): Promise<GlProbe> {
    throw notImplemented("render.InProcessRenderClient.probeGl");
  }
  close(): Promise<void> {
    throw notImplemented("render.InProcessRenderClient.close");
  }
}
/** Read-only CORS + Range static server bound to 127.0.0.1:<random>; allowlisted path prefixes; `?v=` query ignored. */
export function createAssetServer(o: { root: string; allow: readonly RegExp[]; mounts?: Record<string, string> }): Promise<{ url: string; close(): Promise<void> }> {
  throw notImplemented("render.createAssetServer");
}
export function computeCodeHash(repoRoot: string): Promise<string> {
  throw notImplemented("render.computeCodeHash");
}
/** <home>/browser.json → executable; else copy/download Chrome Headless Shell (only when download=true). */
export function ensureBrowserExecutable(config: RuntimeConfig, o: { download: boolean; signal: AbortSignal }): Promise<string> {
  throw notImplemented("render.ensureBrowserExecutable");
}
/** 33³ .cube from LutParams (HyperFrames luts spec) for ffmpeg lut3d in master post. */
export function generateLutCube(p: LutParams, outPath: string): Promise<void> {
  throw notImplemented("render.generateLutCube");
}
/** Post-AAC true-peak gate: re-mux with volume=(gate − TP − 0.3) dB, ≤ 2 attempts. */
export function loudnessGate(mp4: string, o: { gateDbtp: number; targetLufs: number; config: RuntimeConfig; signal: AbortSignal }): Promise<{ integratedLufs: number; truePeakDbtp: number; attempts: number; ok: boolean }> {
  throw notImplemented("render.loudnessGate");
}
