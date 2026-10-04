// Test hygiene: every vitest project runs with TMPDIR = one per-run root that the global teardown removes
// (tests/support/tmp-root.*, wired by vitest.shared.ts); roots of dead runs are pruned at the next start.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, inject, it } from "vitest";
import { keepTestTmp, pruneStaleRunRoots, RUN_PREFIX } from "../../../tests/support/tmp-root.global";

describe("per-run test temp root", () => {
  it("os.tmpdir() of this worker is the run root, outside of which the shared generator cache stays", () => {
    const root = inject("docmakerTmpRoot");
    expect(os.tmpdir()).toBe(root);
    expect(path.basename(root)).toMatch(new RegExp(`^${RUN_PREFIX}\\d+-`));
    expect(process.env.DOCMAKER_TEST_SHARED).toBeTruthy();
    expect(process.env.DOCMAKER_TEST_SHARED!.startsWith(root + path.sep)).toBe(false);
  });

  it("prunes only the roots of dead runs", () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "prune-"));
    try {
      for (const n of [`${RUN_PREFIX}111-aaaaaa`, `${RUN_PREFIX}222-bbbbbb`, "docmaker-home-cccccc", `${RUN_PREFIX}x-dddddd`]) mkdirSync(path.join(base, n, "sub"), { recursive: true });
      expect(pruneStaleRunRoots(base, (pid) => pid === 222)).toEqual([`${RUN_PREFIX}111-aaaaaa`]);
      expect(readdirSync(base).sort()).toEqual(["docmaker-home-cccccc", `${RUN_PREFIX}222-bbbbbb`, `${RUN_PREFIX}x-dddddd`]);
      expect(pruneStaleRunRoots(path.join(base, "missing"))).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("DOCMAKER_KEEP_TEST_TMP=1 / DOCMAKER_KEEP_E2E=1 keep the root for inspection", () => {
    expect(keepTestTmp({})).toBe(false);
    expect(keepTestTmp({ DOCMAKER_KEEP_TEST_TMP: "1" })).toBe(true);
    expect(keepTestTmp({ DOCMAKER_KEEP_E2E: "yes" })).toBe(true);
    expect(keepTestTmp({ DOCMAKER_KEEP_TEST_TMP: "0", DOCMAKER_KEEP_E2E: "" })).toBe(false);
  });
});
