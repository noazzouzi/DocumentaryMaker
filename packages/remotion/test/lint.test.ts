// Determinism lint (§10.9) and browser safety (§10.1): the ESLint config flags a bad fixture and passes every source
// file; no node:* / Node built-in / @docmaker/core/node is reachable from src/entry.ts (static import-graph walk).
import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import determinism from "../eslint.determinism.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repoRoot = path.resolve(pkgDir, "../..");

function makeEslint(): ESLint {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
      ...(determinism as ESLint.ConfigData[] as never[]),
    ],
  });
}

const BAD = `
import { readFileSync } from "node:fs";
import gsap from "gsap";
import { useState } from "react";
export const Bad = () => {
  const [n] = useState(Math.random());
  const t = Date.now() + performance.now() + new Date().getTime();
  setTimeout(() => undefined, 10);
  void fetch("/x");
  void readFileSync; void gsap;
  return <div style={{ transition: "all 1s", willChange: "transform" }}>{n + t}</div>;
};
`;

describe("eslint.determinism.js", () => {
  it("flags every banned construct in a fixture under src/", async () => {
    const eslint = makeEslint();
    const [res] = await eslint.lintText(BAD, { filePath: path.join(pkgDir, "src/__determinism_fixture__.tsx") });
    const byRule = new Map<string, number>();
    for (const m of res!.messages) byRule.set(m.ruleId ?? "fatal", (byRule.get(m.ruleId ?? "fatal") ?? 0) + 1);
    expect(byRule.get("fatal")).toBeUndefined();
    expect(byRule.get("no-restricted-properties")).toBe(3); // Math.random, Date.now, performance.now
    expect(byRule.get("no-restricted-globals")).toBe(1); // setTimeout
    expect(byRule.get("no-restricted-imports")).toBe(2); // node:fs, gsap
    // new Date(), useState, fetch, transition, willChange
    expect(byRule.get("no-restricted-syntax")).toBe(5);
  });

  it("allows state and fetch only in the four exempt files", async () => {
    const eslint = makeEslint();
    const code = `import { useState } from "react"; export const f = () => { const [a] = useState(0); void fetch("/t"); return a; };`;
    const [ok] = await eslint.lintText(code, { filePath: path.join(pkgDir, "src/data/useTimeline.ts") });
    expect(ok!.messages.filter((m) => m.ruleId === "no-restricted-syntax")).toEqual([]);
    const [bad] = await eslint.lintText(code, { filePath: path.join(pkgDir, "src/components/Other.ts") });
    expect(bad!.messages.filter((m) => m.ruleId === "no-restricted-syntax").length).toBe(2);
  });

  it("passes every source file", async () => {
    const eslint = makeEslint();
    const results = await eslint.lintFiles(["packages/remotion/src/**/*.{ts,tsx}"]);
    expect(results.length).toBeGreaterThan(40);
    const problems = results.flatMap((r) => r.messages.map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line} ${m.ruleId}: ${m.message}`));
    expect(problems).toEqual([]);
  }, 60_000);
});

// ------------------------------------------------------------------ import-graph walk
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const IMPORT_RE = /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function valueImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    if (m[1]) continue; // `import type … from` is erased at build time
    const spec = m[2] ?? m[3];
    if (spec) out.push(spec);
  }
  return out;
}
function resolveRel(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
const WORKSPACE: Record<string, string> = {
  "@docmaker/core": path.join(repoRoot, "packages/core/src/index.ts"),
};

describe("browser safety", () => {
  it("no node:*, Node built-in, @docmaker/core/node or test factories reachable from src/entry.ts", () => {
    const entry = path.join(pkgDir, "src/entry.ts");
    const seen = new Set<string>();
    const stack = [entry];
    const problems: string[] = [];
    const thirdParty = new Set<string>();
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
      for (const s of valueImports(f)) {
        const rel = path.relative(repoRoot, f);
        if (BUILTINS.has(s) || s.startsWith("node:")) problems.push(`${rel} → ${s}`);
        else if (s === "@docmaker/core/node" || s.startsWith("@docmaker/core/testing") || s.startsWith("@docmaker/render") || s.startsWith("@remotion/bundler") || s.startsWith("@remotion/renderer")) problems.push(`${rel} → ${s}`);
        else if (s.startsWith(".")) {
          const r = resolveRel(f, s);
          if (r) stack.push(r);
          else if (!s.endsWith(".css") && !s.endsWith(".json")) problems.push(`${rel} → unresolved ${s}`);
        } else if (WORKSPACE[s]) stack.push(WORKSPACE[s]!);
        else thirdParty.add(s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]!);
      }
    }
    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThan(60);
    // only browser-capable packages (§2.3 remotion deps)
    const allowed = new Set(["react", "remotion", "zod", "@remotion/media", "@remotion/transitions", "@remotion/noise", "@remotion/paths", "@remotion/layout-utils", "@remotion/fonts", "d3-geo", "topojson-client", "world-atlas", "@fontsource/anton", "@fontsource/archivo-black", "@fontsource/inter", "@fontsource/jetbrains-mono", "@fontsource/instrument-serif", "@fontsource/courier-prime", "@fontsource/special-elite"]);
    expect([...thirdParty].filter((p) => !allowed.has(p))).toEqual([]);
  });
});
