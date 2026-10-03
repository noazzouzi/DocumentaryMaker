// Lazy loaders for Remotion's Node packages (heavy; only loaded when a render/bundle actually runs).
type Bundler = typeof import("@remotion/bundler");
type Renderer = typeof import("@remotion/renderer");
export type HeadlessBrowser = Awaited<ReturnType<Renderer["openBrowser"]>>;
export type VideoConfig = Awaited<ReturnType<Renderer["selectComposition"]>>;
export type BrowserLog = Parameters<NonNullable<Parameters<Renderer["renderMedia"]>[0]["onBrowserLog"]>>[0];

let bundler: Promise<Bundler> | null = null;
let renderer: Promise<Renderer> | null = null;
export const loadBundler = (): Promise<Bundler> => (bundler ??= import("@remotion/bundler"));
export const loadRenderer = (): Promise<Renderer> => (renderer ??= (installRemotionNoiseFilter(), import("@remotion/renderer")));

/**
 * Lines of @remotion/renderer's getAvailableMemory warning (memory/get-available-memory.js, printed through
 * console.warn at logLevel "warn"). It fires once per page/selectComposition/renderStill whenever the cgroup limit is
 * finite and > 1.25 × os.freemem() — on a container with a huge-but-finite limit that is ~100 six-line blocks per
 * demo, burying the stage progress. Remotion already uses the lower amount; the message carries no action for us.
 */
const REMOTION_NOISE = [
  /^Detected differing memory amounts:/,
  /^Memory reported by (CGroup|\/proc\/meminfo|Node):/,
  /^You might have inadvertently set the --memory flag of `docker run`/,
  /^Using the lower amount of memory for calculation\./,
];
const ANSI = /\u001b\[[0-9;]*m/g;
/** Whether a console.warn call is Remotion's memory-mismatch noise (exported for tests). */
export function isRemotionNoise(args: readonly unknown[]): boolean {
  if (args.length === 0) return false;
  const text = args.map((a) => (typeof a === "string" ? a : "")).join(" ").replace(ANSI, "").trim();
  return REMOTION_NOISE.some((re) => re.test(text));
}
let filterInstalled = false;
/** Wraps console.warn once so Remotion's memory-mismatch block is dropped; every other warning passes through. */
export function installRemotionNoiseFilter(): void {
  if (filterInstalled) return;
  filterInstalled = true;
  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (isRemotionNoise(args)) return;
    original(...args);
  };
}

/** Composition ids registered by @docmaker/remotion's Root (COMPOSITION_IDS; not imported to keep React out of Node). */
export const COMPOSITIONS = {
  doc: "Documentary", overlay: "DocumentaryOverlay", item: "OverlayItem",
  still: "GeneratedStill", gl: "GlProbe", fonts: "FontSpecimen", specimen: "StyleSpecimen",
} as const;
