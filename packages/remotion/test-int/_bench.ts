// temporary (not committed): renderMedia throughput on a busy window
import path from "node:path";
import { buildTimeline } from "./helpers/timelines";
import { browserExecutable, bundleEntry, chromiumOptions, enableDeterministicRaster, loadRemotion, makeTmp, startAssetServer, writeJson, writeProjectMedia } from "./helpers/harness";
import { withRenderLock } from "./helpers/lock";
const range = (process.argv[2] ?? "250,549").split(",").map(Number) as [number, number];
const t = buildTimeline();
const { bundler, renderer } = await loadRemotion();
const tmp = await makeTmp("dm-bench-");
await withRenderLock("w7-bench", async () => {
  const serveUrl = await bundleEntry(bundler, path.join(tmp.dir, "bundle"));
  const proj = path.join(tmp.dir, "proj");
  await writeProjectMedia(t, proj);
  await writeJson(path.join(proj, "timeline.json"), t);
  const srv = await startAssetServer(proj);
  if (process.env.CPU_RASTER) enableDeterministicRaster();
  const exe = browserExecutable();
  const inputProps = { timeline: null, timelineUrl: `${srv.url}/timeline.json`, assetBaseUrl: srv.url, mode: "render", itemId: null, scratchBanner: false, layers: { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: false } };
  const c = await renderer.selectComposition({ serveUrl, id: "Documentary", inputProps, browserExecutable: exe, chromiumOptions, logLevel: "error" });
  const t0 = Date.now();
  let slow: { frame: number; time: number }[] = [];
  await renderer.renderMedia({ composition: c, serveUrl, inputProps, codec: "h264-ts", muted: true, frameRange: range, outputLocation: path.join(tmp.dir, "out.ts"), browserExecutable: exe, chromiumOptions, concurrency: 2, logLevel: "error", onSlowestFrames: (s) => { slow = s.map((x) => ({ frame: x.frame, time: Math.round(x.time) })); } });
  const n = range[1] - range[0] + 1;
  const ms = Date.now() - t0;
  console.log(`rendered ${n} frames in ${ms} ms → ${(n / (ms / 1000)).toFixed(1)} fps; slowest`, slow.slice(0, 6));
  await srv.close();
});
await tmp.cleanup();
