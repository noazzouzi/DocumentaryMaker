import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENT_META, Timeline, type StylePlugin } from "@docmaker/core";
import { builtinStylesDir, listStyleDirs, loadStyleDir } from "@docmaker/styles";
import { direct } from "../src/index";
import { renderTokensOf } from "./fixtures";
import { errorsOf } from "./helpers";
import { policyScenario } from "./scenario";
import { tulipInputs } from "./tulip";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

describe("built-in styles (loaded with @docmaker/styles, deep-frozen inputs)", async () => {
  const dirs = await listStyleDirs(builtinStylesDir(repoRoot));
  const styles: StylePlugin[] = await Promise.all(dirs.map((d) => loadStyleDir(d, "builtin")));

  it("finds the drama-commentary style", () => {
    expect(styles.map((s) => s.data.manifest.id)).toContain("drama-commentary");
  });

  for (const st of styles) {
    it(`directs the tulip-mania fixture and a policy programme with ${st.data.manifest.id}`, () => {
      for (const make of [() => tulipInputs().input, () => policyScenario({ seconds: 300, chapters: 3 }).input]) {
        const input = make();
        const captionsVariant = st.data.captionDNA.variant;
        const frozenInput = deepFreeze({
          ...input, style: st.data,
          renderTokens: { ...renderTokensOf(st.data), captionDNA: { ...st.data.captionDNA, variant: captionsVariant } },
          project: { ...input.project, captions: st.data.captionDNA.defaultMode },
        });
        const out = direct(frozenInput);
        expect(() => Timeline.parse(out.timeline)).not.toThrow();
        expect(errorsOf(out), st.data.manifest.id).toEqual([]);
        expect(out.timeline.styleId).toBe(st.data.manifest.id);
        // overshoot components (Stamp) only where the style allows them
        for (const o of out.timeline.overlays) if (COMPONENT_META[o.component].overshootAllowed) expect(st.data.motion.overshootAllowedIn).toContain(o.component);
      }
    });
  }
});
