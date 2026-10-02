import { it } from "vitest";
import { writeFileSync } from "node:fs";
const OUT = "/tmp/claude-0/-home-user-DocumentaryMaker/9b2bcdc3-66da-5e55-a3e5-b80d3978051f/scratchpad/w6/";
const log: string[] = [];
import { stableStringify } from "@docmaker/core";
import { makeScenario } from "@docmaker/core/testing";
import { direct } from "../src/index";
import { buildInputs } from "./fixtures";
import { richScenario } from "./layout.test";

it("smoke", () => {
  const sc = richScenario();
  const b = buildInputs({ script: sc.script, plans: sc.plans, slices: sc.slices, take: sc.take, frozen: sc.frozen, clips: sc.clips });
  const out = direct(b.input);
  log.push(JSON.stringify(out.stats, null, 1));
  log.push(out.lint.map((l) => `${l.level} ${l.rule} ${l.where} ${l.msg}`).join("\n"));
  const s = makeScenario({ seconds: 600, withReveal: true, withClip: true, withBreath: true });
  const b2 = buildInputs({ script: s.script, plans: s.plans, slices: s.slices, take: s.take });
  const out2 = direct(b2.input);
  log.push(JSON.stringify(out2.stats, null, 1));
  log.push(out2.lint.map((l) => `${l.level} ${l.rule} ${l.where} ${l.msg}`).join("\n"));
  writeFileSync(OUT + "tl1.json", stableStringify(out.timeline, 1));
  writeFileSync(OUT + "tl2.json", stableStringify(out2.timeline, 1));
  writeFileSync(OUT + "log.txt", log.join("\n"));
});
