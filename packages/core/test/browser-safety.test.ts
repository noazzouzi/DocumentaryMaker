// Fails if anything under packages/core/src (except src/node/) imports node:* or a bare Node built-in,
// and if the "." or "./testing" import graphs can reach src/node/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const BUILTINS = ["fs", "path", "child_process", "crypto", "os", "url", "util", "stream", "http", "https", "net", "zlib", "worker_threads", "events", "buffer", "process"];
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
function specifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]!).filter(Boolean);
}
function resolveRel(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch { /* next */ }
  }
  return null;
}

describe("browser safety of @docmaker/core", () => {
  const files = walk(SRC).filter((f) => !f.startsWith(path.join(SRC, "node") + path.sep));
  it("no node:* or bare built-in imports outside src/node/", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of specifiers(f)) {
        if (s.startsWith("node:") || BUILTINS.includes(s) || BUILTINS.some((b) => s.startsWith(b + "/"))) bad.push(`${path.relative(SRC, f)} → ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("only zod and relative paths are imported outside src/node/", () => {
    const bad: string[] = [];
    for (const f of files) for (const s of specifiers(f)) if (!s.startsWith(".") && s !== "zod") bad.push(`${path.relative(SRC, f)} → ${s}`);
    expect(bad).toEqual([]);
  });
  it('"." and "./testing" never reach src/node/', () => {
    for (const entry of ["index.ts", "testing/index.ts"]) {
      const seen = new Set<string>();
      const stack = [path.join(SRC, entry)];
      while (stack.length) {
        const f = stack.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        for (const s of specifiers(f)) {
          if (!s.startsWith(".")) continue;
          const r = resolveRel(f, s);
          if (r) stack.push(r);
        }
      }
      const reached = [...seen].filter((f) => f.startsWith(path.join(SRC, "node") + path.sep));
      expect(reached, entry).toEqual([]);
      expect(seen.size).toBeGreaterThan(10);
    }
  });
});
