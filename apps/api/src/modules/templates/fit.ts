// Fitting text to the space the bank's format gives it, after a report is filled in:
//   - a narrow table cell never breaks inside a word or a number ("Not App lica ble", "180000 / 00"): the cell's
//     text drops in size until its longest word fits (never below 7 pt)
//   - the cover page's long lines (the address) step down 20 pt → 16 pt → 14 pt so the cover stays one page
// Widths are estimated with Times New Roman's character widths, the font the reports print in.
import type { Document as XDoc, Element as XEl } from '@xmldom/xmldom';
import { children, els, W_NS } from './docx.js';

// Times New Roman advance widths per 1000 units of font size
const W: Record<string, number> = {
  ' ': 250, '!': 333, '"': 408, '#': 500, $: 500, '%': 833, '&': 778, "'": 180, '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278,
  ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444, '@': 921, '[': 333, ']': 333, _: 500, '–': 500, '—': 1000, '’': 333, '‘': 333, '“': 444, '”': 444, '°': 400,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389, K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
};

/** Width of `text` in points at `sizePt` (bold runs about 7% wider; digits the same in both). */
export function textWidth(text: string, sizePt: number, bold = false): number {
  let u = 0;
  for (const ch of text) u += /\d/.test(ch) ? 500 : (W[ch] ?? 560) * (bold ? 1.07 : 1);
  return (u * sizePt) / 1000;
}

const SHORT: [RegExp, string][] = [[/^not\s+applicable\.?$/i, 'N.A.'], [/^not\s+available\.?$/i, 'N.A.']];

interface Sizes { def: number; styles: Map<string, { sz?: number; based?: string; bold?: boolean }> }

/** Font sizes (half-points) the styles give, so a run without its own size can be measured. */
export function styleSizes(stylesXml: string | undefined): Sizes {
  const out: Sizes = { def: 22, styles: new Map() };
  if (!stylesXml) return out;
  const d = /<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/.exec(stylesXml);
  if (d) out.def = Number(d[1]);
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(m[2])?.[1] ?? '';
    out.styles.set(m[1], { sz: Number(/<w:sz w:val="(\d+)"/.exec(rPr)?.[1]) || undefined, based: /<w:basedOn w:val="([^"]+)"/.exec(m[2])?.[1], bold: /<w:b\/>|<w:b w:val="(1|true)"/.test(rPr) });
  }
  return out;
}

function styleSz(s: Sizes, id: string | null | undefined): number | undefined {
  for (let k = 0, cur = id; k < 8 && cur; k++) { const st = s.styles.get(cur); if (!st) break; if (st.sz) return st.sz; cur = st.based; }
  return undefined;
}

const val = (el: XEl | undefined, tag: string) => { const x = el ? children(el, tag)[0] : undefined; return x ? x.getAttribute('w:val') : null; };
const ownRuns = (p: XEl) => els(p, 'w:r').filter((r) => { let n: any = r.parentNode; while (n && n.nodeName !== 'w:p') n = n.parentNode; return n === p; });
const runText = (r: XEl) => children(r, 'w:t').map((t) => t.textContent ?? '').join('') + (children(r, 'w:br').length ? '\n' : '') + (children(r, 'w:tab').length ? ' ' : '');

function runSize(r: XEl, p: XEl, s: Sizes): number {
  const own = Number(val(children(r, 'w:rPr')[0], 'w:sz'));
  if (own) return own;
  const pPr = children(p, 'w:pPr')[0];
  return styleSz(s, val(children(r, 'w:rPr')[0], 'w:rStyle')) ?? styleSz(s, val(pPr, 'w:pStyle')) ?? s.def;
}
const runBold = (r: XEl) => { const b = children(children(r, 'w:rPr')[0] ?? r, 'w:b')[0]; return !!b && !['0', 'false'].includes(b.getAttribute('w:val') ?? '1'); };

function setSize(doc: XDoc, r: XEl, half: number) {
  let rPr = children(r, 'w:rPr')[0];
  if (!rPr) { rPr = doc.createElementNS(W_NS, 'w:rPr') as XEl; r.insertBefore(rPr, r.firstChild); }
  for (const tag of ['w:sz', 'w:szCs']) {
    let e = children(rPr, tag)[0];
    if (!e) {
      e = doc.createElementNS(W_NS, tag) as XEl;
      // CT_RPr order: … sz, szCs, highlight, u, effect, bdr, shd, fitText, vertAlign, rtl, cs, em, lang …
      const after = ['w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'];
      const next = (Array.from(rPr.childNodes as any) as XEl[]).find((k: any) => k.nodeType === 1 && (tag === 'w:sz' ? after : after.slice(1)).includes(k.nodeName));
      rPr.insertBefore(e, next ?? null);
    }
    e.setAttribute('w:val', String(half));
  }
}

/** Words of a paragraph with the widest point size and boldness they are set in (a word may span runs). */
function words(p: XEl, s: Sizes) {
  const out: { text: string; width: number }[] = [];
  let cur = '';
  let width = 0;
  const flush = () => { if (cur) out.push({ text: cur, width }); cur = ''; width = 0; };
  for (const r of ownRuns(p)) {
    const size = runSize(r, p, s) / 2;
    const bold = runBold(r);
    for (const ch of runText(r)) {
      if (/\s/.test(ch)) { flush(); continue; }
      cur += ch;
      width += textWidth(ch, size, bold);
      // a line may break after a hyphen or a slash followed by more text
      if (ch === '-' || ch === '–') flush();
    }
  }
  flush();
  return out;
}

/** Narrow cells: shrink a cell's text until its longest word fits on one line. Returns cells changed. */
export function fitCells(doc: XDoc, s: Sizes, minPt = 7): number {
  let n = 0;
  for (const tc of els(doc, 'w:tc')) {
    const tcPr = children(tc, 'w:tcPr')[0];
    const tcW = tcPr ? children(tcPr, 'w:tcW')[0] : undefined;
    if (!tcW || (tcW.getAttribute('w:type') ?? 'dxa') !== 'dxa') continue;
    const cellPt = Number(tcW.getAttribute('w:w')) / 20;
    if (!(cellPt > 0)) continue;
    // the table's own cell margins when it sets them (5.4 pt a side otherwise)
    let tbl: any = tc.parentNode;
    while (tbl && tbl.nodeName !== 'w:tbl') tbl = tbl.parentNode;
    const mar = tbl ? children(children(tbl, 'w:tblPr')[0] ?? tbl, 'w:tblCellMar')[0] : undefined;
    const side = (name: string) => { const e = mar ? children(mar, name)[0] : undefined; return e && (e.getAttribute('w:type') ?? 'dxa') === 'dxa' ? Number(e.getAttribute('w:w')) / 20 : 5.4; };
    const margins = side('w:left') + side('w:right');
    for (const p of children(tc, 'w:p')) {
      const ind = children(children(p, 'w:pPr')[0] ?? p, 'w:ind')[0];
      const indent = ind ? (Math.max(0, Number(ind.getAttribute('w:left') ?? ind.getAttribute('w:start') ?? 0)) + Math.max(0, Number(ind.getAttribute('w:right') ?? ind.getAttribute('w:end') ?? 0)) + Math.max(0, Number(ind.getAttribute('w:firstLine') ?? 0))) / 20 : 0;
      // cell margins (5.4 pt each side by default) and a little air
      const room = cellPt - margins - indent - 1;
      if (room <= 8) continue;
      let widest = Math.max(0, ...words(p, s).map((w) => w.width));
      if (widest <= room) continue;
      // a cell too narrow for the phrase takes its usual short form before any shrinking ("Not Applicable" → "N.A.")
      const whole = ownRuns(p).map(runText).join('').trim();
      const short = SHORT.find(([re]) => re.test(whole))?.[1];
      if (short) {
        const runs = ownRuns(p).filter((r) => children(r, 'w:t').length);
        runs.forEach((r, i) => children(r, 'w:t').forEach((t, j) => { t.textContent = i === 0 && j === 0 ? short : ''; }));
        widest = Math.max(0, ...words(p, s).map((w) => w.width));
        n++;
        if (widest <= room) continue;
      }
      const k = room / widest;
      for (const r of ownRuns(p)) {
        const cur = runSize(r, p, s);
        setSize(doc, r, Math.max(minPt * 2, Math.floor(cur * k)));
      }
      n++;
    }
  }
  return n;
}

/** Cover page: a long line set at 18 pt or more (the address) steps down to 16 pt, then 14 pt, when it would run
 *  past `maxLines` lines, so the cover always fits one page. Returns paragraphs changed. */
export function fitCover(doc: XDoc, s: Sizes, maxLines = 3): number {
  const body = els(doc, 'w:body')[0];
  if (!body) return 0;
  const sect = els(doc, 'w:sectPr').at(-1);
  const pg = sect ? children(sect, 'w:pgSz')[0] : undefined;
  const mar = sect ? children(sect, 'w:pgMar')[0] : undefined;
  const pagePt = ((Number(pg?.getAttribute('w:w')) || 11906) - (Number(mar?.getAttribute('w:left')) || 1440) - (Number(mar?.getAttribute('w:right')) || 1440)) / 20;
  let n = 0;
  let first = true;
  for (const node of Array.from(body.childNodes as any) as XEl[]) {
    if ((node as any).nodeType !== 1) continue;
    // the cover ends at the first page break
    if (!first && node.nodeName === 'w:p' && els(node, 'w:pageBreakBefore').length) break;
    if (node.nodeName === 'w:tbl') break;
    first = false;
    if (node.nodeName === 'w:p') {
      const runs = ownRuns(node).filter((r) => runText(r).trim());
      const big = runs.length ? Math.max(...runs.map((r) => runSize(r, node, s))) : 0;
      if (big >= 36) {
        const ind = children(children(node, 'w:pPr')[0] ?? node, 'w:ind')[0];
        const room = pagePt - (ind ? (Math.max(0, Number(ind.getAttribute('w:left') ?? 0)) + Math.max(0, Number(ind.getAttribute('w:right') ?? 0))) / 20 : 0);
        const lines = (half: number) => Math.ceil(runs.reduce((t, r) => t + textWidth(runText(r), half / 2, runBold(r)), 0) / (room * 0.94));
        const fit = [big, 32, 28].find((half) => half <= big && lines(half) <= maxLines) ?? 28;
        if (fit < big) { for (const r of ownRuns(node)) setSize(doc, r, fit); n++; }
      }
      if (els(node, 'w:br').some((b) => b.getAttribute('w:type') === 'page') || els(node, 'w:sectPr').length) break;
    }
  }
  return n;
}
