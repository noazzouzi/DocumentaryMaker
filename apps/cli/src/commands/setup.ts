// docmaker setup (§12.7, §15.1): idempotent downloads/installs. The browser goes through @docmaker/render; every other
// component through the engine (its packages own the install logic).
import type { CliContext } from "../context";
import { UsageError } from "../context";
import { EXIT } from "../jobrun";
import { ensureHome, runtimeOf } from "./core";

export async function runSetup(ctx: CliContext, o: Record<string, unknown>): Promise<number> {
  const all = o.all === true;
  const wanted: { what: string; arg: string | null }[] = [];
  if (all || o.browser) wanted.push({ what: "browser", arg: null });
  if (all || o.sfx !== undefined) wanted.push({ what: "sfx", arg: typeof o.sfx === "string" ? o.sfx : "procedural" });
  if (o.tts !== undefined) wanted.push({ what: "tts", arg: String(o.tts) });
  if (all || o.python) wanted.push({ what: "python", arg: null });
  if (all || o.ytDlp) wanted.push({ what: "yt-dlp", arg: null });
  if (o.whisper !== undefined) wanted.push({ what: "whisper", arg: String(o.whisper) });
  if (o.clip) wanted.push({ what: "clip", arg: null });
  if (wanted.length === 0) throw new UsageError("nothing to set up: pass --all or one of --browser, --sfx, --tts, --python, --yt-dlp, --whisper, --clip");
  const signal = new AbortController().signal;
  let failed = 0;
  for (const w of wanted) {
    try {
      if (w.what === "browser") {
        const { config } = runtimeOf(ctx);
        await ensureHome(config);
        const { ensureBrowserExecutable } = await import("@docmaker/render");
        const exe = await ensureBrowserExecutable(config, { download: true, signal });
        ctx.io.out(`[ok] browser: ${exe}\n`);
        continue;
      }
      const engine = await ctx.engine();
      const msg = await engine.setupComponent(w.what as never, w.arg, { signal, progress: (pct, m) => ctx.io.isTTY && ctx.io.out(`\r  ${Math.round(pct * 100)}% ${m}`.padEnd(80) + "\r") });
      ctx.io.out(`[ok] ${w.what}${w.arg ? ` ${w.arg}` : ""}: ${msg}\n`);
    } catch (e) {
      failed++;
      const err = e as { code?: string; message?: string; hint?: string | null };
      ctx.io.err(`[fail] ${w.what}${w.arg ? ` ${w.arg}` : ""}: ${err.code ? err.code + ": " : ""}${err.message ?? String(e)}${err.hint ? `\n       hint: ${err.hint}` : ""}\n`);
    }
  }
  return failed ? EXIT.error : EXIT.ok;
}
