// qa[lang, preset] (App. D, §16.4): ffprobe, ebur128, blackdetect (pix_th=0.03, pic_th=0.99) + freezedetect in one decode,
// contact sheets via renderClient.renderStills, audio.densityReport, director stats → qa/<lang>/<preset>/report.json.
import path from "node:path";
import { P, QaReport, Timeline, docHash, type Lang, type LintIssue, type QaCheck, type RenderPresetId } from "@docmaker/core";
import { ffprobeJson, measureEbur128, run } from "@docmaker/core/node";
import type { StageCtx, StageDef } from "../types";
import { docs, need } from "../docs";
import { nowIso } from "../util";
import { X, emitLog, needLang } from "./common";
import { presetOf, snapshotTimelineRel } from "./render";

export const QA_NOTICE = "The mix was checked by meters only; nobody listened to it." as const;
export const PRESET_SIZE: Record<RenderPresetId, { width: number; height: number }> = { draft: { width: 960, height: 540 }, master: { width: 1920, height: 1080 } };
export const BLACK_FILTER = "blackdetect=d=1:pix_th=0.03:pic_th=0.99";
export const FREEZE_FILTER = "freezedetect=n=0.003:d=3.5";
/** One dip to black (chapter card / act break) may last up to 1.4 s; any other black run > 1 s is an error. */
export const MAX_DIP_SEC = 1.4;

export interface Run { start: number; end: number; duration: number }

/** Parses blackdetect lines (`black_start:1.2 black_end:2.3 black_duration:1.1`). */
export function parseBlackdetect(stderr: string): Run[] {
  const out: Run[] = [];
  for (const m of stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/g)) {
    out.push({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) });
  }
  return out;
}

/** Parses freezedetect metadata lines (freeze_start / freeze_duration / freeze_end, in that order). */
export function parseFreezedetect(stderr: string): Run[] {
  const out: Run[] = [];
  let start: number | null = null;
  let duration: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /lavfi\.freezedetect\.freeze_start:\s*([\d.]+)/.exec(line);
    if (s) { start = Number(s[1]); duration = null; continue; }
    const d = /lavfi\.freezedetect\.freeze_duration:\s*([\d.]+)/.exec(line);
    if (d) { duration = Number(d[1]); continue; }
    const e = /lavfi\.freezedetect\.freeze_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      const end = Number(e[1]);
      out.push({ start, end, duration: duration ?? end - start });
      start = null;
    }
  }
  return out;
}

/** §16.4.4: no black run > 1 s except ONE dip ≤ 1.4 s. Returns the offending runs. */
export function blackViolations(runs: readonly Run[]): Run[] {
  const long = runs.filter((r) => r.duration > 1);
  const dips = long.filter((r) => r.duration <= MAX_DIP_SEC);
  const tooLong = long.filter((r) => r.duration > MAX_DIP_SEC);
  return [...tooLong, ...dips.slice(1)];
}

/** Contact-sheet frames: first/middle/last of each shot, ≤ 60, unique, sorted. */
export function sheetFrames(t: Pick<Timeline, "video" | "durationInFrames">, max = 60): number[] {
  const set = new Set<number>();
  for (const c of t.video) {
    const end = c.from + c.dur - 1;
    set.add(c.from);
    set.add(Math.floor((c.from + end) / 2));
    set.add(end);
  }
  let frames = [...set].filter((f) => f >= 0 && f < t.durationInFrames).sort((a, b) => a - b);
  if (frames.length > max) {
    const step = frames.length / max;
    frames = Array.from({ length: max }, (_, i) => frames[Math.floor(i * step)]!);
  }
  return frames;
}

const check = (id: string, level: QaCheck["level"], ok: boolean, message: string, value: number | null = null, threshold: number | null = null, frame: number | null = null): QaCheck =>
  ({ id, level, ok, message, value, threshold, frame });

async function detectRuns(ctx: StageCtx, file: string): Promise<{ black: Run[]; freeze: Run[] }> {
  const r = await run(ctx.config.ffmpeg, ["-hide_banner", "-nostdin", "-i", file, "-an", "-vf", `${BLACK_FILTER},${FREEZE_FILTER},metadata=mode=print`, "-f", "null", "-"], { signal: ctx.signal });
  if (r.code !== 0) throw new Error(`ffmpeg blackdetect failed: ${r.stderr.slice(-400)}`);
  return { black: parseBlackdetect(r.stderr), freeze: parseFreezedetect(r.stderr) };
}

/**
 * The render document without its run bookkeeping (renderMs, per-chunk ms and cached flags): a re-render that reuses
 * every chunk (same frames, same final.mp4) does not stale the QA report.
 */
async function renderContentHash(ctx: Pick<StageCtx, "store">, lang: Lang, preset: RenderPresetId): Promise<string | null> {
  const doc = await docs.renderDoc(ctx.store, lang, preset).catch(() => null);
  if (!doc) return null;
  return docHash({ ...doc, renderMs: 0, chunks: doc.chunks.map((c) => ({ ...c, cached: false, ms: 0 })) });
}

/**
 * SFX density uses the director's definition (§9.5 step 4, lint DENSITY_MAX): roll-collapsed SFX events in a sliding 60 s
 * window, capped at perMin[1] × the act intensity of the window. The director's lint already measures exactly that, so
 * QA reports its verdict; the fixed per-minute bins of densityReport (raw cues, partial last minute extrapolated) are
 * informative only and never warn on their own.
 */
export function sfxDensityCheck(lintIssues: readonly LintIssue[] | null, binsPerMin: readonly number[], perMinCap: number): QaCheck {
  const maxBin = Math.max(0, ...binsPerMin);
  if (lintIssues === null) return check("sfx-density", "info", true, `no director lint: max ${maxBin} SFX in a calendar minute (style cap ${perMinCap}/min × act intensity, not checked)`, maxBin, perMinCap);
  const over = lintIssues.find((x) => x.rule === "DENSITY_MAX" && / SFX in /.test(x.msg));
  if (over) return check("sfx-density", "warn", false, `SFX density over the style cap at ${over.where}: ${over.msg}`, maxBin, perMinCap);
  return check("sfx-density", "warn", true, `SFX density within the style cap (${perMinCap}/min × act intensity, sliding 60 s window)`, maxBin, perMinCap);
}

export const qaStage: StageDef = {
  id: "qa",
  perLang: true,
  version: 1,
  optionKeys: [],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const preset = presetOf(ctx);
    return {
      render: await renderContentHash(ctx, lang, preset), final: await ctx.store.etag(P.renderFinal(lang, preset)),
      timeline: await ctx.store.docHashOf(P.timeline(lang)), lint: await ctx.store.docHashOf(P.timelineLint(lang)), audio: ctx.project.audio,
    };
  },
  outputs: (ctx) => [P.qaReport(needLang(ctx), presetOf(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const preset = presetOf(ctx);
    const renderDoc = need(await docs.renderDoc(ctx.store, lang, preset), P.renderDoc(lang, preset), `render (${lang}, ${preset})`);
    const finalAbs = ctx.store.abs(P.renderFinal(lang, preset));
    const snapRel = snapshotTimelineRel(lang, preset);
    const t = (await ctx.store.exists(snapRel)) ? await ctx.store.readJson(snapRel, Timeline) : need(await docs.timeline(ctx.store, lang), `timeline/${lang}.json`, `direct (${lang})`);
    const checks: QaCheck[] = [];
    const a = ctx.project.audio;

    ctx.progress(0.05, "probing");
    const pr = await ffprobeJson(finalAbs, { config: ctx.config, signal: ctx.signal, countFrames: true });
    const v = pr.streams.filter((s) => s.codecType === "video");
    const au = pr.streams.filter((s) => s.codecType === "audio");
    const vs = v[0] ?? null;
    const as = au[0] ?? null;
    const size = PRESET_SIZE[preset];
    const expectedFrames = renderDoc.frames;
    checks.push(check("streams", "error", v.length === 1 && au.length === 1, `${v.length} video and ${au.length} audio stream(s) (expected 1 + 1)`));
    if (vs) {
      checks.push(check("video-codec", "error", vs.codecName === "h264" && vs.pixFmt === "yuv420p", `video ${vs.codecName} ${vs.pixFmt ?? "?"} (expected h264 yuv420p)`));
      checks.push(check("video-size", "error", vs.width === size.width && vs.height === size.height, `${vs.width}×${vs.height} (expected ${size.width}×${size.height} for ${preset})`));
      checks.push(check("video-fps", "error", vs.fps !== null && Math.abs(vs.fps - t.fps) < 0.01, `${vs.fps ?? "?"} fps (expected ${t.fps})`, vs.fps, t.fps));
      checks.push(check("frame-count", "error", vs.nbFrames === expectedFrames, `${vs.nbFrames ?? "?"} frames (expected ${expectedFrames})`, vs.nbFrames, expectedFrames));
    }
    const expectedSec = expectedFrames / t.fps;
    checks.push(check("duration", "error", Math.abs(pr.durationSec - expectedSec) <= 1 / t.fps + 1e-3, `container ${pr.durationSec.toFixed(3)} s (expected ${expectedSec.toFixed(3)} s ± 1 frame)`, pr.durationSec, expectedSec));
    if (as) checks.push(check("audio-format", "error", as.codecName === "aac" && as.sampleRate === 48000 && as.channels === 2, `audio ${as.codecName} ${as.sampleRate ?? "?"} Hz ${as.channels ?? "?"} ch (expected aac 48000 Hz 2 ch)`));

    ctx.progress(0.25, "loudness");
    let loudness: QaReport["loudness"] = null;
    if (as) {
      const m = await measureEbur128(finalAbs, { config: ctx.config, signal: ctx.signal, stream: "a:0" });
      loudness = { integratedLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, lra: m.lra };
      checks.push(check("loudness-integrated", "error", Math.abs(m.integratedLufs - a.targetLufs) <= 1, `integrated ${m.integratedLufs.toFixed(1)} LUFS (target ${a.targetLufs} ± 1)`, m.integratedLufs, a.targetLufs));
      checks.push(check("true-peak", "error", m.truePeakDbtp <= a.truePeakGate, `true peak ${m.truePeakDbtp.toFixed(2)} dBTP (gate ≤ ${a.truePeakGate})`, m.truePeakDbtp, a.truePeakGate));
    }

    ctx.progress(0.45, "black / freeze detection");
    const runs = await detectRuns(ctx, finalAbs);
    const bad = blackViolations(runs.black);
    checks.push(check("black", "error", bad.length === 0,
      bad.length === 0 ? `${runs.black.length} black dip(s), none longer than ${MAX_DIP_SEC} s` : `black run(s) > 1 s: ${bad.map((r) => `${r.start.toFixed(2)}–${r.end.toFixed(2)} s`).join(", ")}`,
      bad[0]?.duration ?? null, MAX_DIP_SEC, bad[0] ? Math.round(bad[0].start * t.fps) : null));
    for (const f of runs.freeze) checks.push(check("freeze", "warn", false, `no visual change for ${f.duration.toFixed(1)} s at ${f.start.toFixed(1)} s`, f.duration, 3.5, Math.round(f.start * t.fps)));

    // director lint + stats, audio density
    const lint = await docs.timelineLint(ctx.store, lang);
    const lintErrors = lint?.issues.filter((x) => x.level === "error") ?? [];
    checks.push(check("timeline-lint", "error", lintErrors.length === 0, lintErrors.length ? `${lintErrors.length} timeline lint error(s): ${lintErrors.slice(0, 5).map((x) => x.rule).join(", ")}` : "timeline lint clean", lintErrors.length, 0));
    try {
      const d = e.rt.deps.audio.densityReport(t);
      checks.push(sfxDensityCheck(lint?.issues ?? null, d.sfxPerMin, ctx.style.data.sfxPolicy.perMin[1]));
      checks.push(check("silent-cut-share", "info", true, `${Math.round(d.silentCutShare * 100)} % of cuts without a cut SFX`, d.silentCutShare, null));
    } catch (err) {
      emitLog(ctx, "qa", "warn", `density report unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (lint?.stats && typeof lint.stats.aslSec === "number") checks.push(check("asl", "info", true, `average shot length ${(lint.stats.aslSec as number).toFixed(2)} s`, lint.stats.aslSec as number, null));

    // contact sheets (render client; skipped when this process has none)
    ctx.progress(0.7, "contact sheets");
    let contactSheets: string[] = [];
    if (ctx.render) {
      const outDir = ctx.store.abs(P.qaSheets(lang, preset));
      const files = await ctx.render.renderStills({
        projectDir: ctx.store.dir, timelineRel: (await ctx.store.exists(snapRel)) ? snapRel : P.timeline(lang), frames: sheetFrames(t), outDir, scale: 0.25,
        sheet: { cols: 6, width: 640, label: true },
      }, { onEvent: (ev) => ctx.emit(ev), signal: ctx.signal });
      // renderStills returns the stills followed by the sheets; the report lists the sheets (all files when no sheet was made)
      const sheets = files.filter((f) => /sheet-\d+\.(jpe?g|png)$/i.test(path.basename(f)));
      contactSheets = (sheets.length ? sheets : files).map((f) => path.relative(ctx.store.dir, f).split(path.sep).join("/"));
    } else {
      checks.push(check("contact-sheets", "info", true, "no render client in this process: contact sheets skipped"));
    }

    const report = QaReport.parse({
      schemaVersion: 1, lang, preset, createdAt: nowIso(), checks,
      probe: vs && as ? {
        durationSec: pr.durationSec, frames: vs.nbFrames ?? 0, width: vs.width ?? 0, height: vs.height ?? 0, fps: vs.fps ?? 0, vcodec: vs.codecName, pixFmt: vs.pixFmt ?? "",
        acodec: as.codecName, sampleRate: as.sampleRate ?? 0, channels: as.channels ?? 0,
      } : null,
      loudness, contactSheets, audioNotListenedNotice: QA_NOTICE,
    });
    await ctx.store.writeJson(P.qaReport(lang, preset), QaReport, report, { writer: "stage", stage: "qa" });
    const errs = checks.filter((c) => !c.ok && c.level === "error");
    emitLog(ctx, "qa", errs.length ? "warn" : "info", `${lang}/${preset}: ${checks.filter((c) => c.ok).length}/${checks.length} checks ok${errs.length ? `; errors: ${errs.map((c) => c.id).join(", ")}` : ""}`);
    return { artifacts: [P.qaReport(lang, preset), ...contactSheets] };
  },
};
