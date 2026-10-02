// teleprompterHtml (§8.7) — M2.
import type { Lang, Script } from "@docmaker/core";
import { notImplemented } from "./notImplemented";
export function teleprompterHtml(_script: Script, _o: { cps: number; mirror: boolean; lang: Lang; outdated?: string[] }): string {
  throw notImplemented("voice.teleprompterHtml");
}
