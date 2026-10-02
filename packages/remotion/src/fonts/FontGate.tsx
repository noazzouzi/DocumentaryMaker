// FontGate (§10.10): delayRender("fonts") until document.fonts.load('<style> <w> 64px "<family>"', FONT_TEST_STRING)
// resolved for every registered family × weight (+ style fonts, M2). Children (and therefore measureText/fitText) never
// render before that. A face that is still unavailable afterwards is reported as "[fonts] fallback: …" on the console.
// One of the four files allowed to hold React state (eslint.determinism.js).
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { FONT_TEST_STRING, type StyleRenderTokens } from "@docmaker/core";
import { fontFaces } from "./registry";
import { loadStyleFonts } from "./styleFonts";

let builtinPromise: Promise<void> | null = null;

/** Loads every builtin face once per tab; warns about faces that fall back. */
export function loadBuiltinFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return Promise.resolve();
  if (!builtinPromise) {
    const faces = fontFaces();
    builtinPromise = Promise.all(
      faces.map(async (f) => {
        const spec = `${f.style === "italic" ? "italic " : ""}${f.weight} 64px "${f.family}"`;
        try {
          const got = await document.fonts.load(spec, FONT_TEST_STRING);
          if (got.length === 0 || !document.fonts.check(spec, FONT_TEST_STRING)) console.warn(`[fonts] fallback: ${spec}`);
        } catch (e) {
          console.warn(`[fonts] fallback: ${spec} (${e instanceof Error ? e.message : String(e)})`);
        }
      }),
    ).then(() => undefined);
  }
  return builtinPromise;
}

export const FontGate: React.FC<{ children: React.ReactNode; styleFonts?: StyleRenderTokens["fonts"]; base?: string }> = ({ children, styleFonts, base }) => {
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("fonts", { timeoutInMilliseconds: 60_000 }));
  const released = useRef(false);
  const fontsKey = JSON.stringify(styleFonts ?? []);
  useEffect(() => {
    let alive = true;
    const release = () => {
      if (!released.current) {
        released.current = true;
        continueRender(handle);
      }
    };
    Promise.all([loadBuiltinFonts(), styleFonts && styleFonts.length ? loadStyleFonts(styleFonts, base ?? "") : Promise.resolve()])
      .catch((e: unknown) => console.warn(`[fonts] ${e instanceof Error ? e.message : String(e)}`))
      .then(() => {
        if (alive) setReady(true);
        release();
      });
    return () => {
      alive = false;
      release();
    };
  }, [handle, fontsKey, base]); // fontsKey captures styleFonts by value
  return ready ? <>{children}</> : null;
};
