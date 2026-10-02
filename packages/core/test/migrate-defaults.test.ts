import { describe, expect, it } from "vitest";
import { DOC_VERSIONS, Project, defaultProject, isDocmakerError, migrateDoc, registerMigration, slugify } from "../src/index";

describe("migrateDoc", () => {
  it("passes current documents through untouched", () => {
    const raw = { schemaVersion: DOC_VERSIONS.project, a: 1 };
    expect(migrateDoc("project", raw)).toEqual({ value: raw, migratedFrom: null });
  });
  it("runs the registered chain from schemaVersion up to the current version without mutating the input", () => {
    registerMigration("fixture", 0, (r) => ({ ...r, renamed: r.old, old: undefined }));
    const raw = { schemaVersion: 0, old: "x" };
    const r = migrateDoc("fixture", raw);
    expect(r.migratedFrom).toBe(0);
    expect(r.value).toMatchObject({ schemaVersion: 1, renamed: "x" });
    expect(raw).toEqual({ schemaVersion: 0, old: "x" });
  });
  it("throws MIGRATION_FAILED for a missing step, a newer version or a missing schemaVersion", () => {
    for (const raw of [{ schemaVersion: 0 }, { schemaVersion: 7 }, {}, null]) {
      try {
        migrateDoc("timeline", raw);
        expect.unreachable();
      } catch (e) {
        expect(isDocmakerError(e) && e.code === "MIGRATION_FAILED").toBe(true);
      }
    }
  });
  it("refuses out-of-range registrations", () => {
    expect(() => registerMigration("timeline", 1, (r) => r)).toThrow();
  });
});

describe("defaultProject", () => {
  const now = new Date("2026-10-02T10:00:00.000Z");
  const none = { hasElevenLabs: false, kokoro: false, piper: false, homeDefaults: null };
  it("fills the §4.2 defaults", () => {
    const p = defaultProject({ idea: "La rupture catastrophique de Johnny Depp" }, now, none);
    expect(Project.safeParse(p).success).toBe(true);
    expect(p.slug).toBe("la-rupture-catastrophique-de-johnny-depp");
    expect(p.languages).toEqual(["en"]);
    expect(p.primaryLang).toBe("en");
    expect(p.targetMinutes).toBe(20);
    expect(p.styleId).toBeNull();
    expect(p.styleConfirmed).toBe(false);
    expect(p.video).toEqual({ fps: 30, width: 1920, height: 1080 });
    expect(p.voice.en?.provider).toBe("synthetic");
    expect(p.audio).toEqual({ music: "procedural", musicLibraryDir: null, sfxPacks: ["procedural"], targetLufs: -14, truePeakTarget: -1.5, truePeakGate: -1.0 });
    expect(p.render).toEqual({ defaultPreset: "draft", gl: "auto", concurrency: null, chunkSeconds: 60 });
    expect(p.editorial).toEqual({ asOf: "2026-10-02", monetized: true, fairUseAcknowledged: false });
    expect(p.budget.maxUsdPerStage).toBe(25);
    expect(p.budget.maxUsdTotal).toBe(40);
    expect(p.assets.providers[0]).toBe("local");
    expect(p.export.formats).toContain("reference-mp4");
    expect(p.createdAt).toBe(now.toISOString());
  });
  it("uses explicit input, then home defaults, and picks voices from what is available", () => {
    const p = defaultProject({ idea: "Tulip mania", languages: ["fr", "en"], styleId: "drama-commentary", seed: 7 }, now, { ...none, hasElevenLabs: true });
    expect(p.primaryLang).toBe("fr");
    expect(p.styleConfirmed).toBe(true);
    expect(p.seed).toBe(7);
    expect(p.voice.fr?.provider).toBe("elevenlabs");
    expect(p.voice.fr?.modelId).toBe("eleven_multilingual_v2");
    const h = defaultProject({ idea: "Tulip mania" }, now, { ...none, kokoro: true, homeDefaults: { languages: ["fr"], targetMinutes: 30 } });
    expect(h.languages).toEqual(["fr"]);
    expect(h.targetMinutes).toBe(30);
    expect(h.voice.fr).toMatchObject({ provider: "kokoro", voiceId: "30" });
    const pi = defaultProject({ idea: "Tulip mania" }, now, { ...none, piper: true });
    expect(pi.voice.en).toMatchObject({ provider: "piper", voiceId: "en_US-john-medium" });
  });
  it("title is the idea truncated to 80 characters", () => {
    const idea = "x".repeat(120);
    expect(defaultProject({ idea, slug: "x" }, now, none).title).toHaveLength(80);
  });
});

describe("slugify", () => {
  it("NFKD ascii lowercase dashes, ≤ 48 chars", () => {
    expect(slugify("La rupture catastrophique de Johnny Depp")).toBe("la-rupture-catastrophique-de-johnny-depp");
    expect(slugify("  Œuvre « déjà » vue !  ")).toBe("oeuvre-deja-vue");
    expect(slugify("The fall of FTX — $32B")).toBe("the-fall-of-ftx-32b");
    expect(slugify("a".repeat(30) + " " + "b".repeat(30)).length).toBeLessThanOrEqual(48);
    expect(slugify("a".repeat(47) + " b")).toBe("a".repeat(47));
  });
});
