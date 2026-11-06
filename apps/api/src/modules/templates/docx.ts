// Low-level helpers over WordprocessingML (document.xml) using a DOM, so templates keep their own
// layout, fonts and numbering: we only touch the text inside value cells and placeholders.
import { DOMParser, XMLSerializer, type Document as XDoc, type Element as XEl } from '@xmldom/xmldom';
import PizZip from 'pizzip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface DocxParts {
  zip: PizZip;
  doc: XDoc;
}

export function openDocx(buf: Buffer): DocxParts {
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml')?.asText();
  if (!xml) throw new Error('Not a Word document (word/document.xml missing)');
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as XDoc;
  return { zip, doc };
}

export function saveDocx(p: DocxParts): Buffer {
  p.zip.file('word/document.xml', new XMLSerializer().serializeToString(p.doc as any));
  return p.zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const els = (root: XDoc | XEl, tag: string): XEl[] => Array.from((root as any).getElementsByTagName(tag)) as XEl[];

export const children = (el: XEl, tag: string): XEl[] =>
  Array.from(el.childNodes as any).filter((n: any) => n.nodeType === 1 && n.nodeName === tag) as XEl[];

export function textOf(el: XEl): string {
  let s = '';
  const walk = (n: any) => {
    if (n.nodeType === 1) {
      if (n.nodeName === 'w:t') s += n.textContent ?? '';
      else if (n.nodeName === 'w:tab') s += '\t';
      else if (n.nodeName === 'w:br' || n.nodeName === 'w:cr') s += '\n';
      else for (const c of Array.from(n.childNodes)) walk(c);
      if (n.nodeName === 'w:p' && n.nextSibling) s += '\n';
    }
  };
  walk(el);
  return s.replace(/\n+$/, '');
}

export const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** All tables in document order (nested ones included), each with direct rows and cells. */
export function tables(doc: XDoc) {
  return els(doc, 'w:tbl').map((tbl) => ({
    el: tbl,
    rows: children(tbl, 'w:tr').map((tr) => children(tr, 'w:tc')),
  }));
}

export const paragraphs = (doc: XDoc) => els(doc, 'w:p');

/** Is this paragraph inside a table cell? */
export function inTable(p: XEl): boolean {
  let n: any = p.parentNode;
  while (n) { if (n.nodeName === 'w:tc') return true; n = n.parentNode; }
  return false;
}

/**
 * Merge the runs of a paragraph that holds a placeholder so that "{{", the code and "}}" end up in
 * one w:t (Word often splits typed text across runs). Keeps the first run's formatting.
 */
export function mergeRuns(p: XEl) {
  const runs = children(p, 'w:r');
  if (runs.length < 2) return;
  const ts = runs.map((r) => children(r, 'w:t')[0]).filter(Boolean);
  if (ts.length < 2) return;
  const full = ts.map((t) => t.textContent ?? '').join('');
  ts[0].textContent = full;
  ts[0].setAttribute('xml:space', 'preserve');
  for (const t of ts.slice(1)) t.parentNode?.removeChild(t);
}

/** Append `text` as runs: each ⟪tag⟫ in a run of its own (image tags require it), line breaks as w:br. */
export function appendRuns(doc: XDoc, parent: XEl, text: string, rPr?: XEl, dropBold = false) {
  for (const piece of text.split(/(⟪[^⟫]*⟫)/).filter(Boolean)) {
    const lines = piece.startsWith('⟪') ? [piece] : piece.split('\n');
    lines.forEach((line, i) => {
      const r = doc.createElementNS(W_NS, 'w:r');
      if (rPr) {
        const rp = rPr.cloneNode(true) as XEl;
        if (dropBold) children(rp, 'w:b').forEach((b) => rp.removeChild(b));
        r.appendChild(rp);
      }
      if (i > 0) r.appendChild(doc.createElementNS(W_NS, 'w:br'));
      if (line) {
        const t = doc.createElementNS(W_NS, 'w:t');
        t.setAttribute('xml:space', 'preserve');
        t.textContent = line;
        r.appendChild(t);
      }
      parent.appendChild(r);
    });
  }
}

/** Replace a paragraph's runs with `text`, keeping its paragraph formatting and first run's font. */
export function setParagraphText(doc: XDoc, p: XEl, text: string) {
  const rPr = els(p, 'w:r').map((r) => children(r, 'w:rPr')[0]).find(Boolean);
  const keep = rPr?.cloneNode(true) as XEl | undefined;
  for (const n of Array.from(p.childNodes as any) as any[]) if (n.nodeName !== 'w:pPr') p.removeChild(n);
  appendRuns(doc, p, text, keep);
}

/** Replace a cell's content with one paragraph holding `text`, keeping paragraph and run formatting. */
export function setCellText(doc: XDoc, tc: XEl, text: string, fallbackFormatFrom?: XEl) {
  const ps = children(tc, 'w:p');
  const firstP = ps[0];
  const pPr = firstP ? children(firstP, 'w:pPr')[0] : undefined;
  const firstRun = ps.flatMap((p) => children(p, 'w:r'))[0] ?? (fallbackFormatFrom ? els(fallbackFormatFrom, 'w:r')[0] : undefined);
  const rPr = firstRun ? children(firstRun, 'w:rPr')[0] : undefined;
  for (const p of ps) tc.removeChild(p);
  const np = doc.createElementNS(W_NS, 'w:p');
  if (pPr) np.appendChild(pPr.cloneNode(true));
  // value text is never bold just because the label was
  appendRuns(doc, np, text, rPr, !firstP);
  tc.appendChild(np);
}

/**
 * Floating tables (positioned on the page) become ordinary tables. Word flows the text after such a
 * table above it; LibreOffice, which makes the PDF, places it elsewhere, leaving blank pages and text
 * printed over the table. A table fixed to the page or margin keeps Word's order: the paragraphs it is
 * anchored to (up to the last one with text before the next table) move in front of it.
 */
export function unfloatTables(doc: XDoc): boolean {
  let changed = false;
  for (const tbl of els(doc, 'w:tbl')) {
    const tblPr = children(tbl, 'w:tblPr')[0];
    const pos = tblPr ? children(tblPr, 'w:tblpPr')[0] : undefined;
    if (!pos) continue;
    changed = true;
    tblPr.removeChild(pos);
    if ((pos.getAttribute('w:vertAnchor') ?? 'margin') === 'text') continue;
    const after: XEl[] = [];
    for (let n: any = tbl.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.nodeName !== 'w:p' || els(n, 'w:sectPr').length) break;
      after.push(n);
    }
    const hasText = (p: XEl) => els(p, 'w:t').some((t) => (t.textContent ?? '').trim()) || els(p, 'w:drawing').length > 0;
    let last = -1;
    after.forEach((p, i) => { if (hasText(p)) last = i; });
    for (const p of after.slice(0, last + 1)) tbl.parentNode!.insertBefore(p, tbl);
  }
  return changed;
}

/** Replace the text of a paragraph range: everything after `afterText` becomes `text` (inline blanks). */
export function replaceInParagraph(p: XEl, find: string, replacement: string): boolean {
  mergeRuns(p);
  for (const t of els(p, 'w:t')) {
    const s = t.textContent ?? '';
    if (s.includes(find)) {
      t.textContent = s.replace(find, replacement);
      t.setAttribute('xml:space', 'preserve');
      return true;
    }
  }
  return false;
}

/**
 * Replace `find` in a paragraph without merging its runs, so the bank's formatting around it (a bold
 * amount in a plain sentence) stays. The text before and after stays in its own runs; the replacement
 * goes in a run of its own with the formatting of the run where `find` starts.
 */
export function replaceKeepingRuns(doc: XDoc, p: XEl, find: string, replacement: string): boolean {
  const ts = els(p, 'w:t').filter((t) => {
    // text of this paragraph only, not of a nested one
    let n: any = t.parentNode;
    while (n && n.nodeName !== 'w:p') n = n.parentNode;
    return n === p;
  });
  const parts = ts.map((t) => t.textContent ?? '');
  const full = parts.join('');
  const at = full.indexOf(find);
  if (at < 0) return false;
  const end = at + find.length;
  let pos = 0;
  let first = -1;
  let last = -1;
  const starts = parts.map((x) => { const s = pos; pos += x.length; return s; });
  parts.forEach((x, i) => {
    if (first < 0 && starts[i] + x.length > at) first = i;
    if (starts[i] < end) last = i;
  });
  const before = parts[first].slice(0, at - starts[first]);
  const after = parts[last].slice(end - starts[last]);
  for (let i = first; i <= last; i++) { ts[i].textContent = ''; ts[i].setAttribute('xml:space', 'preserve'); }
  ts[first].textContent = before;
  if (first !== last) ts[last].textContent = after;
  if (first === last) {
    // split the run: before | replacement | after
    const run = ts[first].parentNode as XEl;
    const tail = run.cloneNode(true) as XEl;
    const tailT = els(tail, 'w:t')[0];
    for (const n of Array.from(tail.childNodes as any) as any[]) if (n.nodeName !== 'w:rPr' && n !== tailT) tail.removeChild(n);
    tailT.textContent = after;
    run.parentNode!.insertBefore(tail, run.nextSibling);
  }
  const run = ts[first].parentNode as XEl;
  const rPr = children(run, 'w:rPr')[0];
  const holder = doc.createElementNS(W_NS, 'w:p');
  appendRuns(doc, holder, replacement, rPr);
  let ref: any = run.nextSibling;
  for (const r of Array.from(holder.childNodes as any) as any[]) run.parentNode!.insertBefore(r, ref);
  return true;
}

/**
 * Rebuild a table's grid from its cells' widths. Word lays out by the cell widths; LibreOffice (which
 * makes the PDF) by the grid, and a stale grid gives an extra empty column and wider tables. Column
 * edges are the union of every row's cell edges; each cell then spans the grid columns between its own
 * edges. Tables with widths other than twips (dxa) are left as they are.
 */
export function regridTables(doc: XDoc): number {
  let fixed = 0;
  for (const tbl of els(doc, 'w:tbl')) {
    const rows = children(tbl, 'w:tr');
    const cellsOf = (tr: XEl) => children(tr, 'w:tc');
    const widthOf = (tc: XEl) => {
      const w = els(children(tc, 'w:tcPr')[0] ?? tc, 'w:tcW')[0];
      return w && (w.getAttribute('w:type') ?? 'dxa') === 'dxa' ? Number(w.getAttribute('w:w')) : NaN;
    };
    const before = (tr: XEl) => {
      const pr = children(tr, 'w:trPr')[0];
      const wb = pr ? children(pr, 'w:wBefore')[0] : undefined;
      return wb ? Number(wb.getAttribute('w:w')) || 0 : 0;
    };
    const all = rows.flatMap(cellsOf);
    if (!all.length || all.some((tc) => !(widthOf(tc) > 0))) continue;
    const SNAP = 20;
    const edges: number[] = [0];
    const add = (x: number) => { if (!edges.some((e) => Math.abs(e - x) <= SNAP)) edges.push(x); };
    for (const tr of rows) {
      let x = before(tr);
      add(x);
      for (const tc of cellsOf(tr)) { x += widthOf(tc); add(x); }
    }
    edges.sort((a, b) => a - b);
    const idx = (x: number) => edges.findIndex((e) => Math.abs(e - x) <= SNAP);
    const grid = children(tbl, 'w:tblGrid')[0];
    if (!grid) continue;
    for (const g of children(grid, 'w:gridCol')) grid.removeChild(g);
    for (let i = 1; i < edges.length; i++) {
      const g = doc.createElementNS(W_NS, 'w:gridCol');
      g.setAttribute('w:w', String(edges[i] - edges[i - 1]));
      grid.appendChild(g);
    }
    for (const tr of rows) {
      let x = before(tr);
      const pr = children(tr, 'w:trPr')[0];
      const gb = pr ? children(pr, 'w:gridBefore')[0] : undefined;
      if (gb) gb.setAttribute('w:val', String(idx(x)));
      for (const tc of cellsOf(tr)) {
        const a = idx(x);
        x += widthOf(tc);
        const span = idx(x) - a;
        const tcPr = children(tc, 'w:tcPr')[0];
        const gs = children(tcPr, 'w:gridSpan')[0];
        if (span > 1) {
          if (gs) gs.setAttribute('w:val', String(span));
          else { const e = doc.createElementNS(W_NS, 'w:gridSpan'); e.setAttribute('w:val', String(span)); const w = children(tcPr, 'w:tcW')[0]; tcPr.insertBefore(e, w ? w.nextSibling : tcPr.firstChild); }
        } else if (gs) tcPr.removeChild(gs);
      }
      const ga = pr ? children(pr, 'w:gridAfter')[0] : undefined;
      if (ga) ga.setAttribute('w:val', String(Math.max(0, edges.length - 1 - idx(x))));
    }
    fixed++;
  }
  return fixed;
}
