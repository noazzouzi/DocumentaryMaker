// Lazy loaders for Remotion's Node packages (heavy; only loaded when a render/bundle actually runs).
import type { Logger } from "@docmaker/core";
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
/**
 * The GlProbe composition's console lines. Remotion's defaultOnLog echoes every console.log of the bundle to stdout
 * (tagged `[Tab N, file:line]`) whatever `logLevel` says — it compares the browser log's own level with itself — and
 * the public API offers no onLog override. gl.ts already collects them through onBrowserLog.
 */
const BROWSER_PROBE_LINE = /^\[?\s*Tab \d+\b[^\]]*?\]?\s+(UNMASKED_RENDERER_WEBGL=|GL_PROBE )/;
const ANSI = /\u001b\[[0-9;]*m/g;
const argsText = (args: readonly unknown[]): string => args.map((a) => (typeof a === "string" ? a : "")).join(" ").replace(ANSI, "").replace(/\s+/g, " ").trim();
/** Whether a console.warn call is Remotion's memory-mismatch noise (exported for tests). */
export function isRemotionNoise(args: readonly unknown[]): boolean {
  if (args.length === 0) return false;
  const text = argsText(args);
  return REMOTION_NOISE.some((re) => re.test(text));
}
/** Whether a console.log/info call is Remotion echoing the GL probe's browser console lines (exported for tests). */
export function isBrowserProbeLog(args: readonly unknown[]): boolean {
  return args.length > 0 && BROWSER_PROBE_LINE.test(argsText(args));
}

let debugLogger: Logger | null = null;
/** Where the filtered Remotion lines go (debug level only; the newest RenderService wins; null drops them). */
export function setRemotionDebugLogger(logger: Logger | null): void {
  debugLogger = logger;
}
let filterInstalled = false;
/**
 * Wraps console.warn/log/info once so Remotion's memory-mismatch block and the GL probe's echoed browser lines go to
 * the debug log instead of the terminal; every other line passes through.
 */
export function installRemotionNoiseFilter(): void {
  if (filterInstalled) return;
  filterInstalled = true;
  const toDebug = (args: readonly unknown[]): void => {
    try {
      debugLogger?.debug("remotion", { line: argsText(args) });
    } catch {
      /* logging must never throw */
    }
  };
  const wrap = (method: "warn" | "log" | "info", isNoise: (args: readonly unknown[]) => boolean): void => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (isNoise(args)) return toDebug(args);
      original(...args);
    };
  };
  wrap("warn", isRemotionNoise);
  wrap("log", isBrowserProbeLog);
  wrap("info", isBrowserProbeLog);
}

/** Composition ids registered by @docmaker/remotion's Root (COMPOSITION_IDS; not imported to keep React out of Node). */
export const COMPOSITIONS = {
  doc: "Documentary", overlay: "DocumentaryOverlay", item: "OverlayItem",
  still: "GeneratedStill", gl: "GlProbe", fonts: "FontSpecimen", specimen: "StyleSpecimen",
} as const;
