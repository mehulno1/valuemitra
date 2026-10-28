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
