// French typography autofix (lint rule fr-typography; displayText only). Idempotent.
const NNBSP = " ";

/** URLs and e-mail addresses are never retouched (a query string's `?`, `;`, `!`, `:` must stay as is). */
const PROTECTED = /\b(?:https?:\/\/|www\.)[^\s«»"]+[^\s«»".,;:!?)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;

/** « » with U+202F inside; `;:!?` preceded by U+202F; straight apostrophes → ’; "…" pairs → « … ». */
export function applyFrTypography(text: string): string {
  const kept: string[] = [];
  // placeholders are private-use characters (not letters, not punctuation the rules look at)
  const shielded = text.replace(PROTECTED, (m) => `\uE000${String.fromCharCode(0xe100 + kept.push(m) - 1)}\uE001`);
  return frRules(shielded).replace(/\uE000([\uE100-\uF8FF])\uE001/gu, (_m, c: string) => kept[c.charCodeAt(0) - 0xe100] ?? "");
}

function frRules(text: string): string {
  let t = text;
  // apostrophes between letters (l'acteur, aujourd'hui) → ’
  t = t.replace(/(?<=\p{L})'(?=\p{L})/gu, "’");
  // straight double-quote pairs → guillemets
  t = t.replace(/"([^"\n]+)"/g, (_m, inner: string) => `«${NNBSP}${inner.trim()}${NNBSP}»`);
  // guillemets spacing
  t = t.replace(/«[\s  ]*/g, `«${NNBSP}`).replace(/[\s  ]*»/g, `${NNBSP}»`);
  // ; ! ? preceded by a narrow no-break space (not inside "?!" runs)
  t = t.replace(/(?<=[^\s;:!?«])[   ]*([;!?])/g, `${NNBSP}$1`);
  // ':' likewise, except times/ratios (12:30) and URLs (https://)
  t = t.replace(/(?<=[^\s;:!?«])[   ]*:(?!\/\/)/g, (m, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? "";
    const after = whole[offset + m.length] ?? "";
    if (m === ":" && /\d/.test(before) && /\d/.test(after)) return m;
    return `${NNBSP}:`;
  });
  return t;
}
