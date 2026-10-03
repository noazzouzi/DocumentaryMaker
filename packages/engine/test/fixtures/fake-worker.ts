// Test job worker: the real worker loop (IPC, event push, disconnect handling) around an engine with the walking-skeleton
// fakes. DOCMAKER_TEST_RENDER_DELAY_MS slows the fake render down (crash/cancel tests).
import { loadRuntime } from "@docmaker/core/node";
import type { RenderClient } from "@docmaker/core";
import { runWorkerLoop } from "../../src/worker";
import { createEngineImpl } from "../../src/engine";
import { silentLogger } from "../../src/util";
import { FakeRenderClient, skeletonDeps } from "../fakes";

const { config } = loadRuntime({ cwd: process.cwd() });
const delay = Number(process.env.DOCMAKER_TEST_RENDER_DELAY_MS ?? "0");
const fake = new FakeRenderClient(config);
const render: RenderClient = {
  async render(req, h) {
    if (delay > 0) await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      h.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(Object.assign(new Error("canceled"), { code: "CANCELED" }));
      }, { once: true });
    });
    return fake.render(req, h);
  },
  renderStills: (r, h) => fake.renderStills(r, h),
  renderOverlays: () => fake.renderOverlays(),
  renderGeneratedStills: (r, h) => fake.renderGeneratedStills(r, h),
  probeGl: () => fake.probeGl(),
  close: () => fake.close(),
};

await runWorkerLoop({
  renderClient: render,
  cwd: config.repoRoot,
  makeEngine: async (rc, cwd) => {
    const e = await createEngineImpl({ cwd, renderClient: rc, deps: skeletonDeps(), logger: silentLogger });
    return {
      submit: (r) => e.submit(r), resume: (id) => e.resume(id), cancel: (id) => e.cancel(id), events: (id, a) => e.events(id, a),
      listLive: () => e.jobs.liveIds(), close: () => e.close(),
    };
  },
});
process.exit(0);
