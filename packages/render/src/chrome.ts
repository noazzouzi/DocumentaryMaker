// Chrome (Remotion openBrowser) with the deterministic-raster switch: on CPU hosts (swangle) tiles are rasterized on
// the CPU (--disable-gpu-rasterization), which makes repeated renders bit-exact (docs/ISSUES.md, W7 note). Remotion
// 4.0.532 exposes that flag only through __RESERVED_IS_INSIDE_REMOTION_LAMBDA, read once inside openBrowser().
import { loadRenderer, type HeadlessBrowser } from "./remotion";
import type { GlMode } from "./presets";

const RASTER_ENV = "__RESERVED_IS_INSIDE_REMOTION_LAMBDA";
let envQueue: Promise<unknown> = Promise.resolve();

export async function openChrome(exe: string, gl: GlMode, o: { cpuRaster: boolean }): Promise<HeadlessBrowser> {
  const { openBrowser } = await loadRenderer();
  // serialize the env-var window so concurrent opens never see each other's setting
  const job = envQueue.then(async () => {
    const prev = process.env[RASTER_ENV];
    if (o.cpuRaster) process.env[RASTER_ENV] = "true";
    else delete process.env[RASTER_ENV];
    try {
      return await openBrowser("chrome", { browserExecutable: exe, chromiumOptions: { gl }, logLevel: "warn" });
    } finally {
      if (prev === undefined) delete process.env[RASTER_ENV];
      else process.env[RASTER_ENV] = prev;
    }
  });
  envQueue = job.catch(() => undefined);
  return job;
}

export async function closeChrome(b: HeadlessBrowser | null | undefined): Promise<void> {
  if (!b) return;
  await b.close({ silent: true }).catch(() => undefined);
}
