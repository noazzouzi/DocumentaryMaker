// Remotion's terminal noise (memory-mismatch warnings, the GL probe's echoed browser console lines) goes to the debug
// log only; every other console line passes through untouched.
import { describe, expect, it } from "vitest";
import type { Logger } from "@docmaker/core";
import { installRemotionNoiseFilter, isBrowserProbeLog, setRemotionDebugLogger } from "../src/remotion";

const esc = "\u001b";
const bgBlack = (s: string) => `${esc}[40m ${s} ${esc}[49m`; // Remotion's verboseTag with colours
const TAG = "Tab 0, src/specimen/compositions.tsx:90";

describe("Remotion noise routed to the debug log", () => {
  it("recognises the GL probe lines Remotion echoes (coloured or bracketed), nothing else", () => {
    expect(isBrowserProbeLog([bgBlack(TAG), "UNMASKED_RENDERER_WEBGL=none"])).toBe(true);
    expect(isBrowserProbeLog([`[${TAG}]`, 'GL_PROBE {"ok":true}'])).toBe(true);
    expect(isBrowserProbeLog(["UNMASKED_RENDERER_WEBGL=none"])).toBe(false); // not Remotion's echo
    expect(isBrowserProbeLog([`[${TAG}]`, "hello"])).toBe(false);
    expect(isBrowserProbeLog(["[..] render (en)"])).toBe(false);
    expect(isBrowserProbeLog([])).toBe(false);
  });

  it("memory warnings and probe lines reach logger.debug, never the console; other lines pass through", () => {
    const out: { method: string; args: unknown[] }[] = [];
    const debug: { msg: string; meta?: Record<string, unknown> }[] = [];
    const saved = { warn: console.warn, log: console.log, info: console.info };
    for (const m of ["warn", "log", "info"] as const) console[m] = (...args: unknown[]) => void out.push({ method: m, args });
    const logger: Logger = {
      debug: (msg, meta) => void debug.push({ msg, meta }), info: () => {}, warn: () => {}, error: () => {}, child: () => logger,
    };
    try {
      setRemotionDebugLogger(logger);
      installRemotionNoiseFilter();
      console.warn(`${esc}[33mDetected differing memory amounts:${esc}[39m`);
      console.warn(`${esc}[33mMemory reported by CGroup: 8796093017768.00 MB${esc}[39m`);
      console.log(bgBlack(TAG), "UNMASKED_RENDERER_WEBGL=ANGLE (SwiftShader)");
      console.info(`[${TAG}]`, 'GL_PROBE {"ok":false}');
      console.warn("a real warning");
      console.log("[ok] render (en) 3 s");
    } finally {
      Object.assign(console, saved);
      setRemotionDebugLogger(null);
    }
    expect(out).toEqual([{ method: "warn", args: ["a real warning"] }, { method: "log", args: ["[ok] render (en) 3 s"] }]);
    expect(debug.map((d) => d.msg)).toEqual(["remotion", "remotion", "remotion", "remotion"]);
    expect(debug.map((d) => d.meta?.line)).toEqual([
      "Detected differing memory amounts:", "Memory reported by CGroup: 8796093017768.00 MB",
      `${TAG} UNMASKED_RENDERER_WEBGL=ANGLE (SwiftShader)`, `[${TAG}] GL_PROBE {"ok":false}`,
    ]);
  });
});
