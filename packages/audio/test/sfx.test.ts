import { existsSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { SfxManifest } from "@docmaker/core";
import type { SfxEntry } from "@docmaker/core";
import { readWav, sha256File } from "@docmaker/core/node";
import { M1_CATEGORIES, SFX_RECIPES, ensureSfxPack, loadSfxEntries, proceduralDir, renderedDurationSec, syncPointMs } from "../src/index";
import { makeCtx } from "./helpers";

const ctx = makeCtx();
let manifest: SfxManifest;
const byId = (id: string): SfxEntry => manifest.entries.find((e) => e.id === id)!;

beforeAll(async () => {
  manifest = await ensureSfxPack("procedural", ctx);
}, 120_000);

describe("procedural SFX pack", () => {
  it("covers every recipe variant with a schema-valid manifest and the M1 subset", async () => {
    expect(() => SfxManifest.parse(manifest)).not.toThrow();
    const want = SFX_RECIPES.flatMap((r) => r.variants.map((v) => `procedural:${r.category}/${v.variant}`)).sort();
    expect(manifest.entries.map((e) => e.id)).toEqual(want);
    for (const c of ["whoosh.light", "whoosh.whip", "whoosh.up", "riser", "impact", "boom.sub", "boom.low", "thud", "pop", "click", "tick", "ding", "shutter", "paper", "keys", "glitch", "bleep", "drone", "ambience.room"]) {
      expect(M1_CATEGORIES).toContain(c);
      expect(manifest.entries.some((e) => e.category === c)).toBe(true);
    }
    const dir = proceduralDir(ctx);
    expect(existsSync(path.join(dir, "manifest.json"))).toBe(true);
    for (const e of manifest.entries) {
      expect(path.dirname(e.file)).toBe(dir);
      expect(e.license.code).toBe("PROCEDURAL");
      expect(e.assetId).toBe(await sha256File(e.file));
    }
  });

  it("writes 48 kHz stereo files whose analysis matches the manifest", async () => {
    for (const e of manifest.entries) {
      const w = await readWav(e.file);
      expect(w.sampleRate).toBe(48000);
      expect(w.channels).toBe(2);
      expect(Math.abs(Math.round((w.data[0]!.length * 1000) / 48000) - e.durationMs)).toBeLessThanOrEqual(1);
      let pk = 0;
      for (const c of w.data) for (const v of c) pk = Math.max(pk, Math.abs(v));
      expect(Math.abs(20 * Math.log10(pk) - e.peakDbfs)).toBeLessThan(0.05);
      if (e.durationMs >= 400) expect(e.lufs).not.toBeNull();
      else expect(e.lufs).toBeNull();
    }
  });

  it("puts the sync point of whooshes, risers and impacts within ±10 ms of the analytic peak", () => {
    for (const r of SFX_RECIPES) {
      if (!r.analyticPeakMs || !["whoosh.light", "whoosh.heavy", "whoosh.whip", "whoosh.up", "riser", "impact", "impact.soft", "swell.reverse"].includes(r.category)) continue;
      for (const v of r.variants) {
        const e = byId(`procedural:${r.category}/${v.variant}`);
        const analytic = r.analyticPeakMs(v.durationSec);
        expect(Math.abs(e.peakOffsetMs - analytic), `${e.id}: ${e.peakOffsetMs} vs ${analytic}`).toBeLessThanOrEqual(10);
      }
    }
    expect(byId("procedural:riser/0").syncPoint).toBe("end");
  });

  it("the analyser finds the designed peak of every noise sweep (two-slope fit) within ±15 ms", async () => {
    for (const r of SFX_RECIPES.filter((x) => x.syncPoint === "peak" && x.analyticPeakMs)) {
      for (const v of r.variants) {
        const e = byId(`procedural:${r.category}/${v.variant}`);
        const measured = syncPointMs((await readWav(e.file)).data, "peak");
        expect(Math.abs(measured - r.analyticPeakMs!(v.durationSec)), `${e.id}: ${measured}`).toBeLessThanOrEqual(15);
      }
    }
    // a synthetic asymmetric swell with a known apex
    const N = 48000, apex = 31000;
    const x = new Float32Array(N);
    let s = 12345;
    for (let i = 0; i < N; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const env = i < apex ? Math.pow(i / apex, 2.2) : Math.pow((N - i) / (N - apex), 1.3);
      x[i] = env * ((s / 4294967296) * 2 - 1);
    }
    expect(Math.abs(syncPointMs([x], "peak") - (apex * 1000) / 48000)).toBeLessThanOrEqual(15);
    expect(byId("procedural:riser/0").peakOffsetMs).toBe(byId("procedural:riser/0").durationMs - 30);
  });

  it("normalises short sounds to their category mid peak and long ones to −20 LUFS under a −1 dBFS ceiling", () => {
    expect(byId("procedural:pop/0").peakDbfs).toBeCloseTo(-19, 1);
    expect(byId("procedural:click/1").peakDbfs).toBeCloseTo(-21, 1);
    expect(byId("procedural:tick/0").peakDbfs).toBeCloseTo(-25, 1);
    expect(byId("procedural:bleep/0").peakDbfs).toBeCloseTo(-18, 1);
    for (const e of manifest.entries) {
      expect(e.peakDbfs).toBeLessThanOrEqual(-0.95);
      if (e.lufs !== null && e.category !== "bleep") {
        const capped = e.peakDbfs > -1.1; // the peak ceiling won over the loudness target
        if (!capped) expect(Math.abs(e.lufs - -20), e.id).toBeLessThan(0.6);
        else expect(e.lufs).toBeLessThan(-19.4);
      }
    }
  });

  it("marks loops and directions from the recipes; loopable files wrap seamlessly", async () => {
    for (const e of manifest.entries) {
      expect(e.loopable).toBe(["drone", "keys", "ambience.room", "heartbeat"].includes(e.category));
      expect(e.direction).toBe(e.category.startsWith("whoosh") ? "LR" : "none");
    }
    for (const id of ["procedural:drone/0", "procedural:drone/1", "procedural:ambience.room/0", "procedural:keys/0"]) {
      const w = await readWav(byId(id).file);
      for (const c of w.data) {
        const N = c.length;
        // the wrap step is no larger than the typical step between neighbours inside the file
        let typical = 0;
        for (let i = 1; i < N; i++) typical += Math.abs(c[i]! - c[i - 1]!);
        typical /= N - 1;
        let maxStep = 0;
        for (let i = 1; i < N; i++) maxStep = Math.max(maxStep, Math.abs(c[i]! - c[i - 1]!));
        const wrap = Math.abs(c[0]! - c[N - 1]!);
        expect(wrap, id).toBeLessThanOrEqual(Math.max(4 * typical, 0.5 * maxStep));
      }
    }
    const r = SFX_RECIPES.find((x) => x.category === "drone")!;
    expect(byId("procedural:drone/0").durationMs).toBe(Math.round(renderedDurationSec(r, r.variants[0]!) * 1000));
  });

  it("pans procedural whooshes left → right", async () => {
    const w = await readWav(byId("procedural:whoosh.light/0").file);
    const [L, R] = w.data as [Float32Array, Float32Array];
    const N = L.length;
    const e = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i]! * x[i]!; return s; };
    const early = e(R, 0, N / 3) / e(L, 0, N / 3);
    const late = e(R, (2 * N) / 3, N) / e(L, (2 * N) / 3, N);
    expect(late).toBeGreaterThan(early * 2);
  });

  it("is generated once: a second call reuses the files; a stale stamp regenerates", async () => {
    const before = manifest.entries.map((e) => e.assetId);
    const t0 = performance.now();
    const again = await ensureSfxPack("procedural", ctx);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(again.entries.map((e) => e.assetId)).toEqual(before);
    // deleting a file invalidates the pack; regeneration is byte-identical (deterministic recipes)
    await rm(again.entries[0]!.file);
    const regen = await ensureSfxPack("procedural", ctx);
    expect(regen.entries.map((e) => e.assetId)).toEqual(before);
  }, 120_000);

  it("stays valid when reached through another home path (moved home, shared cache): no regeneration", async () => {
    const moved = makeCtx();
    await cp(path.join(ctx.home, "sfx"), path.join(moved.home, "sfx"), { recursive: true });
    const t0 = performance.now();
    const m = await ensureSfxPack("procedural", moved);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(moved.events).toEqual([]); // no "generating" progress
    expect(m.entries.map((e) => e.assetId)).toEqual(manifest.entries.map((e) => e.assetId));
    for (const e of m.entries) expect(path.dirname(e.file)).toBe(proceduralDir(moved));
  }, 120_000);

  it("concurrent callers share one generation (machine lock)", async () => {
    const other = makeCtx();
    const [a, b] = await Promise.all([ensureSfxPack("procedural", other), ensureSfxPack("procedural", other)]);
    expect(a.entries.map((e) => e.assetId)).toEqual(b.entries.map((e) => e.assetId));
    expect(a.entries.map((e) => e.assetId)).toEqual(manifest.entries.map((e) => e.assetId));
  }, 120_000);

  it("loadSfxEntries merges packs sorted by id and skips missing optional packs", async () => {
    const entries = await loadSfxEntries(["procedural", "remotion-sfx-cc0", "procedural"], ctx);
    expect(entries.map((e) => e.id)).toEqual(manifest.entries.map((e) => e.id));
    await expect(ensureSfxPack("remotion-sfx-cc0", ctx)).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
    // a corrupt manifest file is ignored, not fatal
    const m = path.join(proceduralDir(ctx), "manifest.json");
    const keep = await readFile(m, "utf8");
    await writeFile(m, "{broken");
    const fixed = await loadSfxEntries(["procedural"], ctx);
    expect(fixed.length).toBe(manifest.entries.length);
    expect(JSON.parse(await readFile(m, "utf8")).entries.length).toBe(JSON.parse(keep).entries.length);
  }, 120_000);
});
