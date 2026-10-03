// Test helpers: golden files, xmllint, a fake conform map (no ffmpeg), runtime config.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Timeline } from "@docmaker/core";
import { STEM_NAMES, clipWavKey, mirroredSfxKey, pictureKey, stemKey, type ConformMap, type ConformedMedia } from "../src/index";

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = path.join(TEST_DIR, "golden");
export const DTD_DIR = path.join(TEST_DIR, "dtd");

export const HAS_XMLLINT = spawnSync("xmllint", ["--version"]).status === 0;
export const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

/** Collapses whitespace between tags and drops comments (golden comparison). */
export function normXml(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").replace(/\r\n/g, "\n").trim();
}

/** Compares `actual` with test/golden/<name>; UPDATE_GOLDEN=1 rewrites the file. */
export function expectGolden(name: string, actual: string, norm: (s: string) => string = (s) => s): void {
  const file = path.join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(file)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual);
  }
  expect(norm(actual)).toBe(norm(readFileSync(file, "utf8")));
}

/** xmllint --noout --dtdvalid; returns stderr ("" when valid). */
export function xmllint(xml: string, dtd: string): string {
  const dir = path.join(os.tmpdir(), `w9-xmllint-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `doc-${Math.abs(hash(xml))}.xml`);
  writeFileSync(f, xml);
  try {
    execFileSync("xmllint", ["--noout", "--dtdvalid", path.join(DTD_DIR, dtd), f], { stdio: "pipe" });
    return "";
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** A conform map as conformForNle would produce it, without touching the disk. */
export function fakeConform(t: Timeline, exportDir: string, o?: { stems?: boolean; drop?: (key: string) => boolean }): ConformMap {
  const map: ConformMap = {};
  let n = 0;
  const put = (key: string, m: Omit<ConformedMedia, "localPath" | "name">, ext: string, sub = "media") => {
    if (map[key] || o?.drop?.(key)) return;
    const name = `${String(++n).padStart(3, "0")}_${key.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 30)}_0000000${n % 10}.${ext}`;
    map[key] = { ...m, localPath: path.join(exportDir, sub, sub === "stems" ? `${key.slice(5)}.wav` : name), name: sub === "stems" ? `${key.slice(5)}.wav` : name };
  };
  for (const c of t.video) {
    const s = c.source;
    if (s.kind === "image") put(pictureKey(c), { assetId: s.assetId, kind: "image", width: 1920, height: 1080, durationFrames: null, hasVideo: true, hasAudio: false, audioChannels: null, alpha: false }, "jpg");
    else if (s.kind === "video") put(pictureKey(c), { assetId: s.assetId, kind: "video", width: 1920, height: 1080, durationFrames: t.assets[s.assetId]?.durationFrames ?? 900, hasVideo: true, hasAudio: true, audioChannels: 2, alpha: false }, "mp4");
    else put(`gen:${c.id}`, { assetId: null, kind: "image", width: 1920, height: 1080, durationFrames: null, hasVideo: true, hasAudio: false, audioChannels: null, alpha: false }, "png");
  }
  const audio = (key: string, assetId: string, ch: 1 | 2) =>
    put(key, { assetId, kind: "audio", width: null, height: null, durationFrames: t.assets[assetId]?.durationFrames ?? t.durationInFrames, hasVideo: false, hasAudio: true, audioChannels: ch, alpha: false }, "wav");
  for (const v of t.audio.vo) audio(v.assetId, v.assetId, 1);
  if (!t.audio.vo.length) audio(t.audio.voProgram.assetId, t.audio.voProgram.assetId, 1);
  for (const m of t.audio.music) audio(m.assetId, m.assetId, 2);
  for (const s of t.audio.sfx) audio(s.panSweep === "RL" ? mirroredSfxKey(s.assetId) : s.assetId, s.assetId, 2);
  for (const c of t.audio.clip) audio(clipWavKey(c.assetId), c.assetId, 2);
  if (o?.stems) {
    for (const s of STEM_NAMES) put(stemKey(s), { assetId: null, kind: "audio", width: null, height: null, durationFrames: t.durationInFrames, hasVideo: false, hasAudio: true, audioChannels: 2, alpha: false }, "wav", "stems");
  }
  return map;
}
