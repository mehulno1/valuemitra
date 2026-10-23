// Step 6 (publish): write render tags into the bank's own Word file at every mapped slot, add the
// ValueMitra annexure pages (photos, map, ready reckoner, evidence, documents) and the letterhead,
// draft marker, page number and short signature in header/footer. The compiled file is immutable
// and pinned per assignment; rendering always uses the compiled file, never a re-drawn copy.
import type { Element as XEl } from '@xmldom/xmldom';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { children, els, openDocx, paragraphs, replaceInParagraph, saveDocx, setCellText, tables, W_NS } from './docx.js';
import type { Slot } from './detect.js';

export const OPEN = '⟪';
export const CLOSE = '⟫';
export const tag = (s: string) => `${OPEN}${s}${CLOSE}`;

export interface CompileMapping {
  slot: Slot;
  fieldCode: string;
  fieldType: string;
}

export interface Layout {
  cover_first_page: boolean;   // page 1 is a cover: letterhead but no page number / short signature
  annexures: boolean;          // append ValueMitra annexure pages
}

const imageSlot = (code: string) =>
  `${tag('#SIGNED')}${tag(`%${code}`)}${tag('/SIGNED')}${tag('^SIGNED')}${tag('SIGN_PENDING')}${tag('/SIGNED')}`;

export function compileTemplate(source: Buffer, mappings: CompileMapping[], layout: Layout): Buffer {
  const parts = openDocx(source);
  const { doc, zip } = parts;
  const tbls = tables(doc);
  const ps = paragraphs(doc);

  // placeholders and inline blanks first (paragraph indices are from the untouched document)
  for (const m of mappings) {
    const { slot } = m;
    if (slot.kind !== 'placeholder' && slot.kind !== 'inline') continue;
    const p = ps[slot.location.p!];
    if (!p) continue;
    const t = m.fieldType === 'image' ? imageSlot(m.fieldCode) : tag(m.fieldCode);
    replaceInParagraph(p, slot.location.find!, t);
  }
  for (const m of mappings) {
    const { slot } = m;
    if (slot.kind !== 'cell' && slot.kind !== 'grid') continue;
    const tc = tbls[slot.location.t!]?.rows[slot.location.r!]?.[slot.location.c!];
    if (!tc) continue;
    const labelCell = tbls[slot.location.t!].rows[slot.location.r!][Math.max(0, slot.location.c! - 1)];
    setCellText(doc, tc, m.fieldType === 'image' ? imageSlot(m.fieldCode) : tag(m.fieldCode), labelCell);
  }
  // unmapped placeholders would print literally; blank them
  for (const p of paragraphs(doc)) {
    for (const t of els(p, 'w:t')) {
      if (t.textContent && /\{\{\s*[A-Z][A-Z0-9_.]+\s*\}\}/.test(t.textContent)) t.textContent = t.textContent.replace(/\{\{\s*[A-Z][A-Z0-9_.]+\s*\}\}/g, '');
    }
  }

  const body = els(doc, 'w:body')[0];
  const finalSect = children(body, 'w:sectPr')[0];
  if (layout.annexures) {
    const frag = new DOMParser().parseFromString(`<root xmlns:w="${W_NS}">${annexXml()}</root>`, 'text/xml');
    for (const n of Array.from(frag.documentElement!.childNodes as any) as any[]) {
      const imported = (doc as any).importNode(n, true);
      if (finalSect) body.insertBefore(imported, finalSect);
      else body.appendChild(imported);
    }
  }

  addHeaderFooter(parts, layout);
  return saveDocx(parts);
}

// ---------------------------------------------------------------------------------------------
// Annexure pages: one loop of pages; each page holds a 3-, 2- or 1-column grid of images.

const tr = (name: string) => run(tag(name));
const run = (text: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
const cellXml = (inner: string, widthPct: number) =>
  `<w:tc><w:tcPr><w:tcW w:w="${Math.round(widthPct * 50)}" w:type="pct"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${inner}</w:tc>`;

function gridTable(cols: number) {
  const letters = ['a', 'b', 'c'].slice(0, cols);
  const w = 100 / cols;
  const cells = letters
    .map((l, i) =>
      cellXml(
        para(`${i === 0 ? tr('#rows') : ''}${tr(`%${l}_img`)}`, '<w:spacing w:after="0"/><w:jc w:val="center"/>') +
          para(run(tag(`${l}_cap`), '<w:sz w:val="18"/>') + (i === cols - 1 ? tr('/rows') : ''), '<w:spacing w:after="120"/><w:jc w:val="center"/>'),
        w,
      ),
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${letters.map(() => `<w:gridCol w:w="${Math.round(9638 / cols)}"/>`).join('')}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
}

function annexXml() {
  return [
    para(tr('#ANNEX_PAGES')),
    // "page break before" on the title, not a break paragraph: a full page never leaves a blank page behind it
    para(run(tag('title'), '<w:b/><w:sz w:val="24"/><w:u w:val="single"/>'), '<w:pageBreakBefore/><w:spacing w:after="120"/><w:jc w:val="center"/>'),
    para(run(tag('note'), '<w:sz w:val="20"/>'), '<w:spacing w:after="120"/><w:jc w:val="center"/>'),
    para(tr('#g3')), gridTable(3), para(tr('/g3')),
    para(tr('#g2')), gridTable(2), para(tr('/g2')),
    para(tr('#g1')), gridTable(1), para(tr('/g1')),
    para(tr('/ANNEX_PAGES')),
  ].join('');
}

// ---------------------------------------------------------------------------------------------
// Header (letterhead + draft marker) and footer (page number + short signature and seal).

const REL_HEADER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const REL_FOOTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const CT_HEADER = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const CT_FOOTER = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const NS_DECL = [
  `xmlns:w="${W_NS}"`,
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

// Each condition tag sits alone in its paragraph, so the paragraph loop drops the unused block whole
// (an inline `%%` centred image beside condition tags nests a paragraph inside a run: Word refuses it).
export const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS_DECL}>${[
  para(tr('#HAS_LETTERHEAD')),
  para(tr('%LETTERHEAD'), '<w:spacing w:after="0"/><w:jc w:val="center"/>'),
  para(tr('/HAS_LETTERHEAD')),
  para(tr('^HAS_LETTERHEAD')),
  para(run(tag('FIRM_LINE'), '<w:b/><w:sz w:val="24"/>'), '<w:spacing w:after="0"/>'),
  para(run(tag('FIRM_SUB'), '<w:sz w:val="16"/>'), '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="111111"/></w:pBdr><w:spacing w:after="120"/>'),
  para(tr('/HAS_LETTERHEAD')),
  para(`${tr('#IS_DRAFT')}${run(tag('DRAFT_LINE'), '<w:b/><w:color w:val="9A9A9A"/><w:sz w:val="16"/>')}${tr('/IS_DRAFT')}`, '<w:spacing w:after="0"/><w:jc w:val="right"/>'),
].join('')}</w:hdr>`;

const FOOTER_PARA = para(
  `${tr('#SIGNED')}${tr('%MINI_SIG')}${run('  ')}${tr('/SIGNED')}${run('Page ', '<w:sz w:val="18"/>')}<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>`,
  '<w:spacing w:after="0"/><w:jc w:val="right"/>',
);
const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS_DECL}>${FOOTER_PARA}</w:ftr>`;
const EMPTY_FTR = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS_DECL}><w:p/></w:ftr>`;

function addHeaderFooter(parts: ReturnType<typeof openDocx>, layout: Layout) {
  const { zip, doc } = parts;
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = new DOMParser().parseFromString(zip.file(relsPath)!.asText(), 'text/xml');
  const ct = new DOMParser().parseFromString(zip.file('[Content_Types].xml')!.asText(), 'text/xml');
  const relRoot = rels.documentElement!;
  let n = 900;
  const addPart = (name: string, xml: string, type: 'header' | 'footer') => {
    zip.file(`word/${name}`, xml);
    const id = `rIdVm${n++}`;
    const r = rels.createElement('Relationship');
    r.setAttribute('Id', id);
    r.setAttribute('Type', type === 'header' ? REL_HEADER : REL_FOOTER);
    r.setAttribute('Target', name);
    relRoot.appendChild(r);
    const o = ct.createElement('Override');
    o.setAttribute('PartName', `/word/${name}`);
    o.setAttribute('ContentType', type === 'header' ? CT_HEADER : CT_FOOTER);
    ct.documentElement!.appendChild(o);
    return id;
  };

  const sects = els(doc, 'w:sectPr');
  sects.forEach((sp, i) => {
    const hasHeader = children(sp, 'w:headerReference').some((h) => h.getAttribute('w:type') === 'default');
    const hasFooter = children(sp, 'w:footerReference').some((h) => h.getAttribute('w:type') === 'default');
    const ref = (tagName: string, type: string, id: string) => {
      const e = doc.createElementNS(W_NS, tagName) as XEl;
      e.setAttribute('w:type', type);
      e.setAttribute('r:id', id);
      sp.insertBefore(e, sp.firstChild);
    };
    if (!hasHeader) ref('w:headerReference', 'default', addPart(`header90${i}.xml`, HEADER_XML, 'header'));
    if (!hasFooter) ref('w:footerReference', 'default', addPart(`footer90${i}.xml`, FOOTER_XML, 'footer'));
    else appendToExistingFooter(parts, rels, sp);
    if (layout.cover_first_page && i === 0) {
      ref('w:headerReference', 'first', addPart(`header99.xml`, HEADER_XML, 'header'));
      ref('w:footerReference', 'first', addPart(`footer99.xml`, EMPTY_FTR, 'footer'));
      if (!children(sp, 'w:titlePg').length) {
        const tp = doc.createElementNS(W_NS, 'w:titlePg');
        // titlePg must come after pgMar/cols etc.; appending at the end is schema-valid enough for Word & LibreOffice
        sp.appendChild(tp);
      }
    }
  });
  zip.file(relsPath, new XMLSerializer().serializeToString(rels));
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(ct));
}

function appendToExistingFooter(parts: ReturnType<typeof openDocx>, rels: any, sp: XEl) {
  const fr = children(sp, 'w:footerReference').find((h) => h.getAttribute('w:type') === 'default');
  const id = fr?.getAttribute('r:id');
  const rel = Array.from(rels.getElementsByTagName('Relationship') as any[]).find((r: any) => r.getAttribute('Id') === id);
  if (!rel) return;
  const path = `word/${rel.getAttribute('Target')}`;
  const xml = parts.zip.file(path)?.asText();
  if (!xml) return;
  parts.zip.file(path, xml.replace(/<\/w:ftr>\s*$/, `${FOOTER_PARA}</w:ftr>`));
}
