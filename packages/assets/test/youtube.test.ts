// YouTube (§7.7): json3/VTT parsing, track choice, passage finder, stderr mapping, flags, and the full clip path against a
// fake yt-dlp binary (search → transcript → download → clip-v1 → freeze), all offline.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClipResolution, ClipWordsDoc, FrozenAsset, P } from "@docmaker/core";
import type { Project, WordTiming } from "@docmaker/core";
import { ffprobeJson } from "@docmaker/core/node";
import { makeFactSheet, makeProject, makeScript } from "@docmaker/core/testing";
import {
  findPassage, mapYtError, parseJson3, parseVtt, parseYoutubeId, parseYtSearch, pickSubtitleTrack, resolveClips, resolveManualClip,
  ytBaseFlags, ytFetchTranscript, ytProbe, ytSearch,
} from "../src/index";
import { orderHits, rebaseWords } from "../src/youtube/clips";
import { dropYtSource, ytCachePath, ytDownload, YT_ID_RE, ytRun } from "../src/youtube/ytdlp";
import { cleanup, DATA, makeConfig, makeCtx, tmpDir } from "./helpers";

const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const W = (text: string, startMs: number, endMs: number): WordTiming => ({ text, startMs, endMs, confidence: null });
const words = (text: string, t0: number, step = 300, gapAfter: Record<number, number> = {}): WordTiming[] => {
  let t = t0;
  return text.split(" ").map((w, k) => {
    const out = W(w, t, t + step - 40);
    t += step + (gapAfter[k] ?? 0);
    return out;
  });
};

describe("json3 / VTT", () => {
  it("ASR json3: start = tStartMs + tOffsetMs, end = next seg start, drops \\n and [Music]", () => {
    const ws = parseJson3(JSON.parse(read("yt-asr.json3")));
    expect(ws.map((w) => w.text)).toEqual(["we", "find", "the", "defendant", "liable", "on", "all", "three", "counts", "thank", "you"]);
    expect(ws[0]).toEqual({ text: "we", startMs: 120, endMs: 360, confidence: null });
    expect(ws[3]).toMatchObject({ startMs: 820, endMs: 1720 }); // last seg of an event ends at the event end, clipped to the next word
    for (let k = 1; k < ws.length; k++) expect(ws[k]!.startMs).toBeGreaterThanOrEqual(ws[k - 1]!.endMs);
  });
  it("manual json3 without offsets splits the event span by characters", () => {
    const ws = parseJson3(JSON.parse(read("yt-manual.json3")));
    expect(ws.map((w) => w.text).join(" ")).toBe("It is all a fever, and fevers break.");
    expect(ws[0]!.startMs).toBe(1000);
    expect(ws[4]!.endMs).toBe(3000);
    expect(ws.at(-1)!.endMs).toBe(4500);
  });
  it("tolerates junk", () => {
    expect(parseJson3(null)).toEqual([]);
    expect(parseJson3({ events: [{ tStartMs: 0, segs: [{ utf8: "\n" }, { utf8: "  " }] }] })).toEqual([]);
  });
  it("recorded VTT: ordered words without roll-up duplicates", () => {
    const ws = parseVtt(read("yt-manual.en.vtt"));
    expect(ws.length).toBeGreaterThan(900);
    for (let k = 1; k < ws.length; k++) expect(ws[k]!.startMs).toBeGreaterThanOrEqual(ws[k - 1]!.startMs);
    expect(ws.slice(0, 4).map((w) => w.text)).toEqual(["HOLD", "ON,", "THE", "JURY"]);
  });
  it("karaoke VTT tags give word starts", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello<00:00:01.500><c> big</c><00:00:02.000><c> world</c>\n";
    expect(parseVtt(vtt)).toEqual([W("hello", 1000, 1500), W("big", 1500, 2000), W("world", 2000, 3000)]);
  });
});

describe("subtitle track choice", () => {
  const info = (subs: string[], auto: string[], language = "en") => ({
    subtitles: Object.fromEntries(subs.map((k) => [k, []])), automatic_captions: Object.fromEntries(auto.map((k) => [k, []])), language,
  });
  it("manual > -orig > <lang>-<lang> ASR > own-language ASR > translated", () => {
    expect(pickSubtitleTrack(info(["en-GB", "fr"], ["en-orig"]), "en")).toEqual({ key: "en-GB", kind: "manual" });
    expect(pickSubtitleTrack(info(["live_chat"], ["en-orig", "en"]), "en")).toEqual({ key: "en-orig", kind: "asr-orig" });
    expect(pickSubtitleTrack(info([], ["fr-fr", "fr"], "fr"), "fr")).toEqual({ key: "fr-fr", kind: "asr" });
    expect(pickSubtitleTrack(info([], ["en"]), "en")).toEqual({ key: "en", kind: "asr" });
    expect(pickSubtitleTrack(info([], ["en"], "ja"), "en")).toEqual({ key: "en", kind: "translated" });
    expect(pickSubtitleTrack(info([], ["de"]), "en")).toBeNull();
  });
});

describe("passage finder (Smith–Waterman, accept ≥ 0.6)", () => {
  const quote = "It is all a fever, and fevers break.";
  it("finds an exact passage with ±300 ms padding", () => {
    const ws = [...words("so then he said", 0), ...words("it is all a fever and fevers break", 2000), ...words("after that silence", 6000)];
    const p = findPassage(quote, ws, { maxClipMs: 20_000 })!;
    expect(p.score).toBe(1);
    expect(p.startMs).toBe(1700);
    expect(p.endMs).toBeGreaterThanOrEqual(ws[11]!.endMs + 300);
    expect(p.matchedText).toBe("it is all a fever and fevers break");
  });
  it("tolerates ASR noise (fuzzy long tokens, a dropped word)", () => {
    const ws = words("um it is all fever and feverss break you know", 1000);
    const p = findPassage(quote, ws, { maxClipMs: 20_000 })!;
    expect(p.score).toBeGreaterThanOrEqual(0.6);
    expect(p.score).toBeLessThan(1);
    expect(p.startMs).toBe(1300 - 300);
  });
  it("rejects passages below the threshold", () => {
    expect(findPassage(quote, words("the weather is fine and markets break records", 0), { maxClipMs: 20_000 })).toBeNull();
    expect(findPassage(quote, [], { maxClipMs: 20_000 })).toBeNull();
  });
  it("extends the end to the next pause ≥ 400 ms within 1.5 s and clamps to maxClipMs", () => {
    const ws = words("it is all a fever and fevers break said the man", 0, 300, { 9: 600 });
    const p = findPassage(quote, ws, { maxClipMs: 20_000 })!;
    expect(p.endMs).toBeGreaterThan(ws[7]!.endMs + 300); // finished "said the"
    expect(p.endMs).toBeLessThanOrEqual(ws[9]!.endMs + 300);
    const c = findPassage(quote, ws, { maxClipMs: 1500 })!;
    expect(c.endMs - c.startMs).toBe(1500);
  });
});

describe("yt-dlp flags, errors, search parsing", () => {
  it("maps stderr to typed codes", () => {
    expect(mapYtError("ERROR: unable to download video data: HTTP Error 429: Too Many Requests")).toBe("YT_RATE_LIMIT");
    expect(mapYtError("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser")).toBe("YT_BOT_CHECK");
    expect(mapYtError("ERROR: unable to download video data: HTTP Error 403: Forbidden")).toBe("YT_FORBIDDEN");
    expect(mapYtError("ERROR: [youtube] abc: Video unavailable")).toBe("YT_UNAVAILABLE");
    expect(mapYtError("ERROR: [youtube] abc: Private video. Sign in if you've been granted access")).toBe("YT_UNAVAILABLE");
    expect(mapYtError("ERROR: something else")).toBeNull();
    // Age gates also say "Sign in to confirm…" but concern one video, not this machine.
    expect(mapYtError("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.")).toBe("YT_UNAVAILABLE");
    expect(mapYtError("ERROR: [youtube] abc: This video is age-restricted")).toBe("YT_UNAVAILABLE");
  });
  it("always passes -t sleep; node JS runtime without deno; PO-token and cookies only when configured", () => {
    const base = ytBaseFlags({ PATH: "/nonexistent" });
    expect(base.slice(0, 4)).toEqual(["-t", "sleep", "--no-warnings", "--newline"]);
    expect(base).toContain("--js-runtimes");
    expect(base.join(" ")).not.toMatch(/cookies|extractor-args/);
    const pot = ytBaseFlags({ PATH: "/nonexistent", DOCMAKER_YT_POT_URL: "http://127.0.0.1:4416", DOCMAKER_YT_COOKIES_BROWSER: "firefox" });
    expect(pot).toEqual(expect.arrayContaining(["youtube:player_client=mweb", "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416", "--cookies-from-browser", "firefox"]));
  });
  it("parses recorded search lines and orders verified/short/popular first", () => {
    const hits = parseYtSearch(read("yt-search.jsonl"));
    expect(hits.length).toBe(5);
    expect(hits[0]).toMatchObject({ id: "pGN2-MfKg9c", channel: "CBS News", channelVerified: true, durationSec: 708 });
    const ordered = orderHits([
      { id: "a", title: "", durationSec: 4000, channel: "x", channelVerified: true, views: 9e9 },
      { id: "b", title: "", durationSec: 300, channel: "y", channelVerified: false, views: 9e9 },
      { id: "c", title: "", durationSec: 300, channel: "z", channelVerified: true, views: 10 },
    ]);
    expect(ordered.map((h) => h.id)).toEqual(["c", "a", "b"]);
    expect(parseYtSearch(JSON.stringify({ entries: [{ id: "x", title: "t", ie_key: "Youtube" }, { id: "pl", ie_key: "YoutubeTab" }] }))).toHaveLength(1);
  });
  it("extracts video ids", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3")).toBe("jNQXAC9IVRw");
    expect(parseYoutubeId("https://youtu.be/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(parseYoutubeId("https://m.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(parseYoutubeId("https://vimeo.com/123")).toBeNull();
    expect(parseYoutubeId("jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
  });
  it("never returns an id that could leave <home>/cache/yt (path traversal through v=)", () => {
    // yt-dlp reads the first 11 characters; so do we — the rest never reaches a file path.
    expect(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ/../../../../Videos/my-footage")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ%2F..%2F..%2F..%2F..%2Ftmp%2Fvictim")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("https://youtu.be/dQw4w9WgXcQ%2F..%2Fx")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("https://www.youtube.com/watch?v=../../../../etc/passwd")).toBeNull();
    expect(parseYoutubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQx")).toBeNull(); // 12 id characters: not an id
    expect(parseYoutubeId("https://www.youtube.com/shorts/..%2F..%2Fabcdefghijk")).toBeNull();
    expect(parseYoutubeId("https://www.youtube.com/embed/abcdefghijk?x=1")).toBe("abcdefghijk");
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ/../../x", "https://youtu.be/abcdefghijk/../../y", "https://youtube.com/live/a/../../b"]) {
      const id = parseYoutubeId(u);
      expect(id === null || YT_ID_RE.test(id)).toBe(true);
    }
  });
  it("the cache path and the source drop refuse ids outside YT_ID_RE", async () => {
    const config = makeConfig({ offline: false });
    try {
      expect(ytCachePath(config, "dQw4w9WgXcQ")).toBe(path.join(path.resolve(config.paths.cache), "yt", "dQw4w9WgXcQ.mp4"));
      expect(() => ytCachePath(config, "dQw4w9WgXcQ/../../../victim")).toThrow(/invalid YouTube video id/);
      const victim = path.join(config.paths.home, "victim.mp4");
      writeFileSync(victim, "precious");
      const rel = path.relative(path.join(config.paths.cache, "yt"), victim).replace(/\.mp4$/, "");
      await expect(dropYtSource(config, rel)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(readFileSync(victim, "utf8")).toBe("precious");
      await expect(ytDownload(rel, { sectionMs: null, outDir: config.paths.home }, { config, signal: new AbortController().signal })).rejects.toMatchObject({ code: "VALIDATION" });
      expect(readFileSync(victim, "utf8")).toBe("precious");
    } finally {
      cleanup(config.paths.home);
    }
  });
  it("rebases transcript words on the conformed file", () => {
    expect(rebaseWords([W("a", 900, 1100), W("b", 2000, 2200), W("c", 9000, 9100)], 1000, 5000, 1000)).toEqual([W("a", 0, 100), W("b", 1000, 1200)]);
  });
});

// ------------------------------------------------------------------------------------------------ fake yt-dlp
/** Writes an executable fake yt-dlp into <home>/bin driven by <home>/bin/yt-mode.json; every call is logged. */
function installFakeYtDlp(binDir: string): { setMode(m: Record<string, unknown>): void; calls(): string[][] } {
  mkdirSync(binDir, { recursive: true });
  const script = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path"); const cp = require("node:child_process");
const dir = __dirname; const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "yt-log.jsonl"), JSON.stringify(args) + "\\n");
const mode = JSON.parse(fs.readFileSync(path.join(dir, "yt-mode.json"), "utf8"));
const fail = (msg) => { process.stderr.write(msg + "\\n"); process.exit(1); };
if (mode.error) fail(mode.error);
const url = args[args.length - 1]; const id = (/v=([\\w-]+)/.exec(url) || [])[1];
if (id && mode.errorFor && mode.errorFor[id]) fail(mode.errorFor[id]);
const out = (i => i >= 0 ? args[i + 1] : null)(args.indexOf("-o"));
if (args.some(a => a.startsWith("ytsearch"))) { process.stdout.write(JSON.stringify({ entries: mode.search })); process.exit(0); }
if (args.includes("--write-subs")) {
  const lang = args[args.indexOf("--sub-langs") + 1];
  fs.copyFileSync(mode.json3, out.replace("%(id)s", id).replace("%(ext)s", lang + ".json3")); process.exit(0);
}
if (args.includes("-J")) { process.stdout.write(JSON.stringify({ id, title: "Interview", duration: mode.duration, channel: "Archive Channel", channel_is_verified: true, language: "en", subtitles: mode.noSubs ? {} : { en: [{}] }, automatic_captions: {} })); process.exit(0); }
if (args.includes("-f")) {
  let dur = mode.duration; const s = args.indexOf("--download-sections");
  if (s >= 0) { const m = /\\*([\\d.]+)-([\\d.]+)/.exec(args[s + 1]); dur = Number(m[2]) - Number(m[1]); }
  const file = out.replace("%(id)s", id).replace("%(ext)s", "mp4");
  console.log("download: 50.0%");
  const r = cp.spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=" + dur, "-f", "lavfi", "-i",
    "aevalsrc='0.3*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.5*t))':s=48000:d=" + dur, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  if (r.status !== 0) fail(String(r.stderr));
  console.log("download:100.0%"); process.exit(0);
}
fail("fake yt-dlp: unsupported call " + args.join(" "));
`;
  const bin = path.join(binDir, "yt-dlp");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return {
    setMode: (m) => writeFileSync(path.join(binDir, "yt-mode.json"), JSON.stringify(m)),
    calls: () => (existsSync(path.join(binDir, "yt-log.jsonl")) ? readFileSync(path.join(binDir, "yt-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []),
  };
}

describe("yt-dlp wrapper and clip resolution (fake binary)", () => {
  const config = makeConfig({ offline: false });
  const ctx = makeCtx({ config });
  const fake = installFakeYtDlp(config.paths.bin);
  const projectDir = tmpDir("ytproj");
  const transcript = path.join(projectDir, "t.json3");
  // "It is all a fever, and fevers break." spoken 4.0 s → 6.4 s in a 12 s video.
  writeFileSync(transcript, JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "welcome" }, { utf8: " back", tOffsetMs: 400 }] },
    { tStartMs: 4000, dDurationMs: 2400, segs: ["it", " is", " all", " a", " fever", " and", " fevers", " break"].map((u, k) => ({ utf8: u, tOffsetMs: k * 300 })) },
    { tStartMs: 8000, dDurationMs: 1000, segs: [{ utf8: "thanks" }] },
  ] }));
  const search = [{ id: "AAAAAAAAAAA", title: "Interview", duration: 12, channel: "Archive Channel", channel_is_verified: true, view_count: 10, ie_key: "Youtube" }];
  afterAll(() => cleanup(projectDir, config.paths.home));

  it("search and transcript go through the binary with the fixed flags", async () => {
    fake.setMode({ search, json3: transcript, duration: 12 });
    const hits = await ytSearch("fever quote", ctx);
    expect(hits).toEqual([{ id: "AAAAAAAAAAA", title: "Interview", durationSec: 12, channel: "Archive Channel", channelVerified: true, views: 10 }]);
    const t = await ytFetchTranscript("AAAAAAAAAAA", "en", ctx);
    expect(t.kind).toBe("manual");
    expect(t.words.find((w) => w.text === "fever")?.startMs).toBe(5200);
    const calls = fake.calls();
    expect(calls[0]!.slice(0, 4)).toEqual(["-t", "sleep", "--no-warnings", "--newline"]);
    expect(calls[0]).toEqual(expect.arrayContaining(["ytsearch10:fever quote", "--flat-playlist", "-J"]));
    expect(calls.at(-1)).toEqual(expect.arrayContaining(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en", "--sub-format", "json3/vtt"]));
  });

  it("no subtitles + Python sidecar → bestaudio and local ASR (faster-whisper pieces merged)", async () => {
    fake.setMode({ search, duration: 12, noSubs: true });
    expect(await ytFetchTranscript("AAAAAAAAAAA", "en", ctx)).toEqual({ words: [], kind: "none", lang: null }); // no venv yet
    const venvBin = path.join(config.paths.pyVenv, "bin");
    mkdirSync(venvBin, { recursive: true });
    const pieces = [[" it", 4000, 4200], [" is", 4300, 4500], [" l", 4600, 4700], ["’ecluse", 4700, 5000], [".", 5000, 5000]].map(([text, startMs, endMs]) => ({ text, startMs, endMs, p: 0.9 }));
    writeFileSync(path.join(venvBin, "python"), `#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "--out" ]; then out="$2"; fi; shift; done\nprintf '%s' '${JSON.stringify({ words: pieces, durationSec: 12, rtf: 0.1 })}' > "$out"\n`);
    chmodSync(path.join(venvBin, "python"), 0o755);
    try {
      const t = await ytFetchTranscript("AAAAAAAAAAA", "en", ctx);
      expect(t.kind).toBe("local-asr");
      expect(t.words.map((w) => w.text)).toEqual(["it", "is", "l’ecluse."]);
      expect(t.words[2]).toMatchObject({ startMs: 4600, endMs: 5000, confidence: 0.9 });
      expect(fake.calls().some((a) => a.includes("ba/b"))).toBe(true);
    } finally {
      cleanup(path.join(config.paths.pyVenv));
    }
  }, 60_000);

  it("maps failures; retries rate limits (≤ 2) then gives up", async () => {
    fake.setMode({ error: "ERROR: HTTP Error 403: Forbidden" });
    await expect(ytSearch("x", ctx)).rejects.toMatchObject({ code: "YT_FORBIDDEN" });
    const before = fake.calls().length;
    fake.setMode({ error: "ERROR: HTTP Error 429: Too Many Requests" });
    await expect(ytRun(["-J", "x"], { config, signal: ctx.signal }, { retryDelayMs: 1 })).rejects.toMatchObject({ code: "YT_RATE_LIMIT" });
    expect(fake.calls().length - before).toBe(3);
  });

  it("probe: ok / bot-check / 403 / offline / missing", async () => {
    fake.setMode({ search, duration: 12 });
    expect(await ytProbe(ctx)).toBe("ok");
    fake.setMode({ error: "ERROR: Sign in to confirm you're not a bot" });
    expect(await ytProbe(ctx)).toBe("bot-check");
    fake.setMode({ error: "ERROR: HTTP Error 403: Forbidden" });
    expect(await ytProbe(ctx)).toBe("403");
    expect(await ytProbe(makeCtx({ offline: true }))).toBe("offline");
    expect(await ytProbe(makeCtx({ config: makeConfig({ offline: false }) }))).toBe("missing");
  });

  it("resolveClips: passage → download → clip-v1 with 1 s handles → frozen + words on the conformed clock", async () => {
    fake.setMode({ search, json3: transcript, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, keepSourceDownloads: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    project.editorial = { ...project.editorial, fairUseAcknowledged: true };
    const script = makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true });
    const r = await resolveClips({ project, script, facts: makeFactSheet(), skipSegments: new Set(), projectDir }, ctx);
    expect(r.clips).toHaveLength(1);
    const clip = ClipResolution.parse(r.clips[0]);
    expect(clip.status).toBe("found");
    expect(clip.youtube).toMatchObject({ videoId: "AAAAAAAAAAA", matchScore: 1, transcriptKind: "manual", startMs: 3700 });
    const frozen = FrozenAsset.parse(r.frozen[0]);
    expect(frozen.role).toBe("clip");
    expect(frozen.hasAudio).toBe(true);
    expect(frozen.conform.recipe).toBe("clip-v1");
    expect(frozen.candidate?.license.code).toBe("YOUTUBE-FAIR-USE");
    // passage [3700, ≥ 6640] + 1 s handles inside a 12 s source → the conformed file starts at 2700 ms.
    expect(frozen.conform.sourceInMs).toBe(2700);
    expect(clip.passageInMs).toBe(1000);
    expect(clip.passageOutMs! - clip.passageInMs!).toBe(clip.youtube!.endMs! - clip.youtube!.startMs!);
    const probe = await ffprobeJson(path.join(projectDir, frozen.projectRel), { config, signal: ctx.signal });
    expect(probe.streams.find((s) => s.codecType === "audio")?.codecName).toBe("aac");
    const cw = ClipWordsDoc.parse(r.clipWords[0]);
    expect(cw.words.find((w) => w.text === "it")?.startMs).toBe(4000 - 2700);
    expect(r.upgradedQuotes).toEqual(["Q1"]);
    // keepSourceDownloads:false drops the cached full source.
    expect(existsSync(path.join(config.paths.cache, "yt", "AAAAAAAAAAA.mp4"))).toBe(false);
    const dl = fake.calls().find((a) => a.includes("-f") && a.includes("mp4"))!;
    expect(dl).toEqual(expect.arrayContaining(["-t", "mp4", "--progress-template", "download:%(progress._percent_str)s"]));
  }, 120_000);

  it("resolveClips without the fair-use acknowledgement never downloads", async () => {
    fake.setMode({ search, json3: transcript, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    project.editorial = { ...project.editorial, fairUseAcknowledged: false };
    const n = fake.calls().length;
    const r = await resolveClips({ project, script: makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true }), facts: makeFactSheet(), skipSegments: new Set(), projectDir }, ctx);
    expect(r.clips[0]).toMatchObject({ status: "skipped-policy", assetId: null });
    expect(r.clips[0]!.youtube?.matchScore).toBe(1);
    expect(fake.calls().slice(n).some((a) => a.includes("-f"))).toBe(false);
  });

  it("a tie between two noisy matches goes to the injected passage picker", async () => {
    const noisy = path.join(projectDir, "noisy.json3");
    writeFileSync(noisy, JSON.stringify({ events: [{ tStartMs: 4000, dDurationMs: 2400, segs: ["it", " is", " all", " a", " river", " and", " rivers", " brake"].map((u, k) => ({ utf8: u, tOffsetMs: k * 300 })) }] }));
    const two = [search[0], { ...search[0], id: "BBBBBBBBBBB", channel: "Other Channel" }];
    fake.setMode({ search: two, json3: noisy, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    const args = { project, script: makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true }), facts: makeFactSheet(), skipSegments: new Set<string>(), projectDir };
    const first = await resolveClips(args, ctx);
    expect(first.clips[0]!.youtube).toMatchObject({ videoId: "AAAAAAAAAAA", matchScore: 0.625 });
    expect(first.clips[0]!.reason).toContain("close alternative");
    const seen: number[] = [];
    const picked = await resolveClips({ ...args, passagePicker: async (i) => { seen.push(i.windows.length); return { bestIndex: 1, confidence: 0.9 }; } }, ctx);
    expect(seen).toEqual([2]);
    expect(picked.clips[0]!.youtube?.videoId).toBe("BBBBBBBBBBB");
    expect(picked.clips[0]!.status).toBe("skipped-policy"); // no fair-use acknowledgement: nothing downloaded
  });

  it("privacy: a quote by a private victim is never searched; blocked names are stripped from the search query", async () => {
    fake.setMode({ search, json3: transcript, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    const script = makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true });
    const facts = makeFactSheet();
    facts.people.push({ id: "P9", name: "Mira Victimsdottir", roleInStory: "victim", publicFigure: false, isMinorOrPrivateVictim: true, imageQueries: [], wikidataQid: null, aliases: [] });
    const n0 = fake.calls().length;
    // 1) the speaker is a private victim → skipped-policy before any yt-dlp call
    const victimFacts = { ...facts, quotes: facts.quotes.map((q) => (q.id === "Q1" ? { ...q, speakerId: "P9", youtubeSearchQuery: "Mira Victimsdottir interview fever" } : q)) };
    const r1 = await resolveClips({ project, script, facts: victimFacts, skipSegments: new Set(), projectDir }, ctx);
    expect(r1.clips[0]).toMatchObject({ status: "skipped-policy", assetId: null, youtube: null });
    expect(fake.calls().length).toBe(n0);
    // 2) a public speaker, but the LLM query names the victim → the name never reaches yt-dlp
    const namedFacts = { ...facts, quotes: facts.quotes.map((q) => (q.id === "Q1" ? { ...q, youtubeSearchQuery: "Carolus Clusius on Mira Victimsdottir fever" } : q)) };
    const r2 = await resolveClips({ project, script, facts: namedFacts, skipSegments: new Set(), projectDir }, ctx);
    expect(r2.clips[0]!.youtube?.videoId).toBe("AAAAAAAAAAA");
    const calls = fake.calls().slice(n0);
    expect(calls.some((a) => a.includes("ytsearch10:Carolus Clusius on fever"))).toBe(true);
    expect(calls.flat().some((a) => /mira|victimsdottir/i.test(a))).toBe(false);
  });

  it("stops reading transcripts once a strong match exists", async () => {
    const three = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"].map((id, k) => ({ ...search[0], id, view_count: 100 - k }));
    fake.setMode({ search: three, json3: transcript, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    const n0 = fake.calls().length;
    const r = await resolveClips({ project, script: makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true }), facts: makeFactSheet(), skipSegments: new Set(), projectDir }, ctx);
    expect(r.clips[0]!.youtube).toMatchObject({ videoId: "AAAAAAAAAAA", matchScore: 1 });
    expect(fake.calls().slice(n0).filter((a) => a.includes("--write-subs"))).toHaveLength(1);
  });

  it("an unreadable hit (age gate, members-only, premiere) is skipped; machine-wide failures still end the search", async () => {
    const three = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"].map((id, k) => ({ ...search[0], id, view_count: 100 - k }));
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    const args = { project, script: makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true }), facts: makeFactSheet(), skipSegments: new Set<string>(), projectDir };
    fake.setMode({ search: three, json3: transcript, duration: 12, errorFor: {
      AAAAAAAAAAA: "ERROR: [youtube] AAAAAAAAAAA: Sign in to confirm your age. This video may be inappropriate for some users.",
      BBBBBBBBBBB: "ERROR: [youtube] BBBBBBBBBBB: This live event will begin in 3 hours.",
    } });
    const r = await resolveClips(args, ctx);
    expect(r.clips[0]!.youtube).toMatchObject({ videoId: "CCCCCCCCCCC", matchScore: 1 });
    // A bot check concerns every hit: the search stops at the first one.
    fake.setMode({ search: three, json3: transcript, duration: 12, errorFor: { AAAAAAAAAAA: "ERROR: [youtube] AAAAAAAAAAA: Sign in to confirm you’re not a bot" } });
    const n0 = fake.calls().length;
    const b = await resolveClips(args, ctx);
    expect(b.clips[0]).toMatchObject({ status: "failed" });
    expect(b.clips[0]!.reason).toMatch(/^YT_BOT_CHECK/);
    expect(fake.calls().slice(n0).filter((a) => a.includes("-J") && !a.some((x) => x.startsWith("ytsearch")))).toHaveLength(1);
  });

  it("a manual URL whose v= carries a path never touches files outside the yt cache", async () => {
    fake.setMode({ search, json3: transcript, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, keepSourceDownloads: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    project.editorial = { ...project.editorial, fairUseAcknowledged: true };
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    const victim = path.join(config.paths.home, "victim.mp4");
    writeFileSync(victim, "precious");
    const rel = path.relative(path.join(config.paths.cache, "yt"), victim).replace(/\.mp4$/, "");
    const r = await resolveManualClip({ projectDir, segmentId: "CH1-S02", quoteId: "Q1", startMs: 4000, endMs: 6500, channel: "", title: "", fps: 30, url: `https://www.youtube.com/watch?v=AAAAAAAAAAA/${rel}`, file: null }, ctx);
    expect(r.clip.youtube).toMatchObject({ videoId: "AAAAAAAAAAA", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" });
    expect(readFileSync(victim, "utf8")).toBe("precious");
    expect(fake.calls().flat().some((a) => a.includes(".."))).toBe(false);
  }, 120_000);

  it("local ASR runs at most once per quote", async () => {
    const three = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"].map((id, k) => ({ ...search[0], id, view_count: 100 - k }));
    fake.setMode({ search: three, duration: 12, noSubs: true });
    const venvBin = path.join(config.paths.pyVenv, "bin");
    mkdirSync(venvBin, { recursive: true });
    const pieces = [{ text: " unrelated", startMs: 0, endMs: 500, p: 0.9 }, { text: " words", startMs: 500, endMs: 900, p: 0.9 }];
    writeFileSync(path.join(venvBin, "python"), `#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "--out" ]; then out="$2"; fi; shift; done\nprintf '%s' '${JSON.stringify({ words: pieces, durationSec: 12, rtf: 0.1 })}' > "$out"\n`);
    chmodSync(path.join(venvBin, "python"), 0o755);
    try {
      const project: Project = makeProject();
      project.assets = { ...project.assets, offline: false, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
      const n0 = fake.calls().length;
      const r = await resolveClips({ project, script: makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true }), facts: makeFactSheet(), skipSegments: new Set(), projectDir }, ctx);
      expect(r.clips[0]!.status).toBe("not-found");
      expect(fake.calls().slice(n0).filter((a) => a.includes("ba/b"))).toHaveLength(1);
    } finally {
      cleanup(path.join(config.paths.pyVenv));
    }
  }, 60_000);

  it("manual clips: URL (yt-dlp) and local file, both behind the fair-use gate", async () => {
    fake.setMode({ search, json3: transcript, duration: 12 });
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false, keepSourceDownloads: true, licensePolicy: { ...project.assets.licensePolicy, allowYoutubeFairUse: true } };
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    const base = { projectDir, segmentId: "CH1-S02", quoteId: "Q1", startMs: 4000, endMs: 6500, channel: "", title: "", fps: 30 };
    await expect(resolveManualClip({ ...base, url: "https://youtu.be/AAAAAAAAAAA", file: null }, ctx)).rejects.toMatchObject({ code: "GATE_REQUIRED" });
    project.editorial = { ...project.editorial, fairUseAcknowledged: true };
    await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    const byUrl = await resolveManualClip({ ...base, url: "https://youtu.be/AAAAAAAAAAA", file: null }, ctx);
    expect(byUrl.clip).toMatchObject({ status: "manual", source: "manual-url", passageInMs: 1000 });
    expect(byUrl.clip.youtube?.channel).toBe("Archive Channel");
    expect(byUrl.words?.words.length).toBeGreaterThan(0);
    const src = path.join(config.paths.cache, "yt", "AAAAAAAAAAA.mp4");
    expect(existsSync(src)).toBe(true); // keepSourceDownloads:true keeps the full source
    const byFile = await resolveManualClip({ ...base, url: null, file: src, channel: "Archive Channel", title: "Interview" }, ctx);
    expect(byFile.clip).toMatchObject({ status: "manual", source: "manual-file", youtube: null });
    expect(byFile.frozen.declaration?.kind).toBe("third-party-quotation");
    expect(existsSync(path.join(projectDir, "assets/user-frozen", `${byFile.frozen.id}.json`))).toBe(true);
    await expect(resolveManualClip({ ...base, url: "https://vimeo.com/1", file: null }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resolveManualClip({ ...base, url: null, file: null }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  }, 180_000);
});
