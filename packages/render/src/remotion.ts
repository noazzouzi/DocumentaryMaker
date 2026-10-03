// Lazy loaders for Remotion's Node packages (heavy; only loaded when a render/bundle actually runs).
type Bundler = typeof import("@remotion/bundler");
type Renderer = typeof import("@remotion/renderer");
export type HeadlessBrowser = Awaited<ReturnType<Renderer["openBrowser"]>>;
export type VideoConfig = Awaited<ReturnType<Renderer["selectComposition"]>>;
export type BrowserLog = Parameters<NonNullable<Parameters<Renderer["renderMedia"]>[0]["onBrowserLog"]>>[0];

let bundler: Promise<Bundler> | null = null;
let renderer: Promise<Renderer> | null = null;
export const loadBundler = (): Promise<Bundler> => (bundler ??= import("@remotion/bundler"));
export const loadRenderer = (): Promise<Renderer> => (renderer ??= import("@remotion/renderer"));

/** Composition ids registered by @docmaker/remotion's Root (COMPOSITION_IDS; not imported to keep React out of Node). */
export const COMPOSITIONS = {
  doc: "Documentary", overlay: "DocumentaryOverlay", item: "OverlayItem",
  still: "GeneratedStill", gl: "GlProbe", fonts: "FontSpecimen", specimen: "StyleSpecimen",
} as const;
