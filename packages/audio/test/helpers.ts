// Shared test helpers: an offline runtime in a temp home (shared per test file), a silent logger, signal helpers.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "@docmaker/core";
import { loadRuntime } from "@docmaker/core/node";
import type { AudioCtx } from "../src/index";

export function tmpDir(prefix = "audio-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child() { return silentLogger; },
};

export function makeCtx(o?: { home?: string }): AudioCtx & { events: [number, string][]; home: string } {
  const home = o?.home ?? tmpDir("audio-home-");
  const { config } = loadRuntime({
    cwd: import.meta.dirname,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCMAKER_HOME: home, DOCMAKER_PROJECTS: path.join(home, "projects"), DOCMAKER_OFFLINE: "1" },
  });
  const events: [number, string][] = [];
  return { config, logger: silentLogger, signal: new AbortController().signal, progress: (p, m) => { events.push([p, m]); }, events, home };
}

/** RMS in dB of a channel range [a, b). */
export function rmsDb(x: Float32Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-30);
}
