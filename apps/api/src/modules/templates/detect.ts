// Step 2 of the template engine: find every place a value goes. Three kinds of slot:
//   cell         a label cell followed by an empty / sample value cell in a table row
//   grid         a value cell under a column header in a row with a row label ("Rate" for "Car parking")
//   placeholder  {{FIELD.CODE}} typed into running text
//   inline       "Label : ________" blanks in running text
import { clean, inTable, mergeRuns, openDocx, paragraphs, tables, textOf } from './docx.js';

export interface Slot {
  key: string;
  kind: 'cell' | 'grid' | 'placeholder' | 'inline';
  label: string;
  context: string | null;
  sample: string | null;
  location: { t?: number; r?: number; c?: number; p?: number; find?: string };
  explicitCode?: string;
}

const isNumbering = (s: string) => /^(\(?[0-9ivxlcIVXLC]{1,5}[.)]?|[a-zA-Z][.)]|sr\.? ?no\.?|s\.? ?no\.?)$/i.test(s.trim());
const isBlank = (s: string) => s.trim() === '' || /^[\s:._\-–—]*$/.test(s);
const hasWords = (s: string) => /[A-Za-zऀ-ॿ]{2,}/.test(s);

export function detectSlots(buf: Buffer): { slots: Slot[]; stats: { tables: number; paragraphs: number } } {
  const { doc } = openDocx(buf);
  const slots: Slot[] = [];
  const tbls = tables(doc);

  tbls.forEach((tbl, ti) => {
    let context: string | null = null;
    let header: string[] | null = null;
    tbl.rows.forEach((cells, ri) => {
      const texts = cells.map((c) => clean(textOf(c)));
      const nonEmpty = texts.filter((x) => !isBlank(x));
      // section header row: a single meaningful text (often numbered), nothing to fill
      const meaningful = texts.filter((x) => !isBlank(x) && !isNumbering(x));
      if (meaningful.length === 1 && cells.length <= 3 && texts.every((x, i) => isBlank(x) || isNumbering(x) || x === meaningful[0]) && !hasBlankAfter(texts, meaningful[0])) {
        context = meaningful[0];
        header = null;
        return;
      }
      // a header row: every cell has words, 3+ columns
      if (cells.length >= 3 && nonEmpty.length === cells.length && texts.every(hasWords) && !texts.some(isNumbering)) {
        header = texts;
        return;
      }
      // grid rows: row label then 2+ value cells under a header
      const firstLabelIdx = texts.findIndex((x) => hasWords(x) && !isNumbering(x));
      if (header && firstLabelIdx >= 0) {
        const valueCells = texts.map((x, i) => ({ x, i })).filter((v) => v.i > firstLabelIdx);
        if (valueCells.length >= 2) {
          for (const v of valueCells) {
            const col = header[v.i];
            if (!col) continue;
            slots.push({
              key: `t${ti}r${ri}c${v.i}`, kind: 'grid', label: `${texts[firstLabelIdx]} | ${col}`, context,
              sample: isBlank(v.x) ? null : v.x, location: { t: ti, r: ri, c: v.i },
            });
          }
          return;
        }
      }
      // label / value pairs along the row
      for (let i = 0; i < cells.length; i++) {
        const x = texts[i];
        if (!hasWords(x) || isNumbering(x)) continue;
        if (/\{\{[A-Z][A-Z0-9_.]+\}\}/.test(x)) continue; // handled as placeholder
        const j = i + 1;
        if (j >= cells.length) continue;
        const v = texts[j];
        if (isNumbering(v)) continue;
        // the next cell must look like a value: blank, or sample text when it is the row's last cell
        const nextIsLabelPair = j + 1 < cells.length && isBlank(texts[j + 1]) && hasWords(v);
        if (!isBlank(v) && nextIsLabelPair) continue;
        slots.push({
          key: `t${ti}r${ri}c${j}`, kind: 'cell', label: x.replace(/[:\s]+$/, ''), context,
          sample: isBlank(v) ? null : v, location: { t: ti, r: ri, c: j },
        });
        i = j; // skip the value cell
      }
    });
  });

  const ps = paragraphs(doc);
  ps.forEach((p, pi) => {
    const raw = textOf(p);
    if (raw.includes('{{')) {
      mergeRuns(p);
      for (const m of textOf(p).matchAll(/\{\{\s*([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)\s*\}\}/g)) {
        slots.push({
          key: `p${pi}x${m.index}`, kind: 'placeholder', label: m[1], context: clean(raw).slice(0, 160), sample: null,
          location: { p: pi, find: m[0] }, explicitCode: m[1],
        });
      }
      return;
    }
    if (inTable(p)) return;
    const m = raw.match(/^(.{3,120}?)\s*[:：]?\s*(_{4,}|\.{5,})\s*$/);
    if (m && hasWords(m[1])) {
      slots.push({ key: `p${pi}u`, kind: 'inline', label: clean(m[1]).replace(/[:\s]+$/, ''), context: null, sample: null, location: { p: pi, find: m[2] } });
    }
  });

  return { slots, stats: { tables: tbls.length, paragraphs: ps.length } };
}

function hasBlankAfter(texts: string[], label: string) {
  const i = texts.indexOf(label);
  return i >= 0 && i + 1 < texts.length && isBlank(texts[i + 1]);
}
