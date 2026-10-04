// Vitest setupFile (see tmp-root.global.ts): points os.tmpdir() of this worker, and of every process it spawns, at the
// run's temp root; the shared generator cache keeps its real location.
import { mkdirSync } from "node:fs";
import { inject } from "vitest";

const root = inject("docmakerTmpRoot");
if (root) {
  mkdirSync(root, { recursive: true });
  process.env.TMPDIR = root;
  process.env.DOCMAKER_TEST_SHARED ??= inject("docmakerTestShared");
}
