// Near-duplicate pictures (dHash, Hamming ≤ 6) never fill two shots of one beat, even without thumbnails (no rerank).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, expect, it } from "vitest";
import { P } from "@docmaker/core";
import type { Project, UploadDeclaration } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeProject, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import { importLocalDir, resolveAssets } from "../src/index";
import { cleanup, makeCtx, tmpDir } from "./helpers";

const OWN: UploadDeclaration = { kind: "own-work", license: null, author: "Me", url: "", note: "my photos" };
const dir = tmpDir("dedupe");
const ctx = makeCtx();
afterAll(() => cleanup(dir, ctx.config.paths.home));

async function picture(file: string, seed: number, quality: number): Promise<void> {
  const w = 1600;
  const h = 1000;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const v = seed === 1 ? Math.round((x / w) * 255) : seed === 2 ? Math.round((y / h) * 255) : ((x >> 6) ^ (y >> 6)) & 1 ? 230 : 20;
    raw[i] = v;
    raw[i + 1] = 255 - v;
    raw[i + 2] = (v * 3) & 255;
  }
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality }).toFile(file);
}

it("skips a re-encoded copy of an already picked picture", async () => {
  const media = path.join(dir, "media");
  const projectDir = path.join(dir, "proj");
  await mkdir(media, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await picture(path.join(media, "tulip field a.jpg"), 1, 92);
  await picture(path.join(media, "tulip field b.jpg"), 1, 55); // same picture, different bytes
  await picture(path.join(media, "tulip field c.jpg"), 2, 90);
  await picture(path.join(media, "tulip field d.jpg"), 3, 90);
  const index = await importLocalDir({ dir: media, declaration: OWN, tags: [], projectDir, previous: null }, ctx);
  expect(new Set(index.files.map((f) => f.sha256)).size).toBe(4);
  await mkdir(path.dirname(path.join(projectDir, P.localIndex)), { recursive: true });
  await writeFile(path.join(projectDir, P.localIndex), JSON.stringify(index));

  const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
  const plans = makeBeats(script).plans;
  plans.plans.forEach((p) => Object.assign(p, { visualKind: "archival_photo", personIds: [], visualQuery: "tulip field", estSeconds: 30, motionTemplate: "none", cueTags: [] }));
  plans.plans.splice(1);
  const project: Project = makeProject();
  project.assets = { ...project.assets, offline: true };
  await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
  const out = await resolveAssets({
    project, plans, facts: makeFactSheet(), entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, primaryScript: script,
    userPicks: { schemaVersion: 1, picks: [], portraits: [], clips: [] }, previous: { picks: null, frozen: null, ledger: null }, projectDir, reranker: null, personAcks: [],
  }, ctx);
  const titles = out.picks.picks.filter((p) => p.beatId === plans.plans[0]!.id).map((p) => out.frozen.assets[p.assetId]!.candidate!.title);
  expect(titles.length).toBe(3);
  expect(titles.filter((t) => t === "tulip field a" || t === "tulip field b")).toHaveLength(1);
  expect(titles).toEqual(expect.arrayContaining(["tulip field c", "tulip field d"]));
}, 120_000);
