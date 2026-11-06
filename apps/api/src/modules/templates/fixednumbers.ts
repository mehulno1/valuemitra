// C1: a format made from a filled report must not keep the earlier case's figures as fixed text. After
// compiling, every number that looks like a case value (a date, an amount, an area, a long reference
// number) left outside a field is listed; publishing waits until the admin maps it or marks it fixed.
import { CLOSE, OPEN } from './compile.js';
import { els, openDocx, textOf } from './docx.js';

export interface FixedNumber { value: string; context: string }

const ACT_YEAR = /(act|rules|regulations|handbook|standards|code|section|of|ivs|companies)[\s,.()0-9-]{0,12}$/i;

/** Case-like figures left as fixed text in a compiled format, each once, with the words around it. */
export function fixedNumbers(compiled: Buffer): FixedNumber[] {
  const { doc } = openDocx(compiled);
  const out = new Map<string, FixedNumber>();
  const tagRe = new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}`, 'g');
  for (const p of els(doc as any, 'w:p')) {
    if (els(p, 'w:p').length) continue; // text of nested paragraphs is read on its own
    const text = textOf(p).replace(tagRe, ' ').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
    if (!/\d/.test(text)) continue;
    const re = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:sq\.?\s*(?:ft|m|mtr)|kms?\b)|\b\d{4,}\b/gi;
    for (const m of text.matchAll(re)) {
      const v = m[0];
      const before = text.slice(Math.max(0, m.index! - 30), m.index!);
      // statute years ("Income-tax Act, 1961", "Rules, 2017") are bank wording, not case values
      if (/^(19[5-9]\d|20[0-3]\d)$/.test(v) && ACT_YEAR.test(before)) continue;
      if (out.has(v)) continue;
      out.set(v, { value: v, context: text.slice(Math.max(0, m.index! - 60), m.index! + v.length + 40) });
    }
  }
  return [...out.values()];
}
