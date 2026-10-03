// Render inputs bound to what was hashed (review P3 "render" bucket): the timeline is read once and served from memory
// at a content-addressed URL, the mix is pinned, and the chunk / generated-still keys cover the render backend, the
// style font bytes and the renderer code.
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTimeline } from "@docmaker/core/testing";
import { sliceHash } from "@docmaker/remotion/compute";
import { createAssetServer, resolveRequestPath } from "../src/assetServer";
import { chunkHashPreset, presetRenderOptions } from "../src/presets";
import { installRemotionNoiseFilter, isRemotionNoise } from "../src/remotion";
import { generatedStillKey, pinFile, readTimelineSnapshot, renderAllowList, styleFontsDigest } from "../src/service";
import { tmpDir } from "./helpers";

const SNAP = "render/en/master/snapshot/timeline.json";

describe("timeline snapshot bound to its bytes", () => {
  it("serves the bytes read at render start, whatever is later written to the snapshot path", async () => {
    const t = await tmpDir();
    try {
      const tl = makeTimeline({ seconds: 3 });
      await mkdir(path.join(t.dir, path.dirname(SNAP)), { recursive: true });
      await writeFile(path.join(t.dir, SNAP), JSON.stringify(tl));
      const snap = await readTimelineSnapshot(t.dir, SNAP);
      expect(snap.timeline.durationInFrames).toBe(tl.durationInFrames);
      expect(snap.urlPath).toMatch(/^_snapshot\/timeline-[0-9a-f]{16}\.json$/);

      // a second render job of the same lang/preset re-snapshots an edited timeline while this one waits/renders
      const edited = structuredClone(tl);
      edited.video[0] = { ...edited.video[0]!, source: { kind: "solid", color: "#123456" } };
      await writeFile(path.join(t.dir, SNAP), JSON.stringify(edited));

      const server = await createAssetServer({ root: t.dir, allow: renderAllowList(), memory: { [snap.urlPath]: snap.bytes } });
      try {
        const r = await fetch(`${server.url}/${snap.urlPath}`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toBe("application/json");
        expect(r.headers.get("cache-control")).toContain("immutable");
        expect(Buffer.from(await r.arrayBuffer()).equals(snap.bytes)).toBe(true);
        // ranges work on memory entries too
        const part = await fetch(`${server.url}/${snap.urlPath}`, { headers: { Range: "bytes=0-9" } });
        expect(part.status).toBe(206);
        expect(part.headers.get("content-range")).toBe(`bytes 0-9/${snap.bytes.length}`);
        expect(await part.text()).toBe(snap.bytes.subarray(0, 10).toString());
      } finally {
        await server.close();
      }
      // the chunk hashes are computed from the same bytes the pages render
      const ctx = { codeHash: "c", preset: "p", premount: 30 };
      expect(sliceHash(snap.timeline, 0, 59, ctx)).toBe(sliceHash(tl, 0, 59, ctx));
      // and the new snapshot gets a different content address
      const snap2 = await readTimelineSnapshot(t.dir, SNAP);
      expect(snap2.urlPath).not.toBe(snap.urlPath);
      expect(sliceHash(snap2.timeline, 0, 59, ctx)).not.toBe(sliceHash(snap.timeline, 0, 59, ctx));
    } finally {
      await t.cleanup();
    }
  });

  it("memory entries resolve before mounts and the allowlist, by exact path only", () => {
    const o = { root: "/p", allow: renderAllowList(), memory: { "_snapshot/timeline-abc.json": Buffer.from("{}") } };
    expect(resolveRequestPath("/_snapshot/timeline-abc.json?v=1", o)).toMatchObject({ kind: "memory", name: "_snapshot/timeline-abc.json" });
    expect(resolveRequestPath("/_snapshot/timeline-abd.json", o)).toEqual({ kind: "error", status: 403 });
    expect(resolveRequestPath("/_snapshot/./timeline-abc.json", o)).toMatchObject({ kind: "memory" });
  });

  it("re-reads a torn (being rewritten) snapshot, and reports one that stays unparsable", async () => {
    const t = await tmpDir();
    try {
      const tl = makeTimeline({ seconds: 2 });
      await mkdir(path.join(t.dir, path.dirname(SNAP)), { recursive: true });
      const abs = path.join(t.dir, SNAP);
      await writeFile(abs, JSON.stringify(tl).slice(0, 40)); // truncated mid-copy
      setTimeout(() => void writeFile(abs, JSON.stringify(tl)), 60);
      const snap = await readTimelineSnapshot(t.dir, SNAP);
      expect(snap.timeline.fps).toBe(tl.fps);
      await writeFile(abs, "{ nope");
      await expect(readTimelineSnapshot(t.dir, SNAP)).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(readTimelineSnapshot(t.dir, "render/en/master/snapshot/missing.json")).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
    } finally {
      await t.cleanup();
    }
  });
});

describe("mix pin", () => {
  it("keeps this job's audio when the snapshot mix is re-linked by another render job", async () => {
    const t = await tmpDir();
    try {
      const snapMix = path.join(t.dir, "snapshot", "mix.wav");
      await mkdir(path.dirname(snapMix), { recursive: true });
      await writeFile(snapMix, "mix-of-job-1");
      const pins = path.join(t.dir, "pins");
      const pinned = await pinFile(snapMix, pins);
      // job 2 snapshots: Store.linkOrCopy unlinks the snapshot and links the new mix (a fresh inode)
      const newMix = path.join(t.dir, "mix2.wav");
      await writeFile(newMix, "mix-of-job-2");
      await unlink(snapMix);
      await link(newMix, snapMix);
      expect(await readFile(pinned, "utf8")).toBe("mix-of-job-1");
      expect(path.basename(pinned)).toMatch(new RegExp(`^pin-${process.pid}-[0-9a-f]{8}\\.wav$`));
    } finally {
      await t.cleanup();
    }
  });

  it("removes pins left by dead processes, never a live job's", async () => {
    const t = await tmpDir();
    try {
      const pins = path.join(t.dir, "pins");
      await mkdir(pins, { recursive: true });
      await writeFile(path.join(pins, "pin-999999999-deadbeef.wav"), "x"); // no such pid
      await writeFile(path.join(pins, `pin-${process.ppid}-cafecafe.wav`), "x"); // live (our parent)
      const src = path.join(t.dir, "mix.wav");
      await writeFile(src, "m");
      const mine = await pinFile(src, pins);
      expect((await readdir(pins)).sort()).toEqual([path.basename(mine), `pin-${process.ppid}-cafecafe.wav`].sort());
    } finally {
      await t.cleanup();
    }
  });
});

describe("cache keys cover the render backend, font bytes and renderer code", () => {
  it("chunk hash preset differs per GL mode, GPU encode and font bytes", () => {
    const sw = { gl: "swangle" as const, encoder: presetRenderOptions("master", { gpu: false }), fonts: "" };
    const base = chunkHashPreset("master", sw);
    expect(base).toMatch(/^master@enc2:[0-9a-f]{12}$/);
    expect(chunkHashPreset("master", { ...sw })).toBe(base);
    expect(chunkHashPreset("master", { ...sw, gl: "angle-egl" })).not.toBe(base);
    expect(chunkHashPreset("master", { ...sw, encoder: presetRenderOptions("master", { gpu: true }) })).not.toBe(base);
    expect(chunkHashPreset("master", { ...sw, fonts: "abc" })).not.toBe(base);
    expect(chunkHashPreset("draft", { ...sw, encoder: presetRenderOptions("draft", { gpu: false }) })).not.toBe(base);
    // …and therefore every chunk's slice hash
    const tl = makeTimeline({ seconds: 3 });
    const h = (preset: string) => sliceHash(tl, 0, 59, { codeHash: "c", preset, premount: 30 });
    expect(h(chunkHashPreset("master", { ...sw, gl: "angle" }))).not.toBe(h(base));
  });

  it("style font digest follows the font file's bytes (same name, new glyphs)", async () => {
    const proj = await tmpDir();
    const styles = await tmpDir();
    try {
      const tl = makeTimeline({ seconds: 2 });
      expect(await styleFontsDigest(tl, proj.dir, styles.dir)).toBe(""); // no style fonts
      const font = path.join(styles.dir, "my-style", "fonts", "Headline.woff2");
      await mkdir(path.dirname(font), { recursive: true });
      await writeFile(font, "glyphs-v1");
      tl.render.fonts = [{ family: "Headline", weight: 700, style: "normal", url: "styles/my-style/fonts/Headline.woff2" }, { family: "Cdn", weight: 400, style: "normal", url: "https://cdn.example/x.woff2" }];
      const d1 = await styleFontsDigest(tl, proj.dir, styles.dir);
      expect(d1).toMatch(/^[0-9a-f]{12}$/);
      expect(await styleFontsDigest(tl, proj.dir, styles.dir)).toBe(d1);
      await writeFile(font, "glyphs-v2");
      expect(await styleFontsDigest(tl, proj.dir, styles.dir)).not.toBe(d1);
    } finally {
      await proj.cleanup();
      await styles.cleanup();
    }
  });

  it("generated-still key changes with the renderer code, the GL backend and the fonts", () => {
    const source = { kind: "solid", color: "#C0392B" };
    const tokens = { a: 1 };
    const ctx = { codeHash: "code-a", gl: "swangle" as const, fonts: "" };
    const k = generatedStillKey(source, tokens, ctx);
    expect(generatedStillKey(source, tokens, { ...ctx })).toBe(k);
    expect(generatedStillKey(source, tokens, { ...ctx, codeHash: "code-b" })).not.toBe(k);
    expect(generatedStillKey(source, tokens, { ...ctx, gl: "angle" })).not.toBe(k);
    expect(generatedStillKey(source, tokens, { ...ctx, fonts: "f" })).not.toBe(k);
    expect(generatedStillKey({ ...source, color: "#000000" }, tokens, ctx)).not.toBe(k);
  });
});

describe("Remotion memory-mismatch noise", () => {
  const esc = "\u001b";
  const yellow = (s: string) => `${esc}[33m${s}${esc}[39m`;
  it("matches the six lines of getAvailableMemory's warning (coloured or not), nothing else", () => {
    for (const line of [
      "Detected differing memory amounts:", "Memory reported by CGroup: 8796093017768.00 MB", "Memory reported by /proc/meminfo: 15000.00 MB",
      "Memory reported by Node: 14893.00 MB", "You might have inadvertently set the --memory flag of `docker run` to a value that is higher than the global Docker memory limit.",
      "Using the lower amount of memory for calculation.",
    ]) {
      expect(isRemotionNoise([line])).toBe(true);
      expect(isRemotionNoise([yellow(line)])).toBe(true);
    }
    expect(isRemotionNoise([yellow("Chrome crashed")])).toBe(false);
    expect(isRemotionNoise(["Memory is low"])).toBe(false);
    expect(isRemotionNoise([])).toBe(false);
  });

  it("the console.warn filter drops the block and passes other warnings through", () => {
    const seen: unknown[][] = [];
    const prev = console.warn;
    console.warn = (...a: unknown[]) => void seen.push(a);
    try {
      installRemotionNoiseFilter();
      console.warn(yellow("Detected differing memory amounts:"));
      console.warn(yellow("a real warning"));
    } finally {
      console.warn = prev;
    }
    expect(seen).toEqual([[yellow("a real warning")]]);
  });
});
