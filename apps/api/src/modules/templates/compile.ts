// Step 6 (publish): write render tags into the bank's own Word file at every mapped slot, add the
// ValueMitra annexure pages (photos, map, ready reckoner, evidence, documents) and the letterhead,
// draft marker, page number and short signature in header/footer. The compiled file is immutable
// and pinned per assignment; rendering always uses the compiled file, never a re-drawn copy.
import type { Element as XEl } from '@xmldom/xmldom';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { children, els, openDocx, paragraphs, replaceInParagraph, saveDocx, setCellText, setParagraphText, tables, textOf, unfloatTables, W_NS, type DocxParts } from './docx.js';
import { singleField, templateKey } from './codes.js';
import type { Slot } from './detect.js';

export const OPEN = '⟪';
export const CLOSE = '⟫';
export const tag = (s: string) => `${OPEN}${s}${CLOSE}`;

export interface CompileMapping {
  slot: Slot | { key: string; kind: 'para'; location: { p: number; p_to: number } };
  fieldCode: string | null;
  fieldType: string;
  template?: string | null;     // what prints, with {{CODE}} fields; null on a paragraph range removes it
}

/** One field prints its own tag (an image field the signed / pending block); a template with fixed
 *  words or several fields prints one key the renderer fills, so empty fields leave no stray commas. */
function tagsFor(m: CompileMapping): string {
  const t = m.template ?? (m.fieldCode ? `{{${m.fieldCode}}}` : '');
  const one = singleField(t);
  if (one) return m.fieldType === 'image' && one === m.fieldCode ? imageSlot(one) : tag(one);
  return tag(templateKey(m.slot.key));
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
    const slot = m.slot as Slot;
    if (slot.kind !== 'placeholder' && slot.kind !== 'inline') continue;
    const p = ps[slot.location.p!];
    if (!p) continue;
    replaceInParagraph(p, slot.location.find!, tagsFor(m));
  }
  for (const m of mappings) {
    const slot = m.slot as Slot;
    if (slot.kind !== 'cell' && slot.kind !== 'grid') continue;
    const tc = tbls[slot.location.t!]?.rows[slot.location.r!]?.[slot.location.c!];
    if (!tc) continue;
    const labelCell = tbls[slot.location.t!].rows[slot.location.r!][Math.max(0, slot.location.c! - 1)];
    setCellText(doc, tc, tagsFor(m), labelCell);
  }
  // paragraph ranges last: rewritten (earlier case / valuer identity / section bodies) or removed
  for (const m of mappings) {
    if (m.slot.kind !== 'para') continue;
    const { p, p_to } = (m.slot as { location: { p: number; p_to: number } }).location;
    rewriteRange(doc, ps, p, p_to, m.template ? tagsFor(m) : null, !!singleField(m.template));
  }
  // unmapped placeholders would print literally; blank them
  for (const p of paragraphs(doc)) {
    for (const t of els(p, 'w:t')) {
      if (t.textContent && /\{\{\s*[A-Z][A-Z0-9_.]+\s*\}\}/.test(t.textContent)) t.textContent = t.textContent.replace(/\{\{\s*[A-Z][A-Z0-9_.]+\s*\}\}/g, '');
    }
  }

  // after every slot is written (slot indices are from the untouched document)
  unfloatTables(doc);
  addSignatureSlot(doc, mappings.filter((m) => m.slot.kind === 'para' && /\{\{\s*FIRM\.VALUER_(NAME|BLOCK)\s*\}\}/.test(m.template ?? '')).map(tagsFor));

  const body = els(doc, 'w:body')[0];
  const finalSect = children(body, 'w:sectPr')[0];
  if (layout.annexures) {
    // empty paragraphs at the end of the bank's text (space for an earlier signature) would make a blank page
    for (let n: any = finalSect ? finalSect.previousSibling : body.lastChild; n; ) {
      const prev = n.previousSibling;
      if (n.nodeType === 1 && n.nodeName === 'w:p' && !els(n, 'w:t').some((t) => (t.textContent ?? '').trim()) && !els(n, 'w:drawing').length && !els(n, 'w:sectPr').length) body.removeChild(n);
      else if (n.nodeType === 1) break;
      n = prev;
    }
    const frag = new DOMParser().parseFromString(`<root xmlns:w="${W_NS}">${annexXml()}</root>`, 'text/xml');
    for (const n of Array.from(frag.documentElement!.childNodes as any) as any[]) {
      const imported = (doc as any).importNode(n, true);
      if (finalSect) body.insertBefore(imported, finalSect);
      else body.appendChild(imported);
    }
  }

  addHeaderFooter(parts, layout);
  dropUnusedImages(parts);
  scrubAuthor(parts);
  return saveDocx(parts);
}

/** Paragraphs from..to: the first gets `text` (null removes it too); body-level elements between go.
 *  A single field (remarks, a text section) brings its own numbering and lines: list numbering and
 *  justification of the bank's paragraph would double the numbers and stretch the lines. */
function rewriteRange(doc: any, ps: XEl[], from: number, to: number, text: string | null, single = false) {
  const first = ps[from];
  const last = ps[to] ?? first;
  if (!first) return;
  const body = els(doc, 'w:body')[0];
  let targets: XEl[];
  if (first.parentNode === body && last.parentNode === body) {
    targets = [];
    for (let n: any = first; n; n = n.nextSibling) {
      if (n.nodeType === 1) targets.push(n);
      if (n === last) break;
    }
  } else targets = ps.slice(from, to + 1).filter(Boolean);
  targets.forEach((n, i) => {
    if (i === 0 && text !== null) {
      // the earlier valuer's highlight (text they filled in) would mark this case's value
      els(n as any, 'w:highlight').forEach((h) => h.parentNode?.removeChild(h));
      if (single) {
        const pPr = children(n as any, 'w:pPr')[0];
        if (pPr) {
          children(pPr, 'w:numPr').forEach((x) => pPr.removeChild(x));
          children(pPr, 'w:jc').forEach((x) => { if (x.getAttribute('w:val') === 'both') x.setAttribute('w:val', 'left'); });
        }
      }
      return setParagraphText(doc, n as any, text);
    }
    // a paragraph carrying section properties (page size, orientation) stays, emptied
    if (n.nodeName === 'w:p' && els(n, 'w:sectPr').length) {
      for (const c of Array.from(n.childNodes as any) as any[]) if (c.nodeName !== 'w:pPr') n.removeChild(c);
      return;
    }
    n.parentNode?.removeChild(n);
  });
}

/**
 * A format read from a filled report keeps empty lines where the earlier valuer signed. When it has no
 * signature slot, one goes above the valuer's block (the tags in `blockTags`), replacing those lines and
 * kept on the same page as the block. Returns whether it was added.
 */
export function addSignatureSlot(doc: any, blockTags: string[]): boolean {
  if (!blockTags.length) return false;
  const ps = paragraphs(doc);
  if (ps.some((p) => textOf(p).includes(tag('%REPORT.SIGNATURE')))) return false;
  const block = ps.find((p) => blockTags.some((t) => textOf(p).includes(t)));
  if (!block) return false;
  const empty = (n: any) => n?.nodeType === 1 && n.nodeName === 'w:p' && !textOf(n).trim() && !els(n, 'w:drawing').length && !els(n, 'w:sectPr').length;
  for (let k = 0, n: any = block.previousSibling; k < 6 && n; k++) {
    while (n && n.nodeType !== 1) n = n.previousSibling;
    if (!empty(n)) break;
    const prev = n.previousSibling;
    n.parentNode.removeChild(n);
    n = prev;
  }
  const sig = new DOMParser().parseFromString(`<root xmlns:w="${W_NS}">${para(imageSlot('REPORT.SIGNATURE').split(/(?=⟪)/).map((t) => run(t)).join(''), '<w:keepNext/><w:spacing w:before="240" w:after="0"/>')}</root>`, 'text/xml').documentElement!.firstChild;
  block.parentNode!.insertBefore((doc as any).importNode(sig, true), block);
  return true;
}

/** Images no longer referenced (an earlier case's photos and maps) leave the package entirely. */
function dropUnusedImages(parts: DocxParts) {
  const relPath = 'word/_rels/document.xml.rels';
  const relXml = parts.zip.file(relPath)?.asText();
  if (!relXml) return;
  const used = new Set([...new XMLSerializer().serializeToString(parts.doc as any).matchAll(/r:(?:embed|id|link|pict)="([^"]+)"/g)].map((m) => m[1]));
  const rels = new DOMParser().parseFromString(relXml, 'text/xml');
  const all = Array.from(rels.getElementsByTagName('Relationship') as any) as XEl[];
  for (const r of all) {
    if (!/\/image$/.test(r.getAttribute('Type') ?? '') || used.has(r.getAttribute('Id') ?? '')) continue;
    const target = r.getAttribute('Target') ?? '';
    const stillUsed = all.some((o) => o !== r && o.parentNode && o.getAttribute('Target') === target);
    if (!stillUsed && r.getAttribute('TargetMode') !== 'External') parts.zip.remove(`word/${target.replace(/^\//, '').replace(/^word\//, '')}`);
    r.parentNode?.removeChild(r);
  }
  parts.zip.file(relPath, new XMLSerializer().serializeToString(rels as any));
}

/** The file's author fields would name whoever saved the bank's sample. */
function scrubAuthor(parts: DocxParts) {
  const core = parts.zip.file('docProps/core.xml')?.asText();
  if (core) parts.zip.file('docProps/core.xml', core.replace(/(<dc:creator>|<cp:lastModifiedBy>)[^<]*(<\/)/g, '$1$2'));
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
const FOOTER_SIG_PARA = para(`${tr('#SIGNED')}${tr('%MINI_SIG')}${tr('/SIGNED')}`, '<w:spacing w:after="0"/><w:jc w:val="right"/>');
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
  // the bank's footer may number pages itself: then add only the short signature
  const numbered = /PAGE\b/.test(xml.replace(/<w:t[^>]*>[^<]*<\/w:t>/g, ''));
  parts.zip.file(path, xml.replace(/<\/w:ftr>\s*$/, `${numbered ? FOOTER_SIG_PARA : FOOTER_PARA}</w:ftr>`));
}
