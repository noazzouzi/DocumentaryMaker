// French typography autofix (lint rule fr-typography; displayText only). Idempotent.
const NNBSP = " ";

/** « » with U+202F inside; `;:!?` preceded by U+202F; straight apostrophes → ’; "…" pairs → « … ». */
export function applyFrTypography(text: string): string {
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
