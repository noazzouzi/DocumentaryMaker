// Fake RenderClient (walking skeleton, §16.5): no Chrome. render() writes an MP4 with the timeline's exact frame count
// (flat 960×540 / 1920×1080 frames, ultrafast x264) muxed with the snapshot mix → QA probes are meaningful.
import { copyFile, mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { Timeline, type GlProbe, type RenderClient, type RenderResult, type RuntimeConfig } from "@docmaker/core";
import { ffmpegOk } from "./media";

export class FakeRenderClient implements RenderClient {
  readonly calls: { method: string; arg: unknown }[] = [];
  constructor(private readonly config: RuntimeConfig) {}

  async render(req: Parameters<RenderClient["render"]>[0], h: Parameters<RenderClient["render"]>[1]): Promise<RenderResult> {
    this.calls.push({ method: "render", arg: req });
    const t0 = Date.now();
    const t = Timeline.parse(JSON.parse(await readFile(path.join(req.projectDir, req.timelineRel), "utf8")));
    const [from, to] = req.frameRange ?? [0, t.durationInFrames - 1];
    const frames = to - from + 1;
    const size = req.preset === "draft" ? "960x540" : "1920x1080";
    const out = path.join(req.projectDir, req.outRel);
    await mkdir(path.dirname(out), { recursive: true });
    const sec = (frames / t.fps).toFixed(6);
    const audio = req.mixRel ? ["-ss", (from / t.fps).toFixed(6), "-i", path.join(req.projectDir, req.mixRel)] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
    h.onEvent({ type: "progress", stage: "render", lang: req.lang, pct: 0.1, message: "fake render", detail: { frames } });
    const tmp = `${out}.tmp.mp4`;
    await ffmpegOk(this.config, [
      "-f", "lavfi", "-i", `color=c=0x2a2f3a:s=${size}:r=${t.fps}`, ...audio,
      "-map", "0:v:0", "-map", "1:a:0", "-frames:v", String(frames), "-t", sec,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", tmp,
    ], h.signal);
    await rename(tmp, out);
    h.onEvent({ type: "progress", stage: "render", lang: req.lang, pct: 1, message: "fake render done", detail: { frames } });
    return { outFile: out, durationInFrames: t.durationInFrames, frames, chunks: [], renderMs: Date.now() - t0, gl: "fake", codeHash: "0".repeat(64), loudness: null };
  }

  async renderStills(req: Parameters<RenderClient["renderStills"]>[0], h: Parameters<RenderClient["renderStills"]>[1]): Promise<string[]> {
    this.calls.push({ method: "renderStills", arg: req });
    await mkdir(req.outDir, { recursive: true });
    const out = path.join(req.outDir, req.sheet ? "sheet-01.jpg" : `frame-${req.frames[0] ?? 0}.jpg`);
    await ffmpegOk(this.config, ["-f", "lavfi", "-i", "color=c=0x2a2f3a:s=640x360", "-frames:v", "1", out], h.signal);
    return [out];
  }

  async renderOverlays(): Promise<{ itemId: string; file: string }[]> {
    return [];
  }

  async renderGeneratedStills(req: Parameters<RenderClient["renderGeneratedStills"]>[0], h: Parameters<RenderClient["renderGeneratedStills"]>[1]): Promise<{ clipId: string; file: string }[]> {
    this.calls.push({ method: "renderGeneratedStills", arg: req });
    await mkdir(req.outDir, { recursive: true });
    const out: { clipId: string; file: string }[] = [];
    const first = path.join(req.outDir, "gen-000.png");
    if (req.clipIds.length) await ffmpegOk(this.config, ["-f", "lavfi", "-i", "color=c=0x2a2f3a:s=1920x1080", "-frames:v", "1", first], h.signal);
    for (const [k, clipId] of req.clipIds.entries()) {
      const file = path.join(req.outDir, `gen-${String(k).padStart(3, "0")}.png`);
      if (k > 0) await copyFile(first, file);
      out.push({ clipId, file });
    }
    return out;
  }

  async probeGl(): Promise<GlProbe> {
    return { schemaVersion: 1, chosen: "swangle", results: [], gpu: false, probedAt: "2026-10-02T00:00:00.000Z" };
  }

  async close(): Promise<void> {}
}
