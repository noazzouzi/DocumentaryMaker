// Fails when a workspace imports (or depends on) a workspace package outside its SPEC §3.2 edges, when apps/web or
// the engine import what they must not, or when node:* / Node built-ins are reachable from a browser entry
// (packages/remotion/src/entry.ts, @docmaker/core ".", "./testing", apps/web client components).
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT, allDeps, fail, importsOf, isNodeBuiltin, packageOf, sourceFiles, workspaces } from "./lib.mjs";

/** §3.2 — allowed @docmaker/* imports from src/ (prod) and additionally from test/ (dev). */
const EDGES = {
  "@docmaker/core": { src: [], dev: [] },
  "@docmaker/styles": { src: ["core"], dev: [] },
  "@docmaker/llm": { src: ["core", "styles"], dev: [] },
  "@docmaker/assets": { src: ["core"], dev: [] },
  "@docmaker/voice": { src: ["core"], dev: [] },
  "@docmaker/audio": { src: ["core"], dev: [] },
  "@docmaker/director": { src: ["core"], dev: ["styles"] },
  "@docmaker/remotion": { src: ["core"], dev: [] },
  "@docmaker/render": { src: ["core", "remotion"], dev: [] },
  "@docmaker/export": { src: ["core"], dev: [] },
  "@docmaker/engine": { src: ["core", "styles", "llm", "assets", "voice", "audio", "director", "export"], dev: ["remotion"] },
  "@docmaker/cli": { src: ["core", "engine", "render", "styles"], dev: [] },
  "@docmaker/web": { src: ["core", "engine", "styles", "remotion"], dev: [] },
};
/** Subpath restrictions (§3.2/§3.3). */
const SUBPATHS = {
  "@docmaker/render": { "@docmaker/remotion": ["", "/compute", "/entry"] },
  "@docmaker/web": { "@docmaker/remotion": ["", "/compute", "/fonts"] },
};
const NEVER = {
  "@docmaker/engine": ["@docmaker/render"],
  "@docmaker/web": ["@docmaker/render", "@remotion/bundler", "@remotion/renderer"],
  "@docmaker/remotion": ["@docmaker/core/node"],
};

const problems = [];
const wss = workspaces();
const byName = new Map(wss.map((w) => [w.name, w]));

// 1. declared workspace dependencies ⊆ edges
for (const ws of wss) {
  const e = EDGES[ws.name];
  if (!e) continue;
  for (const d of allDeps(ws.pkg)) {
    if (!d.name.startsWith("@docmaker/")) continue;
    const short = d.name.slice("@docmaker/".length);
    const ok = d.field === "devDependencies" ? e.src.includes(short) || e.dev.includes(short) : e.src.includes(short);
    if (!ok) problems.push(`${ws.rel}/package.json: ${d.field}.${d.name} is not an allowed edge`);
  }
}

// 2. imports ⊆ edges; never-imports; subpaths
for (const ws of wss) {
  const e = EDGES[ws.name];
  if (!e) continue;
  for (const [sub, dev] of [["src", false], ["bin", false], ["test", true], ["test-int", true]]) {
    for (const f of sourceFiles(path.join(ws.dir, sub))) {
      for (const s of importsOf(f)) {
        const rel = path.relative(ROOT, f);
        const pkgName = packageOf(s);
        if ((NEVER[ws.name] ?? []).some((n) => s === n || s.startsWith(n + "/"))) problems.push(`${rel} imports ${s} (forbidden for ${ws.name})`);
        if (!pkgName.startsWith("@docmaker/")) continue;
        if (pkgName === ws.name) { problems.push(`${rel} imports its own package by name (${s}); use relative paths`); continue; }
        const short = pkgName.slice("@docmaker/".length);
        const ok = e.src.includes(short) || (dev && e.dev.includes(short)) || (dev && pkgName === "@docmaker/core");
        if (!ok) problems.push(`${rel} imports ${s} — not a §3.2 edge of ${ws.name}`);
        const allowedSubs = SUBPATHS[ws.name]?.[pkgName];
        if (allowedSubs && !allowedSubs.includes(s.slice(pkgName.length))) problems.push(`${rel} imports ${s} — ${ws.name} may use only ${allowedSubs.map((x) => pkgName + x).join(", ")}`);
      }
    }
  }
}

// 3. browser entries: no node:* / built-ins reachable (walk relative + @docmaker/* imports through exports maps)
function resolveWorkspace(spec) {
  const name = packageOf(spec);
  const ws = byName.get(name);
  if (!ws) return null;
  const sub = "." + spec.slice(name.length);
  const target = ws.pkg.exports?.[sub];
  return typeof target === "string" ? path.join(ws.dir, target) : null;
}
function resolveRelative(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".ts", base + ".tsx", base + ".js", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
function walk(entry, label) {
  const seen = new Map(); // file → parent
  const stack = [[entry, null]];
  while (stack.length) {
    const [f, parent] = stack.pop();
    if (seen.has(f)) continue;
    seen.set(f, parent);
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    for (const s of importsOf(f, { valuesOnly: true })) {
      const chain = () => {
        const c = [];
        for (let x = f; x; x = seen.get(x)) c.unshift(path.relative(ROOT, x));
        return c.join(" → ");
      };
      if (isNodeBuiltin(s)) { problems.push(`${label}: ${s} reachable via ${chain()}`); continue; }
      if (s === "@docmaker/core/node" || s.startsWith("@docmaker/render") || s.startsWith("@remotion/bundler") || s.startsWith("@remotion/renderer")) {
        problems.push(`${label}: ${s} reachable via ${chain()}`);
        continue;
      }
      const next = s.startsWith(".") ? resolveRelative(f, s) : s.startsWith("@docmaker/") ? resolveWorkspace(s) : null;
      if (next) stack.push([next, f]);
    }
  }
  return seen.size;
}
const entries = [
  ["packages/remotion/src/entry.ts", "remotion entry"],
  ["packages/remotion/src/index.ts", "@docmaker/remotion"],
  ["packages/remotion/src/compute/index.ts", "@docmaker/remotion/compute"],
  ["packages/core/src/index.ts", "@docmaker/core"],
  ["packages/core/src/testing/index.ts", "@docmaker/core/testing"],
  ...sourceFiles(path.join(ROOT, "apps/web/src/components")).map((f) => [path.relative(ROOT, f), "web client component"]),
];
let walked = 0;
for (const [rel, label] of entries) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) { problems.push(`missing browser entry ${rel}`); continue; }
  walked += walk(abs, label);
}
if (fail("dependency graph", [...new Set(problems)])) process.exit(1);
console.log(`✓ dependency graph: ${wss.length} workspaces follow §3.2; ${entries.length} browser entries (${walked} files walked) reach no node:*`);
