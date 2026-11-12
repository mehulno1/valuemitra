// "ValueMitra recommended" fonts for a bank format: Times New Roman throughout (a font every PC and the PDF
// server has, so Word and PDF break pages the same way), body text 11 pt, tables 10 pt, the rate indicators
// chart 9 pt with bold headings only and columns wide enough for the longest values. Headings and cover lines
// (14 pt and more) keep their sizes.
import { children, els, textOf, W_NS, type DocxParts } from './docx.js';

export const REPORT_FONT = 'Times New Roman';
/** Fonts on every Windows / Mac Word and on the PDF server (after the fonts are installed there). */
const SAFE = new Set(['times new roman', 'arial', 'courier new', 'symbol', 'wingdings', 'verdana', 'georgia', 'tahoma']);

/** Fonts a Word file names, and why the recommended fonts are suggested for it (null: keep as uploaded). */
export function fontReport(parts: DocxParts): { used: string[]; unsafe: string[]; reason: string | null } {
  const xml = String(parts.doc) + (parts.zip.file('word/styles.xml')?.asText() ?? '');
  const used = new Set<string>();
  for (const m of xml.matchAll(/w:(?:ascii|hAnsi)="([^"]+)"/g)) used.add(m[1]);
  // theme fonts (Calibri / Cambria in most files) count when anything points at the theme
  if (/w:(?:ascii|hAnsi)Theme=/.test(xml)) for (const m of (parts.zip.file('word/theme/theme1.xml')?.asText() ?? '').matchAll(/<a:latin typeface="([^"]+)"/g)) if (m[1]) used.add(m[1]);
  const unsafe = [...used].filter((f) => !SAFE.has(f.toLowerCase()));
  const narrow = els(parts.doc, 'w:tc').some((tc) => { const w = els(tc, 'w:tcW')[0]; return w && (w.getAttribute('w:type') ?? 'dxa') === 'dxa' && Number(w.getAttribute('w:w')) < 1000 && /\d{5,}/.test(textOf(tc)); });
  const reason = unsafe.length ? `This file uses ${unsafe.slice(0, 3).join(', ')}, which ${unsafe.length > 1 ? 'are' : 'is'} not on every PC or on the server that makes the PDFs; a stand-in font would change where lines and pages break.`
    : narrow ? 'A table in this file has columns too narrow for its numbers at the size used.' : null;
  return { used: [...used].sort(), unsafe, reason };
}

// bullet and symbol fonts keep their glyphs
const SYMBOLS = /^(symbol|wingdings( [23])?|webdings|courier new|marlett)$/i;
/** Every font reference in a part's XML → the report font (list numbers, headers and footers of the bank's file). */
const fontsInXml = (xml: string) => xml.replace(/<w:rFonts\b[^>]*\/>/g, (m) => (SYMBOLS.test(/w:ascii="([^"]+)"/.exec(m)?.[1] ?? '') ? m : `<w:rFonts w:ascii="${REPORT_FONT}" w:hAnsi="${REPORT_FONT}" w:cs="${REPORT_FONT}"/>`));

const setFonts = (rFonts: any) => {
  if (SYMBOLS.test(rFonts.getAttribute('w:ascii') ?? '')) return;
  for (const a of ['w:asciiTheme', 'w:hAnsiTheme', 'w:cstheme', 'w:eastAsiaTheme']) rFonts.removeAttribute(a);
  for (const a of ['w:ascii', 'w:hAnsi', 'w:cs']) rFonts.setAttribute(a, REPORT_FONT);
};

function rPrOf(doc: any, r: any) {
  let rPr = children(r, 'w:rPr')[0];
  if (!rPr) { rPr = doc.createElementNS(W_NS, 'w:rPr'); r.insertBefore(rPr, r.firstChild); }
  return rPr;
}
function setSz(doc: any, rPr: any, half: number) {
  for (const tag of ['w:sz', 'w:szCs']) {
    let e = children(rPr, tag)[0];
    if (!e) {
      e = doc.createElementNS(W_NS, tag);
      const after = ['w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'];
      const next = (Array.from(rPr.childNodes) as any[]).find((k) => k.nodeType === 1 && (tag === 'w:sz' ? after : after.slice(1)).includes(k.nodeName));
      rPr.insertBefore(e, next ?? null);
    }
    e.setAttribute('w:val', String(half));
  }
}
const inCell = (n: any) => { for (let x = n.parentNode; x; x = x.parentNode) if (x.nodeName === 'w:tc') return true; return false; };

/** The rate indicators chart (the table with "Comparable 1"): 9 pt, bold on the heading row only, fixed column
 *  widths that take "Comparable 3" and Rs. 10,00,00,000 on one line. */
export function tightenChart(doc: any, pageTwips = 10200): number {
  let n = 0;
  for (const tbl of els(doc, 'w:tbl')) {
    if (els(tbl, 'w:tbl').length) continue;
    const rows = children(tbl, 'w:tr');
    if (!rows.some((tr) => /^\s*Comparable\s*1\s*$/i.test(textOf(children(tr, 'w:tc')[0] ?? tr)))) continue;
    const cols = Math.max(...rows.map((tr) => children(tr, 'w:tc').length));
    // label, source, description, value, area, rate, rate considered (7 columns); other shapes share the width evenly
    const share = cols === 7 ? [0.14, 0.15, 0.19, 0.14, 0.095, 0.1, 0.185] : Array.from({ length: cols }, () => 1 / cols);
    const tblPr = children(tbl, 'w:tblPr')[0];
    // the room it has: the cell it sits in (less that cell's margins and the table's indent), else the page
    let host: any = tbl.parentNode;
    while (host && host.nodeName !== 'w:tc') host = host.parentNode;
    const hostPr = host ? children(host, 'w:tcPr')[0] : undefined;
    const hostW = hostPr ? Number(children(hostPr, 'w:tcW')[0]?.getAttribute('w:w')) || 0 : 0;
    const ind = tblPr ? Math.max(0, Number(children(tblPr, 'w:tblInd')[0]?.getAttribute('w:w')) || 0) : 0;
    const avail = hostW > 3000 ? hostW - 216 - ind - 80 : pageTwips;
    const widths = share.map((x) => Math.round(avail * x));
    if (tblPr) {
      let lay = children(tblPr, 'w:tblLayout')[0];
      if (!lay) { lay = doc.createElementNS(W_NS, 'w:tblLayout'); const after = (Array.from(tblPr.childNodes) as any[]).find((k) => ['w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription'].includes(k.nodeName)); tblPr.insertBefore(lay, after ?? null); }
      lay.setAttribute('w:type', 'fixed');
      const tw = children(tblPr, 'w:tblW')[0];
      if (tw) { tw.setAttribute('w:w', String(widths.reduce((a, b) => a + b, 0))); tw.setAttribute('w:type', 'dxa'); }
      // tighter cell margins (3.5 pt a side) leave the columns' width to the text
      for (const old of children(tblPr, 'w:tblCellMar')) tblPr.removeChild(old);
      const mar = doc.createElementNS(W_NS, 'w:tblCellMar');
      for (const side of ['w:left', 'w:right']) { const e = doc.createElementNS(W_NS, side); e.setAttribute('w:w', '70'); e.setAttribute('w:type', 'dxa'); mar.appendChild(e); }
      tblPr.insertBefore(mar, (Array.from(tblPr.childNodes) as any[]).find((k) => ['w:tblLook', 'w:tblCaption', 'w:tblDescription'].includes(k.nodeName)) ?? null);
    }
    const grid = children(tbl, 'w:tblGrid')[0];
    if (grid) {
      for (const g of children(grid, 'w:gridCol')) grid.removeChild(g);
      for (const w of widths) { const g = doc.createElementNS(W_NS, 'w:gridCol'); g.setAttribute('w:w', String(w)); grid.appendChild(g); }
    }
    rows.forEach((tr, ri) => {
      const cells = children(tr, 'w:tc');
      if (cells.length !== cols) return;
      cells.forEach((tc, ci) => {
        const w = els(children(tc, 'w:tcPr')[0] ?? tc, 'w:tcW')[0];
        if (w) { w.setAttribute('w:w', String(widths[ci])); w.setAttribute('w:type', 'dxa'); }
        for (const p of els(tc, 'w:p')) {
          // the paragraph mark too, so an empty cell is not taller than the rest
          const pPr = children(p, 'w:pPr')[0];
          const mark = pPr ? children(pPr, 'w:rPr')[0] : undefined;
          if (mark) setSz(doc, mark, 18);
          for (const r of children(p, 'w:r')) {
            const rPr = rPrOf(doc, r);
            setSz(doc, rPr, 18);
            if (ri > 0) for (const b of [...children(rPr, 'w:b'), ...children(rPr, 'w:bCs')]) rPr.removeChild(b);
          }
        }
      });
    });
    n++;
  }
  return n;
}

/** Apply the recommended fonts to a format (document, styles, and the chart). */
export function recommendedFonts(parts: DocxParts, opts: { body?: number; table?: number } = {}) {
  const { doc, zip } = parts;
  const body = opts.body ?? 22;
  const table = opts.table ?? 20;
  // styles: the default font and every style's own
  const styles = zip.file('word/styles.xml')?.asText();
  let def = 22;
  if (styles) {
    def = Number(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/.exec(styles)?.[1]) || 22;
    zip.file('word/styles.xml', fontsInXml(styles));
  }
  // list numbers ("1)" set in Cambria), and the bank's own headers, footers and notes
  for (const name of Object.keys(zip.files).filter((n) => /^word\/(numbering|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))) zip.file(name, fontsInXml(zip.file(name)!.asText()));
  const styleSz = new Map<string, number>();
  for (const m of (styles ?? '').matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) { const sz = /<w:rPr>[\s\S]*?<w:sz w:val="(\d+)"/.exec(m[2])?.[1]; if (sz) styleSz.set(m[1], Number(sz)); }
  for (const f of els(doc, 'w:rFonts')) setFonts(f);
  for (const p of els(doc, 'w:p')) {
    const pPr = children(p, 'w:pPr')[0];
    const ps = pPr ? children(pPr, 'w:pStyle')[0]?.getAttribute('w:val') : null;
    const cell = inCell(p);
    for (const r of els(p, 'w:r')) {
      if (r.parentNode !== p && (r.parentNode as any)?.nodeName !== 'w:hyperlink') continue;
      const rPr = rPrOf(doc, r);
      let f = children(rPr, 'w:rFonts')[0];
      if (!f) { f = doc.createElementNS(W_NS, 'w:rFonts'); rPr.insertBefore(f, (Array.from(rPr.childNodes) as any[]).find((k) => k.nodeType === 1 && k.nodeName !== 'w:rStyle') ?? null); }
      setFonts(f);
      const own = Number(children(rPr, 'w:sz')[0]?.getAttribute('w:val'));
      const eff = own || (ps ? styleSz.get(ps) : undefined) || def;
      // running text (9 to 12 pt) takes the standard size; headings, cover lines and spacers keep theirs
      if (eff >= 18 && eff <= 24) setSz(doc, rPr, cell ? table : body);
    }
  }
  tightenChart(doc);
}
