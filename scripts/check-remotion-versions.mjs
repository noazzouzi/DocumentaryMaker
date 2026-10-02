// Fails when any remotion / @remotion/* version (declared or locked) differs from the pinned 4.0.532 (SPEC §2.3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, allDeps, fail, workspaces } from "./lib.mjs";

const PIN = "4.0.532";
const isRemotion = (n) => n === "remotion" || n.startsWith("@remotion/");
const problems = [];
for (const ws of workspaces()) {
  for (const d of allDeps(ws.pkg)) {
    if (isRemotion(d.name) && d.spec !== PIN) problems.push(`${ws.rel}: ${d.field}.${d.name} = "${d.spec}" (want "${PIN}")`);
  }
}
const lock = readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
const locked = new Set();
for (const m of lock.matchAll(/^ {2}'?((?:@remotion\/[a-z0-9-]+)|remotion)@([^:'(\s]+)/gm)) {
  locked.add(`${m[1]}@${m[2]}`);
  if (m[2] !== PIN) problems.push(`pnpm-lock.yaml: ${m[1]}@${m[2]} (want ${PIN})`);
}
if (fail("remotion versions", [...new Set(problems)])) process.exit(1);
console.log(`✓ remotion versions: ${locked.size} locked remotion packages, all ${PIN}`);
