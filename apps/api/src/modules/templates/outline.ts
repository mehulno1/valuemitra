// The bank's Word file as the AI reads it: body paragraphs and table cells in document order, each
// with a stable id (p{n} = index in paragraphs(doc), t{t}r{r}c{c} = table cell), so the model can
// point at exactly where a value goes or which paragraphs to rewrite.
import type { Document as XDoc, Element as XEl } from '@xmldom/xmldom';
import { clean, els, paragraphs, tables, textOf } from './docx.js';

export interface Outline {
  text: string;                       // the numbered listing sent to the model
  cells: Map<string, string>;         // cell id → text
  paras: Map<number, string>;         // body paragraph index → text ('' when empty)
  order: Map<string, number>;         // id (p12, t0r1c2) → position in the document
}

const hasImage = (p: XEl) => els(p, 'w:drawing').length > 0 || els(p, 'w:pict').length > 0;

export function outline(doc: XDoc): Outline {
  const tbls = tables(doc);
  const ps = paragraphs(doc);
  const tIndex = new Map(tbls.map((t, i) => [t.el, i]));
  const pIndex = new Map(ps.map((p, i) => [p, i]));
  const cells = new Map<string, string>();
  const paras = new Map<number, string>();
  const order = new Map<string, number>();
  const out: string[] = [];
  let empties: number[] = [];
  const flush = () => {
    if (!empties.length) return;
    out.push(empties.length === 1 ? `[p${empties[0]}] (empty)` : `[p${empties[0]}–p${empties[empties.length - 1]}] (${empties.length} empty paragraphs)`);
    empties = [];
  };
  const walk = (n: any) => {
    for (const c of Array.from(n.childNodes ?? []) as any[]) {
      if (c.nodeName === 'w:p') {
        const i = pIndex.get(c)!;
        const t = clean(textOf(c));
        paras.set(i, t);
        order.set(`p${i}`, order.size);
        if (!t && !hasImage(c)) { empties.push(i); continue; }
        flush();
        out.push(`[p${i}] ${hasImage(c) ? '[image] ' : ''}${t.slice(0, 600)}`);
      } else if (c.nodeName === 'w:tbl') {
        flush();
        const ti = tIndex.get(c)!;
        const rows = tbls[ti].rows;
        out.push(`[t${ti}] table, ${rows.length} row(s)`);
        rows.forEach((tcs, ri) => {
          out.push(`  r${ri}: ${tcs.map((tc, ci) => {
            const id = `t${ti}r${ri}c${ci}`;
            const t = clean(textOf(tc));
            cells.set(id, t);
            order.set(id, order.size);
            return `[${id}] ${hasImage(tc) ? '[image] ' : ''}${t.slice(0, 300) || '·'}`;
          }).join(' | ')}`);
        });
      } else if (c.nodeName === 'w:sdt' || c.nodeName === 'w:sdtContent') walk(c);
    }
  };
  walk(els(doc, 'w:body')[0]);
  flush();
  return { text: out.join('\n'), cells, paras, order };
}
