import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SfxManifest } from "@docmaker/core";
import { ffmpeg, readWav } from "@docmaker/core/node";
import { detectDirection, ensureSfxPack, importSfxPack, loadSfxEntries } from "../src/index";
import { makeCtx, tmpDir } from "./helpers";

const ctx = makeCtx();
let procedural: SfxManifest;
beforeAll(async () => { procedural = await ensureSfxPack("procedural", ctx); }, 120_000);

const lavfi = (file: string, src: string, extra: string[] = []) => ffmpeg(["-f", "lavfi", "-i", src, ...extra, file], { config: ctx.config, signal: ctx.signal });

describe("optional SFX packs", () => {
  it("imports a HyperFrames-style folder (manifest.json, mp3) with the Pixabay licence", async () => {
    const dir = tmpDir("audio-hf-");
    const m = {
      whoosh: { file: "whoosh.mp3", duration: 1 }, "impact-bass-1": { file: "impact-bass-1.mp3", duration: 2 },
      typing: { file: "typing.mp3", duration: 2 }, pop: { file: "pop.mp3", duration: 0.1 }, mystery: { file: "mystery.mp3", duration: 1 },
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m));
    // leading silence then an L→R noise sweep peaking at 0.75 s
    await lavfi(path.join(dir, "whoosh.mp3"), "aevalsrc='(random(0)*2-1)*exp(-pow((t-0.75)/0.15,2))*(1-t/1.2)|(random(1)*2-1)*exp(-pow((t-0.75)/0.15,2))*(t/1.2)':s=44100:d=1.2");
    await lavfi(path.join(dir, "impact-bass-1.mp3"), "aevalsrc='gte(t,0.1)*sin(2*PI*60*(t-0.1))*exp(-(t-0.1)/0.4)':s=44100:d=2");
    await lavfi(path.join(dir, "typing.mp3"), "aevalsrc='(random(0)*2-1)*exp(-mod(t,0.09)/0.004)':s=44100:d=2");
    await lavfi(path.join(dir, "pop.mp3"), "aevalsrc='sin(2*PI*700*t)*exp(-t/0.02)':s=44100:d=0.1");
    await lavfi(path.join(dir, "mystery.mp3"), "sine=f=440:d=1");
    const man = await importSfxPack("hyperframes-pixabay", dir, ctx);
    expect(man.entries.map((e) => e.id)).toEqual(["hyperframes-pixabay:impact/0", "hyperframes-pixabay:keys/0", "hyperframes-pixabay:pop/0", "hyperframes-pixabay:whoosh.light/0"]);
    const by = (c: string) => man.entries.find((e) => e.category === c)!;
    expect(by("whoosh.light").license.code).toBe("PIXABAY");
    expect(by("whoosh.light").license.restrictions).toContain("no-redistribution");
    expect(by("whoosh.light").direction).toBe("LR");
    expect(Math.abs(by("whoosh.light").peakOffsetMs - 750)).toBeLessThanOrEqual(40); // mp3 encoder delay included
    expect(by("impact").syncPoint).toBe("onset");
    expect(Math.abs(by("impact").peakOffsetMs - 100)).toBeLessThanOrEqual(40);
    expect(by("keys").loopable).toBe(true);
    expect(by("pop").lufs).toBeNull();
    expect(by("pop").peakDbfs).toBeCloseTo(-19, 0);
    for (const e of man.entries) {
      const w = await readWav(e.file);
      expect(w.sampleRate).toBe(48000);
      expect(w.channels).toBe(2);
    }
    expect((await ensureSfxPack("hyperframes-pixabay", ctx)).entries.length).toBe(4);
    // merged with the procedural pack, sorted by id
    const all = await loadSfxEntries(["procedural", "hyperframes-pixabay"], ctx);
    expect(all.length).toBe(procedural.entries.length + 4);
    expect(all.map((e) => e.id)).toEqual([...all.map((e) => e.id)].sort());
  }, 120_000);

  it("imports only the CC0 subset of @remotion/sfx and user packs with a declared licence", async () => {
    const dir = tmpDir("audio-rm-");
    copyFileSync(procedural.entries.find((e) => e.id === "procedural:whoosh.light/0")!.file, path.join(dir, "whoosh.wav"));
    copyFileSync(procedural.entries.find((e) => e.id === "procedural:ding/0")!.file, path.join(dir, "ding.wav"));
    copyFileSync(procedural.entries.find((e) => e.id === "procedural:impact/0")!.file, path.join(dir, "vineBoom.wav")); // meme sound: excluded
    const man = await importSfxPack("remotion-sfx-cc0", dir, ctx);
    expect(man.entries.map((e) => e.id)).toEqual(["remotion-sfx-cc0:ding/0", "remotion-sfx-cc0:whoosh.light/0"]);
    expect(man.entries.every((e) => e.license.code === "CC0")).toBe(true);
    expect(man.entries.find((e) => e.category === "whoosh.light")!.direction).toBe("LR");

    const user = tmpDir("audio-user-");
    mkdirSync(path.join(user, "thud"));
    copyFileSync(procedural.entries.find((e) => e.id === "procedural:thud/0")!.file, path.join(user, "thud", "door.wav"));
    copyFileSync(procedural.entries.find((e) => e.id === "procedural:click/0")!.file, path.join(user, "click-1.wav"));
    await expect(importSfxPack("user", user, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    writeFileSync(path.join(user, "license.json"), JSON.stringify({ code: "CC-BY", version: "4.0", url: null, commercialOk: true, derivativesOk: true, attributionRequired: true, attributionText: "Sounds by Me (CC BY 4.0)", restrictions: [] }));
    const um = await importSfxPack("user", user, ctx);
    expect(um.entries.map((e) => e.id)).toEqual(["user:click/0", "user:thud/0"]);
    expect(um.entries[0]!.license.code).toBe("CC-BY");
  }, 120_000);

  it("detects baked pan sweeps", () => {
    const n = 48000;
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { const s = Math.sin(i * 0.37); L[i] = s * (1 - i / n); R[i] = s * (i / n); }
    expect(detectDirection([L, R])).toBe("LR");
    expect(detectDirection([R, L])).toBe("RL");
    expect(detectDirection([L, L])).toBe("none");
  });
});
