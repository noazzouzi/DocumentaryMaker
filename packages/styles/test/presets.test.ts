import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MotionData, MotionTemplate, TEMPLATE_COMPONENT, type MotionDataKey, type StyleData } from "@docmaker/core";
import { discoverStyles, inspectStyleDir } from "../src/index";
import { BUILTIN, REPO_ROOT } from "./helpers";

const registry = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: null });
const data = (id: string): StyleData => registry.get(id).data;

describe("built-in styles", () => {
  it("ship drama-commentary plus the M3 presets", async () => {
    expect((await readdir(BUILTIN)).sort()).toEqual(["cinematic-essay", "drama-commentary", "true-crime-dossier"]);
    expect(registry.list().map((s) => s.id)).toEqual(["cinematic-essay", "drama-commentary", "true-crime-dossier"]);
  });

  it.each(["cinematic-essay", "drama-commentary", "true-crime-dossier"])("%s lints with no error and no warning", async (id) => {
    const rep = await inspectStyleDir(join(BUILTIN, id));
    expect(rep.issues).toEqual([]);
  });

  it.each(["cinematic-essay", "drama-commentary", "true-crime-dossier"])("%s: visualGrammar formats parse with core MotionData", (id) => {
    const g = registry.get(id).promptPack.visualGrammar;
    for (const t of MotionTemplate.options) {
      if (t === "none") continue;
      const m = new RegExp(`^- ${t} \\(([A-Za-z]+)[^)]*\\): (\\{.*\\})$`, "m").exec(g);
      expect(m, `${id}: ${t}`).not.toBeNull();
      expect(m![1]).toBe(TEMPLATE_COMPONENT[t]);
      expect(MotionData[t as MotionDataKey].safeParse(JSON.parse(m![2]!)).success).toBe(true);
    }
  });

  it("story shapes follow the Appendix A preset table", () => {
    expect(data("cinematic-essay").scriptProfile.storyShapes.map((s) => s.id)).toEqual(["essay-arc"]);
    expect(data("true-crime-dossier").scriptProfile.storyShapes.map((s) => s.id)).toEqual(["investigation"]);
  });
});

describe("cinematic-essay preset (Appendix A table)", () => {
  const d = data("cinematic-essay");
  it("pacing, camera and transitions", () => {
    expect(d.scriptProfile.charsPerSec).toEqual({ en: 15.0, fr: 14.5 });
    expect(d.cameraPolicy.shots.aslSec).toEqual([4, 8]);
    expect(d.cameraPolicy.shots.maxStaticHoldSec).toBe(8);
    expect(d.cameraPolicy.kenBurns.scaleRatePerSec).toEqual([0.015, 0.025]);
    expect(d.cameraPolicy.kenBurns.driftPxPerSec).toEqual([6, 12]);
    expect(d.cameraPolicy.punch.perMin).toEqual([0, 2]);
    expect(d.cameraPolicy.punch.fillToMin).toBe(false);
    expect(d.transitionPolicy.cutShare).toBe(0.75);
    expect(d.transitionPolicy.primary).toBe("dissolve");
    expect(d.transitionPolicy.accents).toEqual(["zoomThrough", "lightLeak", "dipToBlack"]);
    const all = Object.values(d.transitionPolicy.energyFrames).flat();
    expect(Math.min(...all)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...all)).toBeLessThanOrEqual(30);
  });
  it("stills, captions, grade, sound, motion", () => {
    expect(d.stills.layoutWeights).toEqual({ cover: 0.4, card: 0.6 });
    expect(d.tokens.backdrop).toBe("paper");
    expect(d.captionDNA.defaultMode).toBe("srt-only");
    expect(d.components.find((c) => c.id === "KeywordSlam")!.enabled).toBe(false);
    expect(d.grade.look).toBe("filmFade");
    expect(d.grade.lut).toMatchObject({ blacks: 0.35, contrast: -0.28, temp: 0.16 });
    expect(d.grade.grainFfmpeg).toBeGreaterThanOrEqual(6);
    expect(d.grade.grainFfmpeg).toBeLessThanOrEqual(8);
    expect(d.grade.vignette.amount).toBe(0.35);
    expect(d.grade.letterbox).toBe(2.39);
    expect(d.sfxPolicy.perMin).toEqual([2, 5]);
    expect(d.sfxPolicy.impactsPerMin[1]).toBeLessThanOrEqual(1);
    expect(d.motion.overshootAllowedIn).toEqual([]);
    expect(d.budgets.titleSting).toBe(false);
    expect(d.clipLayout).toBe("cover");
  });
  it("letterboxed text zones stay inside the 2.39 picture area", () => {
    const bar = Math.ceil((1080 - 1920 / 2.39) / 2);
    for (const k of ["center", "lowerThird", "topLeft", "topRight", "captionBand"] as const) {
      const z = d.tokens.layout.zones[k];
      expect(z.y, k).toBeGreaterThanOrEqual(bar);
      expect(z.y + z.h, k).toBeLessThanOrEqual(1080 - bar);
    }
  });
});

describe("true-crime-dossier preset (Appendix A table)", () => {
  const d = data("true-crime-dossier");
  it("pacing, camera and transitions", () => {
    expect(d.scriptProfile.charsPerSec).toEqual({ en: 15.5, fr: 15.0 });
    expect(d.cameraPolicy.shots.aslSec).toEqual([4, 10]);
    expect(d.cameraPolicy.shots.maxStaticHoldSec).toBe(10);
    expect(d.cameraPolicy.creep.scale).toEqual([1.0, 1.06]);
    expect(d.cameraPolicy.handheld).toEqual({ ampPx: 1, fps: 3 });
    expect(d.cameraPolicy.punch.perMin).toEqual([0, 1]);
    expect(d.cameraPolicy.punch.fillToMin).toBe(false);
    expect(d.transitionPolicy.cutShare).toBe(0.9);
    expect(d.transitionPolicy.primary).toBe("dipToBlack");
    expect(d.transitionPolicy.accents).toEqual(["flash", "glitch"]);
  });
  it("stills, captions, grade, sound, motion", () => {
    expect(d.stills.layoutWeights.card).toBe(0.5);
    expect(d.tokens.backdrop).toBe("darkNoise");
    expect(d.captionDNA.variant).toBe("rail");
    expect(d.captionDNA.font).toBe("JetBrains Mono");
    expect(d.grade.look).toBe("desatCool");
    expect(d.grade.vignette.amount).toBe(0.45);
    expect(d.grade.grainFfmpeg).toBeGreaterThanOrEqual(8);
    expect(d.grade.grainFfmpeg).toBeLessThanOrEqual(10);
    expect(d.sfxPolicy.perMin).toEqual([2, 4]);
    expect(d.sfxPolicy.impactsPerMin[1]).toBeLessThanOrEqual(1);
    expect(Object.keys(d.sfxPolicy.peakDb)).toEqual(expect.arrayContaining(["drone", "ambience.room", "heartbeat"]));
    expect(d.motion.overshootAllowedIn).toEqual([]);
    expect(d.budgets.titleSting).toBe(true);
    expect(d.clipLayout).toBe("cover");
  });
});
