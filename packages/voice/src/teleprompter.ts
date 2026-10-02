// teleprompterHtml (§8.7): a self-contained page (no network) to read the script aloud: large type, segment ids as
// anchors, the tts text, devices as stage directions, auto-scroll at the calibrated chars/second, mirror toggle,
// out-of-date segments flagged.
import type { Device, Lang, Script } from "@docmaker/core";
import { spokenText } from "@docmaker/core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const UI: Record<Lang, Record<string, string>> = {
  en: {
    title: "Teleprompter", help: "Space: play/pause · ↑/↓: speed · M: mirror · R: restart · click a segment to jump", outdated: "edited after the take — re-record",
    clip: "CLIP PLAYS", breath: "MUSIC BREATH", sponsor: "SPONSOR SLOT", speed: "speed",
  },
  fr: {
    title: "Prompteur", help: "Espace : lecture/pause · ↑/↓ : vitesse · M : miroir · R : début · clic sur un segment pour y aller", outdated: "modifié après la prise — à réenregistrer",
    clip: "EXTRAIT", breath: "RESPIRATION MUSICALE", sponsor: "SPONSOR", speed: "vitesse",
  },
};

const DEVICE_HINT: Record<Lang, Partial<Record<Device, string>>> = {
  en: {
    open_loop: "open the question — lean in", re_hook: "re-hook — energy up", pattern_interrupt: "break the rhythm",
    callback: "callback — knowing tone", cliffhanger: "cliffhanger — slow down, hold the last word", punchline: "punchline — beat before the last words",
    rhetorical_question: "rhetorical question — let it hang", reveal: "reveal — pause, then deliver", payoff: "payoff — land it",
  },
  fr: {
    open_loop: "ouvrir la question — se pencher", re_hook: "relance — plus d'énergie", pattern_interrupt: "casser le rythme",
    callback: "rappel — ton complice", cliffhanger: "suspense — ralentir, tenir le dernier mot", punchline: "chute — un temps avant la fin",
    rhetorical_question: "question rhétorique — laisser en suspens", reveal: "révélation — pause, puis asséner", payoff: "résolution — conclure net",
  },
};

export function teleprompterHtml(script: Script, o: { cps: number; mirror: boolean; lang: Lang; outdated?: string[] }): string {
  const ui = UI[o.lang];
  const outdated = new Set(o.outdated ?? []);
  const cps = o.cps > 0 ? o.cps : 15;
  const body: string[] = [];
  for (const ch of script.chapters) {
    body.push(`<h2 class="chapter" id="${esc(ch.chapterId)}">${esc(ch.chapterId)} · ${esc(ch.title)}</h2>`);
    for (const seg of ch.segments) {
      if (seg.type === "narration") {
        const text = seg.ttsText.trim() || spokenText(seg, "vo");
        const hint = DEVICE_HINT[o.lang][seg.device];
        const flag = outdated.has(seg.id);
        body.push(
          `<section class="seg${flag ? " outdated" : ""}" id="${esc(seg.id)}" data-chars="${[...text].length}">` +
          `<div class="meta"><a href="#${esc(seg.id)}">${esc(seg.id)}</a>${hint ? ` <span class="dir">[${esc(hint)}]</span>` : ""}${flag ? ` <span class="flag">${esc(ui.outdated!)}</span>` : ""}</div>` +
          `<p>${esc(text)}</p></section>`,
        );
      } else {
        const label = seg.type === "clip" ? ui.clip : seg.type === "music_breath" ? ui.breath : ui.sponsor;
        const quote = seg.type === "clip" ? ` — «&nbsp;${esc(seg.subtitleTranslation || seg.displayText)}&nbsp;»` : "";
        body.push(`<section class="seg cue" id="${esc(seg.id)}" data-chars="0"><div class="meta">${esc(seg.id)}</div><p class="dir">[${esc(label!)}${quote}]</p></section>`);
      }
    }
  }
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ui.title!)} — ${esc(script.title)}</title>
<style>
:root { --bg: #0b0b0c; --fg: #f4f1ea; --dim: #8a8780; --accent: #ffcf3f; --warn: #ff6b5b; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
#stage { padding: 45vh 8vw 60vh; font-size: clamp(32px, 4.2vw, 64px); line-height: 1.45; }
body.mirror #stage { transform: scaleX(-1); }
.chapter { font-size: 0.55em; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; margin: 2.5em 0 0.6em; }
.seg { margin: 0 0 1.1em; scroll-margin-top: 30vh; }
.seg p { margin: 0.1em 0 0; }
.meta { font-size: 0.32em; color: var(--dim); font-family: ui-monospace, monospace; }
.meta a { color: inherit; text-decoration: none; }
.dir { color: var(--accent); font-style: italic; }
.cue p { font-size: 0.6em; }
.outdated p { color: var(--warn); }
.flag { color: var(--warn); font-weight: 700; }
#line { position: fixed; left: 0; right: 0; top: 30vh; height: 0; border-top: 2px solid rgba(255, 207, 63, 0.45); pointer-events: none; }
#hud { position: fixed; bottom: 12px; left: 12px; right: 12px; font: 14px ui-monospace, monospace; color: var(--dim); display: flex; justify-content: space-between; }
</style>
</head>
<body class="${o.mirror ? "mirror" : ""}">
<div id="line"></div>
<main id="stage">
<h1>${esc(script.title)}</h1>
${body.join("\n")}
</main>
<div id="hud"><span>${esc(ui.help!)}</span><span id="state"></span></div>
<script>
(() => {
  const CPS = ${JSON.stringify(cps)};
  let speed = 1, playing = false, last = 0, carry = 0;
  const segs = Array.from(document.querySelectorAll(".seg"));
  const state = document.getElementById("state");
  const show = () => { state.textContent = (playing ? "▶ " : "❚❚ ") + "${esc(ui.speed!)} " + Math.round(speed * 100) + "% · " + CPS + " cps"; };
  const current = () => {
    const y = window.innerHeight * 0.3;
    return segs.find((s) => { const r = s.getBoundingClientRect(); return r.top <= y && r.bottom > y; }) || null;
  };
  const tick = (t) => {
    if (!playing) return;
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    const s = current();
    const chars = s ? Number(s.dataset.chars || 0) : 0;
    // a segment's height scrolls past the reading line in chars / cps seconds; cues pass in 2 s
    const secs = chars > 0 ? chars / CPS : 2;
    const pxPerSec = s ? s.getBoundingClientRect().height / secs : 80;
    carry += pxPerSec * dt * speed;
    const whole = Math.floor(carry);
    if (whole) { window.scrollBy(0, whole); carry -= whole; }
    requestAnimationFrame(tick);
  };
  const toggle = () => { playing = !playing; last = 0; show(); if (playing) requestAnimationFrame(tick); };
  document.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowUp") { speed = Math.min(2, speed + 0.1); show(); }
    else if (e.key === "ArrowDown") { speed = Math.max(0.3, speed - 0.1); show(); }
    else if (e.key === "m" || e.key === "M") document.body.classList.toggle("mirror");
    else if (e.key === "r" || e.key === "R") window.scrollTo(0, 0);
  });
  segs.forEach((s) => s.addEventListener("click", () => s.scrollIntoView({ block: "start" })));
  show();
})();
</script>
</body>
</html>
`;
}
