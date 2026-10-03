// doctor (§15.3): environment report. Every probe is local and fast, except the optional yt-dlp reachability probe
// (skipped offline). Pure parsers are exported for tests.
import { existsSync, readdirSync, accessSync, constants as fsc } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV_KEYS, GlProbe, type RuntimeConfig, type SecretName, type Secrets } from "@docmaker/core";
import { cacheCapBytes, freeDiskBytes, maskSecret, readHomeConfig, run } from "@docmaker/core/node";
import type { DoctorCheck, DoctorReport } from "./types";
import type { Runtime } from "./runtime";

export const REQUIRED_FILTERS = [
  "afftfilt", "aevalsrc", "anoisesrc", "gradients", "life", "drawgrid", "noise", "colorchannelmixer", "vignette", "loudnorm", "ebur128",
  "silencedetect", "silenceremove", "acrossover", "blackdetect", "freezedetect", "scdet", "tile", "lut3d",
] as const;
export const REQUIRED_ENCODERS = ["libx264", "aac"] as const;
export const REPO_CHROME_REL = "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell";
const GiB = 1024 ** 3;

export function parseFfmpegVersion(text: string): [number, number] | null {
  const m = /version\s+n?(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
/** Names listed by `ffmpeg -filters` / `-encoders` (second column). */
export function parseFfmpegList(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[A-Z.|]{2,6}\s+([A-Za-z0-9_]+)\s/.exec(line);
    if (m) out.add(m[1]!);
  }
  return out;
}
export function versionAtLeast(v: [number, number] | null, min: [number, number]): boolean {
  return !!v && (v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]));
}
export function nodeVersionCheck(version: string): DoctorCheck {
  const [maj = 0, min = 0] = version.replace(/^v/, "").split(".").map(Number);
  const ok = maj === 22 && min >= 12;
  return { id: "node", ok, level: maj < 22 || (maj === 22 && min < 12) ? "error" : ok ? "info" : "warn", value: version, hint: ok ? null : "use Node 22.12+ (< 23); .nvmrc says 22" };
}
const fmtBytes = (n: number) => (n >= GiB ? `${(n / GiB).toFixed(1)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`);

async function tool(cmd: string, args: string[], signal: AbortSignal): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await run(cmd, args, { signal, timeoutMs: 8000 });
    return { ok: r.code === 0, out: r.stdout + r.stderr };
  } catch {
    return { ok: false, out: "" };
  }
}

function isExec(p: string | null): boolean {
  if (!p) return false;
  try {
    accessSync(p, fsc.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function secretChecks(secrets: Secrets): DoctorCheck[] {
  return (Object.entries(ENV_KEYS) as [SecretName, string][]).map(([name, env]) => ({
    id: `key:${name}`, ok: true, level: "info" as const, value: `${env} ${maskSecret(secrets[name])}`, hint: secrets[name] ? null : `docmaker keys set ${name}`,
  }));
}

export function hyperframesResidue(home: string): string[] {
  const out: string[] = [];
  const skills = path.join(home, ".claude", "skills");
  try {
    for (const d of readdirSync(skills)) if (d.startsWith("hyperframes")) out.push(path.join(skills, d));
  } catch { /* none */ }
  const agents = path.join(home, ".agents", "skills");
  try {
    for (const d of readdirSync(agents)) out.push(path.join(agents, d));
  } catch { /* none */ }
  const cfg = path.join(home, ".hyperframes", "config.json");
  if (existsSync(cfg)) out.push(cfg);
  return out;
}

export async function runDoctor(rt: Runtime, o: { probeNetwork?: boolean; signal?: AbortSignal } = {}): Promise<DoctorReport> {
  const signal = o.signal ?? new AbortController().signal;
  const config: RuntimeConfig = rt.config;
  const checks: DoctorCheck[] = [];
  const add = (c: DoctorCheck) => checks.push(c);

  // platform, node, pnpm, proxy
  const plat = `${process.platform} ${process.arch}`;
  add({ id: "platform", ok: process.platform !== "win32", level: process.platform === "win32" ? "error" : "info", value: plat, hint: process.platform === "win32" ? "use WSL2" : null });
  add(nodeVersionCheck(process.versions.node));
  const pnpm = await tool("pnpm", ["--version"], signal);
  const pv = pnpm.out.trim();
  add({ id: "pnpm", ok: pnpm.ok && /^10\./.test(pv), level: "warn", value: pnpm.ok ? pv : "not found", hint: pnpm.ok && /^10\./.test(pv) ? null : "install pnpm 10 (corepack enable)" });
  const proxyVars = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].filter((k) => (rt.env[k] ?? "") !== "");
  const proxyOk = proxyVars.length === 0 || rt.env.NODE_USE_ENV_PROXY === "1";
  add({ id: "node-use-env-proxy", ok: proxyOk, level: "warn", value: proxyVars.length ? `proxy set (${proxyVars[0]}), NODE_USE_ENV_PROXY=${rt.env.NODE_USE_ENV_PROXY ?? "(unset)"}` : "no proxy", hint: proxyOk ? null : "run docmaker through its bin shim (it sets NODE_USE_ENV_PROXY=1)" });

  // ffmpeg / ffprobe
  const fv = await tool(config.ffmpeg, ["-hide_banner", "-version"], signal);
  const ver = parseFfmpegVersion(fv.out);
  add({ id: "ffmpeg", ok: fv.ok && versionAtLeast(ver, [6, 1]), level: "error", value: fv.ok ? (ver ? `${ver[0]}.${ver[1]}` : "unknown version") : "not found", hint: fv.ok && versionAtLeast(ver, [6, 1]) ? null : "install ffmpeg ≥ 6.1" });
  if (fv.ok) {
    const filters = parseFfmpegList((await tool(config.ffmpeg, ["-hide_banner", "-filters"], signal)).out);
    const encoders = parseFfmpegList((await tool(config.ffmpeg, ["-hide_banner", "-encoders"], signal)).out);
    const missing = [...REQUIRED_FILTERS.filter((f) => !filters.has(f)), ...REQUIRED_ENCODERS.filter((e) => !encoders.has(e))];
    add({ id: "ffmpeg-features", ok: missing.length === 0, level: "error", value: missing.length ? `missing: ${missing.join(", ")}` : `${REQUIRED_FILTERS.length} filters + libx264 + aac`, hint: missing.length ? "install a full ffmpeg build (e.g. the distro package)" : null });
  }
  const fp = await tool(config.ffprobe, ["-hide_banner", "-version"], signal);
  add({ id: "ffprobe", ok: fp.ok, level: "error", value: fp.ok ? (parseFfmpegVersion(fp.out)?.join(".") ?? "ok") : "not found", hint: fp.ok ? null : "install ffprobe (ships with ffmpeg)" });
  const tar = await tool("tar", ["--version"], signal);
  add({ id: "tar", ok: tar.ok, level: "warn", value: tar.ok ? tar.out.split("\n")[0]!.trim() : "not found", hint: tar.ok ? null : "install tar (model extraction)" });

  // Chrome, GL, fonts, Remotion licence
  const exe = config.browserExecutable && isExec(config.browserExecutable) ? config.browserExecutable : isExec(path.join(config.repoRoot, REPO_CHROME_REL)) ? path.join(config.repoRoot, REPO_CHROME_REL) : null;
  add({ id: "chrome", ok: exe !== null, level: "error", value: exe ?? "not found", hint: exe ? null : "docmaker setup --browser" });
  let gl = "not probed yet (first render)";
  try {
    const g = GlProbe.parse(JSON.parse(await readFile(config.paths.glProbe, "utf8")));
    gl = `${g.chosen}${g.gpu ? " (GPU)" : " (CPU)"} probed ${g.probedAt.slice(0, 10)}`;
  } catch { /* not probed */ }
  add({ id: "gl-probe", ok: true, level: "info", value: gl, hint: null });
  const fontsDir = path.join(config.repoRoot, "packages", "remotion", "node_modules", "@fontsource");
  const fontsOk = existsSync(fontsDir) && readdirSync(fontsDir).length >= 7;
  add({ id: "fonts", ok: fontsOk, level: "warn", value: fontsOk ? "self-hosted @fontsource families installed" : "missing @fontsource packages", hint: fontsOk ? null : "pnpm install --frozen-lockfile" });
  const hc = await readHomeConfig(config).catch(() => null);
  const lic = hc?.remotionLicense ?? null;
  const licOk = lic !== null && !(lic.status === "company-license" && !rt.secrets.remotionLicense);
  add({ id: "remotion-license", ok: licOk, level: "warn", value: lic ? lic.status : "not acknowledged", hint: lic === null ? "acknowledge the Remotion licence (web /setup)" : licOk ? null : "set REMOTION_LICENSE_KEY (docmaker keys set remotionLicense)" });
  const xml = await tool("xmllint", ["--version"], signal);
  add({ id: "xmllint", ok: xml.ok, level: "info", value: xml.ok ? "present" : "not found (optional: DTD validation of exports)", hint: null });

  // optional sidecars and models
  const py = path.join(config.paths.pyVenv, "bin", "python");
  add({ id: "python-sidecar", ok: existsSync(py), level: "info", value: existsSync(py) ? py : "not installed (optional: faster-whisper, yt-dlp, beats)", hint: existsSync(py) ? null : "docmaker setup --python" });
  if (o.probeNetwork && !config.offline) {
    try {
      const assets = rt.deps.assets;
      const http = assets.createHttpClient({ config, logger: rt.logger });
      const r = await assets.ytProbe({ config, secrets: rt.secrets, logger: rt.logger, http, signal, progress: () => {}, costs: null as never, cache: assets.createFrozenCache({ config, logger: rt.logger }) as never });
      add({ id: "yt-dlp", ok: r === "ok", level: "warn", value: r, hint: r === "ok" ? null : r === "missing" ? "docmaker setup --yt-dlp" : "degraded mode: import clips manually (docmaker assets clip)" });
    } catch (e) {
      add({ id: "yt-dlp", ok: false, level: "warn", value: `probe failed: ${e instanceof Error ? e.message : String(e)}`, hint: "degraded mode: import clips manually" });
    }
  } else {
    const yt = existsSync(path.join(config.paths.pyVenv, "bin", "yt-dlp")) || existsSync(path.join(config.paths.bin, "yt-dlp"));
    add({ id: "yt-dlp", ok: yt, level: "info", value: yt ? (config.offline ? "installed (offline: not probed)" : "installed (not probed)") : "not installed", hint: yt ? null : "docmaker setup --yt-dlp" });
  }
  const sub = (d: string) => {
    try {
      return readdirSync(path.join(config.paths.models, d)).filter((x) => !x.startsWith(".")).join(", ") || null;
    } catch {
      return null;
    }
  };
  for (const m of ["kokoro", "piper", "whisper"]) {
    const v = sub(m);
    add({ id: `model:${m}`, ok: v !== null, level: "info", value: v ?? "not installed (optional)", hint: v ? null : m === "whisper" ? "docmaker setup --whisper faster-whisper" : `docmaker setup --tts ${m === "kokoro" ? "kokoro" : "piper:<voice>"}` });
  }
  add({ id: "clip", ok: existsSync(config.paths.ml), level: "info", value: existsSync(config.paths.ml) && readdirSync(config.paths.ml).length ? "installed" : "not installed (optional, M3)", hint: null });

  // keys, contact, disk, residue
  checks.push(...secretChecks(rt.secrets));
  add({ id: "contact", ok: config.contact !== null, level: "warn", value: config.contact ? "set" : "unset", hint: config.contact ? null : "set DOCMAKER_CONTACT (Wikimedia etiquette) or the contact in settings" });
  for (const [id, dir] of [["disk:home", config.paths.home], ["disk:projects", config.projectsDir]] as const) {
    let free: number | null = null;
    let probe = dir;
    while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try {
      free = await freeDiskBytes(probe);
    } catch { /* unknown */ }
    add({ id, ok: free !== null && free >= 5 * GiB, level: free !== null && free < GiB ? "error" : "warn", value: free === null ? "unknown" : `${fmtBytes(free)} free (${dir})`, hint: free !== null && free < 5 * GiB ? "free disk space (renders need several GiB)" : null });
  }
  try {
    const ix = JSON.parse(await readFile(path.join(config.paths.cache, "index.json"), "utf8")) as { blobs?: { bytes: number }[] };
    const used = (ix.blobs ?? []).reduce((a, b) => a + b.bytes, 0);
    const cap = await cacheCapBytes(config);
    add({ id: "cache", ok: used <= cap, level: "warn", value: `${fmtBytes(used)} / cap ${fmtBytes(cap)}`, hint: used <= cap ? null : "docmaker cache gc" });
  } catch {
    add({ id: "cache", ok: true, level: "info", value: "empty", hint: null });
  }
  const residue = hyperframesResidue(rt.env.HOME || os.homedir());
  add({ id: "hyperframes-residue", ok: residue.length === 0, level: "warn", value: residue.length ? residue.join(", ") : "none", hint: residue.length ? "remove these by hand (they are not used by DocumentaryMaker)" : null });

  return { checks, blocking: checks.some((c) => !c.ok && c.level === "error") };
}
