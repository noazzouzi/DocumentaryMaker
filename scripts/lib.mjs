// scripts/lib.mjs — shared helpers for the check-*.mjs workspace gates (no dependencies).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [{ dir, rel, name, pkg }] for the root and every packages/* and apps/* workspace. */
export function workspaces() {
  const out = [{ dir: ROOT, rel: ".", name: "documentarymaker", pkg: readJson(path.join(ROOT, "package.json")) }];
  for (const group of ["packages", "apps"]) {
    const g = path.join(ROOT, group);
    if (!existsSync(g)) continue;
    for (const d of readdirSync(g).sort()) {
      const p = path.join(g, d, "package.json");
      if (!existsSync(p)) continue;
      const pkg = readJson(p);
      out.push({ dir: path.join(g, d), rel: `${group}/${d}`, name: pkg.name, pkg });
    }
  }
  return out;
}

export function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

export const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function allDeps(pkg) {
  const out = [];
  for (const f of DEP_FIELDS) for (const [name, spec] of Object.entries(pkg[f] ?? {})) out.push({ field: f, name, spec });
  return out;
}

/** Source files (ts/tsx/js/mjs) under dir, skipping node_modules, .next, dist. */
export function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === ".next" || f === "dist" || f.startsWith(".")) continue;
    const p = path.join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|mts|js|mjs|jsx)$/.test(f) && !f.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:^|[^\w.$])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
/** Module specifiers imported by a file (static, dynamic with a literal, require). Comments are stripped first. */
export function importsOf(file, o = {}) {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    if (o.valuesOnly && /^\W?(?:import|export)\s+type\s/.test(m[0])) continue; // erased at runtime
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out.filter(Boolean);
}

export const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel", "dns",
  "domain", "events", "fs", "fs/promises", "http", "http2", "https", "inspector", "module", "net", "os", "path", "path/posix", "path/win32",
  "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "stream/promises", "string_decoder", "timers",
  "timers/promises", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);
export const isNodeBuiltin = (s) => s.startsWith("node:") || NODE_BUILTINS.has(s);

/** Package name of a bare specifier ("@a/b/c" → "@a/b", "x/y" → "x"). */
export function packageOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function fail(title, problems) {
  if (problems.length === 0) return false;
  console.error(`✗ ${title}`);
  for (const p of problems) console.error(`  - ${p}`);
  return true;
}
