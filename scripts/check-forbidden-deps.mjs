// Fails on forbidden dependencies (SPEC §2.3): declared anywhere, imported by our sources, or (for the hard bans)
// present transitively in pnpm-lock.yaml.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, allDeps, fail, importsOf, packageOf, sourceFiles, workspaces } from "./lib.mjs";

/** name → reason. Hard bans are also refused transitively. */
const FORBIDDEN = {
  gsap: ["licence clause", true], "@remotion/gsap": ["licence clause", true], p5: ["LGPL", true],
  "@remotion/google-fonts": ["proxy failures; fonts are self-hosted", true], "@remotion/light-leaks": ["dropped in Remotion 5.0", true],
  "kokoro-js": ["FR truncation bug", true], "youtubei.js": ["transcripts return 400", true], "@imgly/background-removal": ["AGPL", true],
  "@huggingface/transformers": ["300 MB + GPU postinstall; installed into <home>/ml on demand only", true],
  "onnxruntime-node": ["300 MB + GPU postinstall", true], hyperframes: ["the HyperFrames CLI is never used", true],
  pexels: ["stale package", false], elevenlabs: ["legacy SDK; use @elevenlabs/elevenlabs-js", false], dotenv: ["core parses env files", false],
  mediabunny: ["ffprobe suffices", false], whisperx: ["not used", false],
};
const isForbidden = (name) => Object.hasOwn(FORBIDDEN, name) || name.startsWith("@hyperframes/");
const problems = [];

for (const ws of workspaces()) {
  for (const d of allDeps(ws.pkg)) if (isForbidden(d.name)) problems.push(`${ws.rel}: ${d.field}.${d.name} — ${FORBIDDEN[d.name]?.[0] ?? "HyperFrames"}`);
  for (const sub of ["src", "test", "test-int", "bin", "scripts", "hero"]) {
    for (const f of sourceFiles(path.join(ws.dir, sub))) {
      for (const s of importsOf(f)) {
        if (s.startsWith(".") || s.startsWith("node:")) continue;
        if (isForbidden(packageOf(s))) problems.push(`${path.relative(ROOT, f)} imports ${s}`);
      }
    }
  }
}
for (const dir of ["scripts", "tests"]) {
  for (const f of sourceFiles(path.join(ROOT, dir))) for (const s of importsOf(f)) if (!s.startsWith(".") && isForbidden(packageOf(s))) problems.push(`${path.relative(ROOT, f)} imports ${s}`);
}
const lock = readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
for (const m of lock.matchAll(/^ {2}'?((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@[^:\s]+:/gm)) {
  const name = m[1];
  if ((FORBIDDEN[name]?.[1] ?? false) || name.startsWith("@hyperframes/")) problems.push(`pnpm-lock.yaml contains ${name} (transitively) — ${FORBIDDEN[name]?.[0] ?? "HyperFrames"}`);
}
if (fail("forbidden dependencies", [...new Set(problems)])) process.exit(1);
console.log(`✓ forbidden dependencies: none of ${Object.keys(FORBIDDEN).length} banned packages declared, imported or locked`);
