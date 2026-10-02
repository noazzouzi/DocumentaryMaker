// Debug dump (DIRECTOR_DEBUG=1): writes timelines, stats and lint of the test scenarios to $DIRECTOR_DEBUG_DIR.
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { stableStringify } from "@docmaker/core";
import { direct } from "../src/index";
import { buildInputs } from "./fixtures";
import { richScenario } from "./rich";
import { policyScenario } from "./scenario";
import { tulipInputs } from "./tulip";

it.skipIf(!process.env.DIRECTOR_DEBUG)("debug dump (DIRECTOR_DEBUG=1)", () => {
  const OUT = process.env.DIRECTOR_DEBUG_DIR ?? ".";
  const log: string[] = [];
  const sc = richScenario();
  const b = buildInputs({ script: sc.script, plans: sc.plans, slices: sc.slices, take: sc.take, frozen: sc.frozen, clips: sc.clips });
  const runs: [string, ReturnType<typeof direct>][] = [["rich", direct(b.input)], ["policy", direct(policyScenario().input)], ["tulip", direct(tulipInputs().input)]];
  for (const [name, out] of runs) {
    log.push(`== ${name}`, JSON.stringify(out.stats, null, 1));
    log.push(...out.lint.map((l) => `${l.level} ${l.rule} ${l.where} ${l.msg}`));
    writeFileSync(`${OUT}/${name}.json`, stableStringify(out.timeline, 1));
  }
  log.push(JSON.stringify((globalThis as unknown as { __sfxdbg?: unknown }).__sfxdbg));
  writeFileSync(`${OUT}/log.txt`, log.join("\n"));
});
