// Render-time table changes: the comparables chart sized to the comparables the case has (D4 of the 13 Nov
// retest), and picture pages as bordered grids (G2). Applied at render, so published formats get them too.
import type { Document as XDoc, Element as XEl } from '@xmldom/xmldom';
import { children, els, textOf, W_NS } from './docx.js';

const COMP_REF = /EVID\.COMP(\d+)\./g;
const compsIn = (el: XEl) => new Set([...textOf(el).matchAll(COMP_REF)].map((m) => Number(m[1])));

/** Grid column where each cell of a row starts (gridSpan counted). */
const gridStarts = (tr: XEl) => {
  let g = 0;
  return children(tr, 'w:tc').map((tc) => {
    const at = g;
    const span = els(tc, 'w:gridSpan')[0];
    g += span ? Number(span.getAttribute('w:val')) || 1 : 1;
    return { tc, at };
  });
};
const vMergeOf = (tc: XEl) => {
  const pr = children(tc, 'w:tcPr')[0];
  const vm = pr ? children(pr, 'w:vMerge')[0] : undefined;
  return vm ? (vm.getAttribute('w:val') === 'restart' ? 'restart' : 'continue') : null;
};

export type CompPrint = 'filled' | 'na' | 'none';

/** The comparables table (rows that print EVID.COMP<n>.*), per the case's choice: 'filled' drops the rows of
 *  comparables the case does not have (one row stays, reading "Not available", when it has none); 'na' keeps
 *  every row (the data then says "Not available"); 'none' removes the table and its caption line. A cell merged
 *  down the rows (the adopted rate beside the chart) moves to the first row that stays. */
export function fitComparableRows(doc: XDoc, mode: CompPrint, empty: Set<number>): number {
  if (mode === 'na') return 0;
  let changed = 0;
  for (const tbl of els(doc, 'w:tbl')) {
    if (!tbl.parentNode) continue;
    const rows = children(tbl, 'w:tr');
    const compRows = rows.filter((tr) => !els(tr, 'w:tbl').length && compsIn(tr).size > 0);
    if (!compRows.length) continue;
    if (mode === 'none') {
      const parent = tbl.parentNode as unknown as XEl;
      // the caption line just above it ("Rate Indicators Chart")
      let prev: any = tbl.previousSibling;
      while (prev && prev.nodeType !== 1) prev = prev.previousSibling;
      if (prev && prev.nodeName === 'w:p' && /chart|comparab|indicator|instance/i.test(textOf(prev)) && textOf(prev).length < 120) parent.removeChild(prev);
      parent.removeChild(tbl);
      // a table cell must end with a paragraph
      if (parent.nodeName === 'w:tc' && !children(parent, 'w:p').length) parent.appendChild(doc.createElementNS(W_NS, 'w:p'));
      changed++;
      continue;
    }
    let drop = compRows.filter((tr) => [...compsIn(tr)].every((n) => empty.has(n)));
    if (drop.length === compRows.length) drop = drop.slice(1);
    for (const tr of drop) {
      const idx = rows.indexOf(tr);
      for (const { tc, at } of gridStarts(tr)) {
        if (vMergeOf(tc) !== 'restart') continue;
        // the next row that stays and continues this merge takes over its content
        const heir = rows.slice(idx + 1).filter((r) => !drop.includes(r)).map((r) => gridStarts(r).find((c) => c.at === at)?.tc).find((c) => c && vMergeOf(c) === 'continue');
        if (!heir) continue;
        children(children(heir, 'w:tcPr')[0], 'w:vMerge')[0].setAttribute('w:val', 'restart');
        for (const p of children(heir, 'w:p')) heir.removeChild(p);
        for (const k of (Array.from(tc.childNodes as any) as XEl[]).filter((k: any) => k.nodeType === 1 && k.nodeName !== 'w:tcPr')) heir.appendChild(k);
      }
      tbl.removeChild(tr);
      changed++;
    }
  }
  return changed;
}

const el = (doc: XDoc, name: string, attrs: Record<string, string> = {}) => {
  const e = doc.createElementNS(W_NS, name) as unknown as XEl;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** A one-column picture grid (maps, evidence, full-page documents) was compiled as one cell holding the picture
 *  and its caption with the loop inside it, so Word repeated paragraphs in that cell: a caption ran into the next
 *  picture ("Location map" printed over the screenshot below it). Picture and caption become two rows the loop
 *  repeats, so each picture is its own boxed row with the caption under it. */
export function splitSingleColumnGrids(doc: XDoc, imageTag: string): number {
  let n = 0;
  for (const tbl of els(doc, 'w:tbl')) {
    const rows = children(tbl, 'w:tr');
    if (rows.length !== 1 || !textOf(tbl).includes(imageTag)) continue;
    const cells = children(rows[0], 'w:tc');
    if (cells.length !== 1) continue;
    const ps = children(cells[0], 'w:p');
    if (ps.length !== 2) continue;
    const capRow = rows[0].cloneNode(true) as unknown as XEl;
    cells[0].removeChild(ps[1]);
    const capCell = children(capRow, 'w:tc')[0];
    capCell.removeChild(children(capCell, 'w:p')[0]);
    tbl.appendChild(capRow);
    // the caption stays on the picture's page
    let pPr = children(ps[0], 'w:pPr')[0];
    if (!pPr) { pPr = el(doc, 'w:pPr'); ps[0].insertBefore(pPr, ps[0].firstChild); }
    const style = children(pPr, 'w:pStyle')[0];
    if (!children(pPr, 'w:keepNext').length) pPr.insertBefore(el(doc, 'w:keepNext'), style ? style.nextSibling : pPr.firstChild);
    n++;
  }
  return n;
}

/** Picture pages (photos, maps, ready reckoner, listings, sale instances, document pages) print as a bordered
 *  grid with the caption under each picture, rows never split across pages. `imageTag` marks a grid table (the
 *  first cell's image tag, as compiled). */
export function borderPictureGrids(doc: XDoc, imageTag: string): number {
  let n = 0;
  for (const tbl of els(doc, 'w:tbl')) {
    if (!textOf(tbl).includes(imageTag)) continue;
    for (const tc of els(tbl, 'w:tc')) {
      let pr = children(tc, 'w:tcPr')[0];
      if (!pr) { pr = el(doc, 'w:tcPr'); tc.insertBefore(pr, tc.firstChild); }
      for (const b of children(pr, 'w:tcBorders')) pr.removeChild(b);
      const borders = el(doc, 'w:tcBorders');
      for (const side of ['top', 'left', 'bottom', 'right']) borders.appendChild(el(doc, `w:${side}`, { 'w:val': 'single', 'w:sz': '6', 'w:space': '0', 'w:color': '000000' }));
      // CT_TcPr order: tcW, gridSpan, vMerge/hMerge, tcBorders, …
      const after = [...children(pr, 'w:tcW'), ...children(pr, 'w:gridSpan'), ...children(pr, 'w:hMerge'), ...children(pr, 'w:vMerge')].pop();
      pr.insertBefore(borders, after ? after.nextSibling : pr.firstChild);
    }
    for (const tr of children(tbl, 'w:tr')) {
      let trPr = children(tr, 'w:trPr')[0];
      if (!trPr) { trPr = el(doc, 'w:trPr'); const ex = children(tr, 'w:tblPrEx')[0]; tr.insertBefore(trPr, ex ? ex.nextSibling : tr.firstChild); }
      if (!children(trPr, 'w:cantSplit').length) trPr.insertBefore(el(doc, 'w:cantSplit'), trPr.firstChild);
    }
    // room around each picture inside its border (CT_TblPr: … tblLayout, tblCellMar, tblLook)
    const tblPr = children(tbl, 'w:tblPr')[0];
    if (tblPr && !children(tblPr, 'w:tblCellMar').length) {
      const mar = el(doc, 'w:tblCellMar');
      for (const [side, w] of [['top', 80], ['left', 80], ['bottom', 0], ['right', 80]] as const) mar.appendChild(el(doc, `w:${side}`, { 'w:w': String(w), 'w:type': 'dxa' }));
      const look = children(tblPr, 'w:tblLook')[0];
      tblPr.insertBefore(mar, look ?? null);
    }
    n++;
  }
  return n;
}
