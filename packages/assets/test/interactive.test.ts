// Uploads, local imports, live search + freeze-by-reference, ledger and credits (§7.3–§7.8).
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CandidatesDoc, FrozenAsset, LocalIndexDoc, P } from "@docmaker/core";
import type { Candidate, Ledger, Project, UploadDeclaration, VoiceTrack } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeProject, makeScript, makeSfxEntry, makeMusicTrack, makeTake } from "@docmaker/core/testing";
import {
  buildCredits, buildLedger, freezeCandidate, importLocalDir, importUpload, ledgerEntryFor, licenseInfo, liveSearch, requireDeclaration,
  resolveAssets,
} from "../src/index";
import { cleanAuthor, stripHtml } from "../src/util";
import { licenseUrl } from "../src/ledger";
import { createLocalProvider } from "../src/providers/local";
import { cleanup, fakeFetch, makeConfig, makeCtx, publicLookup, quietLogger, tmpDir } from "./helpers";
import { createHttpClient } from "../src/index";

const OWN: UploadDeclaration = { kind: "own-work", license: null, author: "Me", url: "", note: "my photo" };
const dir = tmpDir("interactive");
const projectDir = path.join(dir, "proj");
const media = path.join(dir, "media");
const ctx = makeCtx();
const project: Project = makeProject();
project.assets = { ...project.assets, offline: true };

async function jpeg(file: string, w: number, h: number, seed: number): Promise<void> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + seed * 97 + ((i / (w * 3)) | 0) * 7) & 255;
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(file);
}

beforeAll(async () => {
  await mkdir(path.join(media, "sub", ".hidden"), { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
  await jpeg(path.join(media, "Tulip_Painting-seventeenth.jpg"), 1600, 900, 1);
  await jpeg(path.join(media, "sub", "old dutch contract.jpg"), 1200, 1600, 2);
  await jpeg(path.join(media, "sub", ".hidden", "secret.jpg"), 64, 64, 3);
  writeFileSync(path.join(media, "notes.txt"), "not media");
  symlinkSync(path.join(media, "Tulip_Painting-seventeenth.jpg"), path.join(media, "link.jpg"));
});
afterAll(() => cleanup(dir, ctx.config.paths.home));

describe("declarations (never defaulted)", () => {
  it("rejects missing or incomplete declarations", () => {
    expect(() => requireDeclaration(undefined)).toThrow(/declaration is required/);
    expect(() => requireDeclaration({ kind: "own-work" })).toThrow(/invalid upload declaration/);
    expect(() => requireDeclaration({ kind: "licensed", license: null, author: "A", url: "", note: "" })).toThrow(/must name its licence/);
    expect(() => requireDeclaration({ kind: "licensed", license: "USER-OWNED", author: "A", url: "", note: "" })).toThrow(/must name its licence/);
    expect(() => requireDeclaration({ kind: "third-party-quotation", license: null, author: "", url: "", note: "" })).toThrow(/author or a source URL/);
    expect(requireDeclaration(OWN)).toEqual(OWN);
  });
  it("an upload without a declaration fails before any work", async () => {
    await expect(importUpload({ file: path.join(media, "Tulip_Painting-seventeenth.jpg"), declaration: undefined as never, projectDir }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(existsSync(path.join(projectDir, "media"))).toBe(false);
  });
});

describe("importUpload", () => {
  it("conforms, freezes into media/ and records the asset for the next assets run", async () => {
    const a = await importUpload({ file: path.join(media, "sub", "old dutch contract.jpg"), declaration: { kind: "licensed", license: "CC-BY", author: "Archive", url: "https://example.org/x", note: "" }, projectDir }, ctx);
    expect(FrozenAsset.parse(a)).toBeTruthy();
    expect(a).toMatchObject({ kind: "image", role: "user", ext: "jpg", candidate: null, width: 1200, height: 1600 });
    expect(existsSync(path.join(projectDir, a.projectRel))).toBe(true);
    expect(existsSync(path.join(projectDir, "assets/user-frozen", `${a.id}.json`))).toBe(true);
    const e = ledgerEntryFor(a);
    expect(e.provider).toBe("local");
    expect(e.license.code).toBe("CC-BY");
    expect(e.attributionText).toContain("Archive");
  });
});

describe("importLocalDir + local provider", () => {
  let index: LocalIndexDoc;
  it("indexes media files only (no hidden files, no symlinks) with tokens, tags and the declaration", async () => {
    index = await importLocalDir({ dir: media, declaration: OWN, tags: ["tulips", " tulips ", ""], projectDir, previous: null }, ctx);
    expect(index.files.map((f) => path.basename(f.path))).toEqual(["Tulip_Painting-seventeenth.jpg", "old dutch contract.jpg"]);
    expect(index.files[0]!.tokens).toEqual(expect.arrayContaining(["tulip", "painting", "seventeenth"]));
    expect(index.files[1]!.tokens).toEqual(expect.arrayContaining(["sub", "old", "dutch", "contract"]));
    expect(index.files.every((f) => f.tags.join() === "tulips" && f.declaration.kind === "own-work")).toBe(true);
    const again = await importLocalDir({ dir: media, declaration: OWN, tags: ["paintings"], projectDir, previous: index }, ctx);
    expect(again.files[0]!.tags).toEqual(["paintings", "tulips"]);
    await expect(importLocalDir({ dir: path.join(dir, "nope"), declaration: OWN, tags: [], projectDir, previous: null }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("searches by token overlap with the declared licence (never USER-OWNED by default)", async () => {
    const p = createLocalProvider(index);
    const q = { beatId: "CH1-B001", kind: "image" as const, role: "archival" as const, text: "tulip painting seventeenth century", localText: null, entityQid: null, personIds: [], orientation: "landscape" as const, minWidth: 0, durationSec: null, limit: 5, lang: null };
    const rs = await p.search(q, { http: ctx.http, secrets: {}, config: ctx.config, logger: quietLogger(), signal: ctx.signal });
    expect(rs.map((r) => r.candidate.title)).toEqual(["Tulip_Painting-seventeenth"]);
    expect(rs[0]!.candidate.license.code).toBe("USER-OWNED");
    const third = createLocalProvider({ ...index, files: index.files.map((f) => ({ ...f, declaration: { kind: "third-party-quotation" as const, license: null, author: "TV", url: "", note: "" } })) });
    const r3 = await third.search(q, { http: ctx.http, secrets: {}, config: ctx.config, logger: quietLogger(), signal: ctx.signal });
    expect(r3[0]!.candidate.license.code).toBe("UNKNOWN");
    expect(r3[0]!.candidate.license.restrictions).toEqual(expect.arrayContaining(["editorial-only", "fair-use-user-risk"]));
  });
  it("the assets stage prefers matching local files over procedural fallbacks (offline)", async () => {
    await writeFile(path.join(projectDir, P.localIndex), JSON.stringify(index));
    const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
    const { plans } = makeBeats(script);
    const out = await resolveAssets({
      project, plans, facts: makeFactSheet(), entities: { schemaVersion: 1, entities: [] }, style: (await import("@docmaker/core/testing")).TEST_STYLE,
      primaryScript: script, userPicks: { schemaVersion: 1, picks: [], portraits: [], clips: [] }, previous: { picks: null, frozen: null, ledger: null },
      projectDir, reranker: null, personAcks: [],
    }, ctx);
    const b1 = out.picks.picks.find((p) => p.beatId === "CH1-B001" && p.slot === 0)!;
    const a = out.frozen.assets[b1.assetId]!;
    expect(a.candidate?.provider).toBe("local");
    expect(a.declaration?.kind).toBe("own-work");
    expect(out.ledger.entries.find((e) => e.assetId === a.id)?.license.code).toBe("USER-OWNED");
  }, 120_000);
});

describe("liveSearch + freezeCandidate (server-side records only)", () => {
  it("offline: only local/procedural run; records are cached for freeze", async () => {
    const q = { beatId: "CH1-B002", kind: "image" as const, role: "document" as const, text: "old dutch contract", localText: null, entityQid: null, personIds: [], orientation: "any" as const, minWidth: 0, durationSec: null, limit: 5, lang: null };
    const recs = await liveSearch({ query: q, providers: ["wikimedia", "local", "procedural", "brave"], allowPaid: true, policy: project.assets.licensePolicy, editorial: project.editorial, projectDir }, ctx);
    expect(new Set(recs.map((r) => r.candidate.provider))).toEqual(new Set(["local", "procedural"]));
    const local = recs.find((r) => r.candidate.provider === "local")!;
    const a = await freezeCandidate({ projectDir, beatId: "CH1-B002", provider: "local", providerAssetId: local.candidate.providerAssetId }, ctx);
    expect(a.candidate?.license.code).toBe("USER-OWNED");
    await expect(freezeCandidate({ projectDir, beatId: "CH1-B002", provider: "local", providerAssetId: "f".repeat(64) }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  }, 60_000);

  it("re-derives licences from candidates/<beatId>.json: a denied record cannot be frozen whatever the client claims", async () => {
    const nc: Candidate = {
      provider: "openverse", providerAssetId: "nc-1", kind: "image", title: "tulips", description: "", tags: [], previewUrl: "", downloadUrl: "https://live.staticflickr.com/x.jpg",
      width: 2000, height: 1125, durationSec: null, license: licenseInfo("CC-BY-NC", { version: "2.0" }), author: null, sourcePageUrl: "https://flickr.com/x", retrievedAt: "2026-10-01T00:00:00.000Z", youtube: null,
    };
    await mkdir(path.join(projectDir, "assets/candidates"), { recursive: true });
    await writeFile(path.join(projectDir, P.candidates("CH1-B009")), JSON.stringify(CandidatesDoc.parse({ schemaVersion: 1, beatId: "CH1-B009", queries: [], records: [{ candidate: nc, score: null, raw: null }] })));
    const online = { ...project, assets: { ...project.assets, offline: false } };
    await writeFile(path.join(projectDir, P.project), JSON.stringify(online));
    try {
      const onlineCtx = makeCtx({ config: makeConfig({ offline: false }) });
      await expect(freezeCandidate({ projectDir, beatId: "CH1-B009", provider: "openverse", providerAssetId: "nc-1" }, onlineCtx)).rejects.toMatchObject({ code: "POLICY_DENIED" });
      // Offline mode refuses network providers before any request.
      await expect(freezeCandidate({ projectDir, beatId: "CH1-B009", provider: "openverse", providerAssetId: "nc-1" }, ctx)).rejects.toMatchObject({ code: "OFFLINE" });
    } finally {
      await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    }
  });

  it("paid providers only with allowPaid", async () => {
    const config = makeConfig({ offline: false });
    const f = fakeFetch(() => new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } }));
    const online = { ...makeCtx({ config, http: createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup }) }), secrets: { brave: "BRAVEKEY" } };
    const pdir = path.join(dir, "paid");
    mkdirSync(pdir, { recursive: true });
    const q = { beatId: null, kind: "image" as const, role: "broll" as const, text: "tulip market", localText: null, entityQid: null, personIds: [], orientation: "landscape" as const, minWidth: 0, durationSec: null, limit: 5, lang: null };
    await liveSearch({ query: q, providers: ["brave", "openverse"], allowPaid: false, policy: project.assets.licensePolicy, editorial: project.editorial, projectDir: pdir }, online);
    expect(f.calls.some((c) => c.url.includes("search.brave.com"))).toBe(false);
    expect(f.calls.some((c) => c.url.includes("api.openverse.org"))).toBe(true);
    await liveSearch({ query: q, providers: ["brave"], allowPaid: true, policy: project.assets.licensePolicy, editorial: project.editorial, projectDir: pdir }, online);
    expect(f.calls.find((c) => c.url.includes("search.brave.com"))?.headers["x-subscription-token"]).toBe("BRAVEKEY");
    cleanup(config.paths.home);
  });
});

describe("buildCredits", () => {
  const asset = (id: string, c: Partial<Candidate> & Pick<Candidate, "provider" | "license">, role: FrozenAsset["role"] = "broll"): FrozenAsset => FrozenAsset.parse({
    id: id.repeat(64).slice(0, 64), originalSha256: "0".repeat(64), kind: "image", role, mime: "image/jpeg", ext: "jpg", bytes: 1, width: 1920, height: 1080,
    durationMs: null, fps: null, hasAudio: false, lufs: null, cacheRel: "blobs/x", projectRel: "media/x.jpg",
    candidate: { providerAssetId: id, kind: "image", title: `Title ${id}`, description: "", tags: [], previewUrl: "", downloadUrl: "", width: 1920, height: 1080, durationSec: null, author: { name: `Author ${id}`, url: null }, sourcePageUrl: `https://example.org/${id}`, retrievedAt: "2026-10-01T00:00:00.000Z", youtube: null, ...c },
    declaration: null, conform: { recipe: "image-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0 },
    analysis: { grayscale: false, meanLuma: 0.4, year: null, lowRes: false }, frozenAt: "2026-10-01T00:00:00.000Z",
  });
  const commons = asset("a", { provider: "wikimedia", license: licenseInfo("CC-BY-SA", { version: "4.0" }) });
  const pexels = asset("b", { provider: "pexels", license: licenseInfo("PEXELS") });
  const ai = asset("c", { provider: "fal", license: licenseInfo("AI-GENERATED") }, "generated");
  const unused = asset("d", { provider: "loc", license: licenseInfo("PDM") });
  const clip = asset("e", {
    provider: "youtube", license: licenseInfo("YOUTUBE-FAIR-USE"), title: "Interview",
    youtube: { videoId: "AAAAAAAAAAA", channel: "CBS News", channelVerified: true, publishedAt: "", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA", startMs: 65_000, endMs: 72_500, transcriptLang: "en", transcriptKind: "manual", matchScore: 1, matchedText: "" },
  }, "clip");
  const ledger: Ledger = buildLedger([commons, pexels, ai, unused, clip]);
  const music = makeMusicTrack();
  const sfx = makeSfxEntry();
  const usage = { schemaVersion: 1 as const, lang: "en" as const, usage: [commons, pexels, ai, clip].map((a) => ({ assetId: a.id, itemIds: ["v1"] })).concat([{ assetId: music.assetId, itemIds: ["m1"] }, { assetId: sfx.assetId, itemIds: ["s1"] }]) };
  const take = makeTake(makeScript({ chapters: 1, segmentsPerChapter: 1 }));
  const piper: VoiceTrack = { ...take, provider: "piper", voiceId: "en_GB-alba-medium", license: licenseInfo("CC-BY", { version: "4.0", attributionText: "Voice: Alba (Piper) by Rhasspy contributors, CC BY 4.0" }) };
  const eleven: VoiceTrack = { ...take, provider: "elevenlabs", voiceId: "Rachel", license: { ...licenseInfo("PROVIDER-TERMS"), commercialOk: false, restrictions: ["nc"] } };

  it("lists only used assets, grouped in order, with a YouTube block and the synthetic reminder", () => {
    const md = buildCredits({ ledger, usage, lang: "en", voice: piper, music: { schemaVersion: 1, tracks: [music] }, sfx: [sfx] });
    const order = ["## Archival", "## Stock", "## Clips", "## Music", "## Sound effects", "## Voice", "## AI-generated", "## Fonts", "## YouTube description"].map((h) => md.indexOf(h));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // The licence link and the modification notice (every still is cropped, graded and animated); a ShareAlike note.
    expect(md).toContain('"Title a" by Author a — CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) — https://example.org/a — cropped, colour-graded and animated');
    expect(md).toMatch(/> ShareAlike: works marked CC BY-SA/);
    expect(md).not.toContain("Title d");
    expect(md).toContain("CBS News — https://www.youtube.com/watch?v=AAAAAAAAAAA [01:05–01:13]");
    expect(md).toContain("Voice: Alba (Piper) by Rhasspy contributors, CC BY 4.0");
    expect(md).toMatch(/altered or synthetic content/);
  });
  it("credit lines carry a clean author (Commons Artist templates, repeated names, emoji)", () => {
    const messy = asset("f", { provider: "wikimedia", license: licenseInfo("CC-BY-SA", { version: "4.0" }), author: { name: "Donald Trung Quoc Don (Chữ Hán: 徵國單) - Wikimedia Commons - © CC BY-SA 4.0 International . ( Want to use this image? ) ( No Fake News 💬 )", url: null } });
    const twice = asset("9", { provider: "wikimedia", license: licenseInfo("PDM"), author: { name: "Unknown artist Unknown artist", url: null } });
    const l2 = buildLedger([messy, twice]);
    const md = buildCredits({ ledger: l2, usage: { schemaVersion: 1, lang: "en", usage: [messy, twice].map((a) => ({ assetId: a.id, itemIds: ["v1"] })) }, lang: "en", voice: null, music: { schemaVersion: 1, tracks: [] }, sfx: [] });
    expect(md).toContain('"Title f" by Donald Trung Quoc Don — CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)');
    expect(md).not.toMatch(/Want to use|💬|Fake News/);
    expect(md).toContain('"Title 9" by Unknown artist — Public Domain (https://creativecommons.org/publicdomain/mark/1.0/) — https://example.org/9 — cropped, colour-graded and animated');
    const fr = buildCredits({ ledger: l2, usage: { schemaVersion: 1, lang: "fr", usage: [messy].map((a) => ({ assetId: a.id, itemIds: ["v1"] })) }, lang: "fr", voice: null, music: { schemaVersion: 1, tracks: [] }, sfx: [] });
    expect(fr).toContain("par Donald Trung Quoc Don");
    expect(fr).toContain("recadré, étalonné et animé");
    expect(fr).toContain("Partage dans les mêmes conditions");
    expect(cleanAuthor("by Rembrandt van Rijn")).toBe("Rembrandt van Rijn");
    // Raw Commons Artist fields seen in the online demo: user links, derivative-work chains, stacked placeholder templates.
    expect(cleanAuthor("User:Amada44 // cropped by user:Retired electrician for the article")).toBe("Amada44");
    expect(cleanAuthor("Amada44, cropped by Someone else")).toBe("Amada44");
    expect(cleanAuthor("Anonymous Unknown author")).toBe("Anonymous");
    expect(cleanAuthor("Jan Steen, Jan Steen")).toBe("Jan Steen");
    expect(cleanAuthor("Jan Steen and Jan Steen")).toBe("Jan Steen");
    expect(cleanAuthor("Unidentified painter")).toBe("Unidentified painter");
    expect(cleanAuthor(stripHtml('<div class="fn value"><a href="//commons.wikimedia.org/wiki/Creator:Hendrik_Gerritsz_Pot" title="Creator:Hendrik Gerritsz Pot">Hendrik Gerritsz Pot</a>&nbsp;(circa 1580&ndash;1657)</div>'))).toBe("Hendrik Gerritsz Pot");
    expect(cleanAuthor("  ")).toBeNull();
    expect(cleanAuthor("A".repeat(30) + " " + "B".repeat(40))!.length).toBeLessThanOrEqual(61);
  });
  it("licence links are canonical deeds (built from code + version when missing); videos are 'trimmed and colour-graded'", () => {
    expect(licenseUrl({ code: "CC0", version: "1.0", url: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" })).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(licenseUrl({ code: "CC-BY-SA", version: "4.0", url: "https://creativecommons.org/licenses/by-sa/4.0" })).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(licenseUrl({ code: "CC-BY", version: "2.0", url: null })).toBe("https://creativecommons.org/licenses/by/2.0/");
    expect(licenseUrl({ code: "PDM", version: null, url: null })).toBe("https://creativecommons.org/publicdomain/mark/1.0/");
    expect(licenseUrl({ code: "PEXELS", version: null, url: null })).toBeNull();
    const cc0 = asset("7", { provider: "wikimedia", license: licenseInfo("CC0", { version: "1.0", url: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" }) });
    const vid = FrozenAsset.parse({ ...asset("8", { provider: "internet-archive", license: licenseInfo("PDM"), kind: "video" }), kind: "video", mime: "video/mp4", ext: "mp4", durationMs: 9000, fps: 30, conform: { recipe: "video-v1", sourceInMs: 0, sourceOutMs: 9000, handleHeadMs: 0, handleTailMs: 0 } });
    const l3 = buildLedger([cc0, vid]);
    const md = buildCredits({ ledger: l3, usage: { schemaVersion: 1, lang: "en", usage: [cc0, vid].map((a) => ({ assetId: a.id, itemIds: ["v1"] })) }, lang: "en", voice: null, music: { schemaVersion: 1, tracks: [] }, sfx: [] });
    expect(md).toContain('"Title 7" by Author 7 — CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) — https://example.org/7 — cropped, colour-graded and animated');
    expect(md).toContain('"Title 8" by Author 8 — Public Domain (https://creativecommons.org/publicdomain/mark/1.0/) — https://example.org/8 — trimmed and colour-graded');
  });
  it("warns about the ElevenLabs free tier; French headings", () => {
    const md = buildCredits({ ledger, usage: { ...usage, lang: "fr" }, lang: "fr", voice: eleven, music: { schemaVersion: 1, tracks: [] }, sfx: [] });
    expect(md).toMatch(/^# Crédits/);
    expect(md).toContain("## Voix");
    expect(md).toContain("offre gratuite ElevenLabs");
  });
  it("no AI and a recorded voice → no synthetic reminder", () => {
    const rec: VoiceTrack = { ...take, provider: "recording", voiceId: "me", license: licenseInfo("USER-OWNED") };
    const md = buildCredits({ ledger, usage: { ...usage, usage: usage.usage.filter((u) => u.assetId !== ai.id) }, lang: "en", voice: rec, music: { schemaVersion: 1, tracks: [] }, sfx: [] });
    expect(md).not.toMatch(/altered or synthetic/);
    expect(md).toContain("recorded by the creator");
  });
});
