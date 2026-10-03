// Test homes share the content-addressed, lock-guarded generator caches (procedural SFX pack, procedural music beds) and
// the lock directory that guards them: a fresh DOCMAKER_HOME per suite otherwise re-synthesises the identical SFX pack and
// music beds every time (~30 s of CPU per home). Everything else in the home (frozen cache, config, models) stays private.
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SHARED_TEST_DIRS = ["sfx", "music", "locks"] as const;
export const sharedTestRoot = (): string => process.env.DOCMAKER_TEST_SHARED ?? path.join(os.tmpdir(), "docmaker-test-shared");

/** Creates `home` with sfx/, music/ and locks/ linked to the shared test directories. Returns `home`. */
export function shareTestCaches(home: string): string {
  mkdirSync(home, { recursive: true });
  for (const name of SHARED_TEST_DIRS) {
    const target = path.join(sharedTestRoot(), name);
    mkdirSync(target, { recursive: true });
    const link = path.join(home, name);
    if (!existsSync(link)) symlinkSync(target, link, "dir");
  }
  return home;
}
