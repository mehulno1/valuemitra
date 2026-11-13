// Universal's second retest of 12 Nov 2026 (T1–T12, D1–D10, R1–R11).
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import PizZip from 'pizzip';
import { EXPR_FNS, formatValue, listingSite, workPct } from '../src/modules/casedata/resolver';
import { otherProperty, ranked, regNo, unitNo } from '../src/modules/documents/reader';
import { compileTemplate } from '../src/modules/templates/compile';
import { detectSlots } from '../src/modules/templates/detect';
import { els, openDocx, textOf } from '../src/modules/templates/docx';
import { fitCells, fitCover, styleSizes, textWidth } from '../src/modules/templates/fit';
import { fontReport, recommendedFonts, tightenChart } from '../src/modules/templates/fonts';
import { renderDocx } from '../src/modules/templates/render';
import { RULE_SET } from '../src/seed/config';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = (body: string) => new DOMParser().parseFromString(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, 'text/xml') as any;
const run = (t: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (t: string, rPr = '') => `<w:p>${run(t, rPr)}</w:p>`;
const cell = (w: number, inner: string) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;

function docx(body: string, styles = ''): Buffer {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);
  if (styles) zip.file('word/styles.xml', styles);
  return zip.generate({ type: 'nodebuffer' });
}

describe('% of work completed (T5)', () => {
  const weights = RULE_SET.defaults.work_weights;
  it("reproduces Universal's working sheet: 63.08% → 65%", () => {
    // Percentage of work done tab: 35 floors; slabs 27, brick 25, plaster 22, tiling 13, electrical 22, plumbing 22; terrace done
    const done: Record<string, number> = { excavation: 100, plinth: 100, podium: 100, stilt: 100, slabs: (27 / 35) * 100, brickwork: (25 / 35) * 100, plaster: (22 / 35) * 100, waterproofing: 0, tiling: (13 / 35) * 100, doors: 0, electrical: (22 / 35) * 100, plumbing: (22 / 35) * 100, staircases: 0, terrace: 100, services: 0, handover: 0 };
    const w = workPct(Object.entries(done).map(([key, pct]) => ({ key, pct })), weights, 5)!;
    expect(w.raw).toBeCloseTo(63.08, 1);
    expect(w.pct).toBe(65);
    expect(w.rows).toHaveLength(16);
  });
  it('weights add up to 100 and halves round up', () => {
    expect(weights.reduce((t, x) => t + x.weight, 0)).toBe(100);
    const two = [{ key: 'a', label: 'A', weight: 1 }, { key: 'b', label: 'B', weight: 1 }];
    expect(workPct([{ key: 'a', pct: 100 }, { key: 'b', pct: 25 }], two, 5)!.pct).toBe(65); // 62.5 → 65
    expect(workPct([{ key: 'a', pct: 100 }, { key: 'b', pct: 24 }], two, 5)!.pct).toBe(60); // 62 → 60
    expect(workPct('[{"key":"a","pct":100},{"key":"b","pct":100}]', two, 5)!.pct).toBe(100);
  });
  it('is not worked out until a stage is known', () => {
    expect(workPct(null, weights, 5)).toBeNull();
    expect(workPct('not json', weights, 5)).toBeNull();
    expect(EXPR_FNS.work_pct([{ key: 'slabs', pct: 50 }], weights, 5)).toBe(20);
  });
});

describe('small rules', () => {
  it('rooms follow the configuration (R4)', () => {
    expect(EXPR_FNS.bhk('2 BHK')).toBe(2);
    expect(EXPR_FNS.bhk('02 BHK type flat')).toBe(2);
    expect(EXPR_FNS.bhk('1.5 BHK')).toBe(1);
    expect(EXPR_FNS.bhk('Shop')).toBeNull();
    expect(EXPR_FNS.pad2(2)).toBe('02');
    expect(EXPR_FNS.pad2(null)).toBeNull();
  });
  it('the station is named once in the location sentence (N2)', () => {
    expect(EXPR_FNS.station_name('Thane railway station, 2.5 km; bus stop TMC office, 100 m')).toBe('Thane');
    expect(EXPR_FNS.station_name('Kalwa')).toBe('Kalwa');
    expect(EXPR_FNS.station_name('Thane Station (2.5 km)')).toBe('Thane');
  });
  it('a date read into a text field prints as DD/MM/YYYY (N5, D6)', () => {
    expect(formatValue('text', '2026-12-31')).toBe('31/12/2026');
    expect(formatValue('text', 'Building is Completed as per O.C')).toBe('Building is Completed as per O.C');
  });
  it('a listing is cited by its website, never its id (T11)', () => {
    expect(listingSite({ source_ref: 'PS1700016394', capture_source: '99acres' })).toBe('99acres');
    expect(listingSite({ source_ref: '9726072', capture_url: 'https://www.housing.com/in/buy/x/9726072' })).toBe('housing.com');
    expect(listingSite({ source_ref: 'Housing.com' })).toBe('Housing.com');
    expect(listingSite({ source_ref: 'PS1700016394' })).toBe('Listing');
  });
});

describe('several dated entries in one document (T2: latest C.C. endorsement)', () => {
  it('uses rank 1 and keeps the earlier ones beside it', () => {
    const out = ranked([
      { field_code: 'DOC.CC.NUMBER', value: 'SRA/ENG/016/Sec-2/PVT/AP', rank: 2 },
      { field_code: 'DOC.CC.NUMBER', value: 'V.P.No.S2T/0018/14', rank: 1 },
      { field_code: 'DOC.CC.DATE', value: '2018-10-29', rank: 2 },
      { field_code: 'DOC.CC.DATE', value: '2024-10-29', rank: 1 },
      { field_code: 'DOC.CC.AUTHORITY', value: 'SRA', rank: null },
    ]);
    const num = out.filter((v) => v.field_code === 'DOC.CC.NUMBER');
    expect(num.map((v) => [v.value, v.chosen, v.keep])).toEqual([['V.P.No.S2T/0018/14', true, false], ['SRA/ENG/016/Sec-2/PVT/AP', false, true]]);
    const auth = out.find((v) => v.field_code === 'DOC.CC.AUTHORITY')!;
    expect(auth.keep).toBeUndefined();
    expect(auth.chosen).toBeUndefined();
  });
  it('the same value twice is one reading', () => {
    expect(ranked([{ field_code: 'X.Y', value: 'A', rank: 1 }, { field_code: 'X.Y', value: 'a ', rank: 2 }])).toHaveLength(1);
  });
});

describe('text fitted to its space (D3, D4, T8)', () => {
  const sizes = styleSizes(undefined);
  it('measures Times New Roman', () => {
    expect(textWidth('180000000', 9)).toBeCloseTo(40.5, 1);
    expect(textWidth('Comparable 3', 9, true)).toBeGreaterThan(textWidth('Comparable 3', 9));
  });
  it('never breaks a number: the cell text shrinks until it fits', () => {
    const doc = parse(`<w:tbl><w:tr>${cell(1000, para('180000000', '<w:sz w:val="22"/>'))}${cell(3000, para('Flat at Mehta Legend 1978', '<w:sz w:val="22"/>'))}</w:tr></w:tbl>`);
    expect(fitCells(doc, sizes)).toBe(1);
    const [narrow, wide] = els(doc, 'w:tc');
    const sz = Number(els(narrow, 'w:sz')[0].getAttribute('w:val'));
    expect(sz).toBeLessThan(22);
    expect(textWidth('180000000', sz / 2)).toBeLessThanOrEqual(1000 / 20 - 10.8);
    expect(els(wide, 'w:sz')[0].getAttribute('w:val')).toBe('22');
  });
  it('a phrase takes its short form in a cell too narrow for it', () => {
    const doc = parse(`<w:tbl><w:tr>${cell(660, para('Not Applicable', '<w:sz w:val="20"/>'))}</w:tr></w:tbl>`);
    fitCells(doc, sizes);
    expect(textOf(els(doc, 'w:tc')[0])).toBe('N.A.');
    expect(els(doc, 'w:sz')[0].getAttribute('w:val')).toBe('20');
  });
  it('the cover address steps down to 16 pt, then 14 pt', () => {
    const long = 'Residential Flat No. 3107, 31st Floor, Wing B, Building No. 2, Skyline Heights, Rehab cum Sale Scheme of Shree Ganesh Krupa S.R.A. Co-operative Housing Society Limited, Near Cadbury Junction, Eastern Express Highway, C.T.S. No. 1244, 1244/1 to 54, 1245, 1246/A and 1247 of Village Panchpakhadi, Khopat, Taluka & District Thane, Thane (West)-400 601';
    const doc = parse(`${para('VALUATION REPORT', '<w:b/><w:sz w:val="40"/>')}${para(long, '<w:b/><w:sz w:val="40"/>')}${para('Flat No. 603, Kavesar, Thane', '<w:b/><w:sz w:val="40"/>')}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${para(long, '<w:sz w:val="40"/>')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="720" w:right="707"/></w:sectPr>`);
    expect(fitCover(doc, sizes)).toBe(1);
    const sz = els(doc, 'w:p').map((p) => els(p, 'w:sz')[0]?.getAttribute('w:val'));
    expect(sz[0]).toBe('40');           // the title
    expect(sz[1]).toBe('28');           // the long address
    expect(sz[2]).toBe('40');           // a short address keeps 20 pt
    expect(sz[4]).toBe('40');           // after the cover: untouched
  });
});

describe('recommended fonts (T7, T9, T11)', () => {
  it('sets Times New Roman, body 11 pt, tables 10 pt, and keeps headings', () => {
    const parts = openDocx(docx(
      `${para('Heading', '<w:rFonts w:asciiTheme="minorHAnsi"/><w:b/><w:sz w:val="28"/>')}${para('Body text', '<w:rFonts w:ascii="Calibri"/><w:sz w:val="24"/>')}<w:tbl><w:tr>${cell(3000, para('Cell'))}</w:tr></w:tbl>`,
      '<w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    ));
    expect(fontReport(parts).reason).toMatch(/Calibri/);
    recommendedFonts(parts);
    const xml = String(parts.doc);
    expect(xml).not.toMatch(/Calibri|asciiTheme/);
    const [h, b, c] = els(parts.doc, 'w:r');
    expect(els(h, 'w:sz')[0].getAttribute('w:val')).toBe('28');
    expect(els(b, 'w:sz')[0].getAttribute('w:val')).toBe('22');
    expect(els(c, 'w:sz')[0].getAttribute('w:val')).toBe('20');
    expect(els(c, 'w:rFonts')[0].getAttribute('w:ascii')).toBe('Times New Roman');
    expect(parts.zip.file('word/styles.xml')!.asText()).toContain('w:ascii="Times New Roman"');
  });
  it('a file already in Times New Roman keeps its fonts', () => {
    expect(fontReport(openDocx(docx(para('Text', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>')))).reason).toBeNull();
  });
  it('the rate chart: 9 pt, bold headings only, fixed widths', () => {
    const head = ['', 'Source', 'Property Description', 'Value (Rs)', 'Carpet Area', 'Rate per sq.ft', 'Rate considered'].map((t) => cell(900, para(t, '<w:b/>'))).join('');
    const row1 = ['Comparable 1', '99acres', 'Flat at X', '9000000', '440', '20,455', 'Rs. 19,600/-'].map((t) => cell(900, para(t, '<w:b/>'))).join('');
    const doc = parse(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid/><w:tr>${head}</w:tr><w:tr>${row1}</w:tr></w:tbl>`);
    expect(tightenChart(doc, 10000)).toBe(1);
    const rows = els(doc, 'w:tr');
    expect(els(rows[0], 'w:b').length).toBe(7);
    expect(els(rows[1], 'w:b').length).toBe(0);
    expect(els(doc, 'w:sz').every((s) => s.getAttribute('w:val') === '18')).toBe(true);
    expect(els(doc, 'w:tblLayout')[0].getAttribute('w:type')).toBe('fixed');
    expect(els(doc, 'w:gridCol').reduce((t, g) => t + Number(g.getAttribute('w:w')), 0)).toBe(10000);
  });
});

describe('lines and rows printed only when a field says so (T6, T12)', () => {
  const body = `${para('Agreement dated {{DOC.AGREEMENT.DATE}}')}<w:p>${run('{{?DOC.TITLE.SUMMARY}}')}${run('Title Report dated {{DOC.TITLE.DATE}}.')}</w:p>${para('RERA Certificate')}`
    + `<w:tbl><w:tr>${cell(4000, para('Say'))}${cell(3000, para('{{VAL.FMV}}'))}</w:tr><w:tr>${cell(4000, `<w:p>${run('{{?row VAL.PRINT_PRESENT}}')}${run('As per current stage the value of property is')}</w:p>`)}${cell(3000, para('{{VAL.PRESENT_VALUE}}'))}</w:tr></w:tbl>`;
  const src = docx(body);
  const { slots } = detectSlots(src);
  const mappings = slots.map((s) => ({ slot: s, fieldCode: s.explicitCode!, fieldType: 'text' }));
  const compiled = compileTemplate(src, mappings, { cover_first_page: false, annexures: false, letterhead: 'none', footer_sig: false });
  const text = (data: Record<string, unknown>) => textOf(els(openDocx(renderDocx(compiled, { IS_DRAFT: false, ...data }, new Map())).doc, 'w:body')[0]);

  it('finds the conditions as slots of their own', () => {
    const conds = slots.filter((s) => s.location.cond);
    expect(conds.map((s) => [s.explicitCode, s.location.cond])).toEqual([['DOC.TITLE.SUMMARY', 'para'], ['VAL.PRINT_PRESENT', 'row']]);
  });
  it('drops the title report line and the value-today row when off', () => {
    const t = text({ 'DOC.AGREEMENT.DATE': '28/10/2026', 'VAL.FMV': 'Rs. 100/-', 'IF.DOC.TITLE.SUMMARY': false, 'IF.VAL.PRINT_PRESENT': false });
    expect(t).toContain('Agreement dated 28/10/2026');
    expect(t).not.toContain('Title Report');
    expect(t).not.toContain('As per current stage');
    expect(t).toContain('Rs. 100/-');
    expect(t).not.toMatch(/\{\{|⟪/);
  });
  it('prints both when on', () => {
    const t = text({ 'DOC.TITLE.DATE': '16/09/2023', 'VAL.PRESENT_VALUE': 'Rs. 60/-', 'IF.DOC.TITLE.SUMMARY': true, 'IF.VAL.PRINT_PRESENT': true });
    expect(t).toContain('Title Report dated 16/09/2023.');
    expect(t).toContain('As per current stage the value of property is');
    expect(t).toContain('Rs. 60/-');
  });
});

describe("an Index II of another flat is a comparable, the property's own never is (R6)", () => {
  const f = (unit: string, reg: string, building = '', buyer: string[] = []) => ({ unit: unitNo(unit), reg: regNo(reg), building, buyer: new Set(buyer) });
  it('reads flat and registration numbers however they are written', () => {
    expect(unitNo('B-2303')).toBe('2303');
    expect(unitNo('Flat 1001, 10th floor')).toBe('1001');
    expect(unitNo('3102, 31st floor')).toBe('3102');
    expect(regNo('TNN2/11700/2021')).toBe('11700/2021');
    expect(regNo('THN1-13802-2026')).toBe('13802/2026');
    expect(regNo('6863/2024')).toBe('6863/2024');
  });
  it('the same flat with a wing letter, or the same registration, is the property itself', () => {
    expect(otherProperty(f('2303', '11700/2021'), f('B-2303', 'TNN2/11700/2021'))).toBe(false);
    expect(otherProperty(f('Flat 1001, 10th floor', 'THN1-13802-2026'), f('Flat 1001, 10th floor', 'THN1-13802-2026'))).toBe(false);
    expect(otherProperty(f('', '11700/2021'), f('2303', 'TNN2/11700/2021'))).toBe(false);
    expect(otherProperty(f('2303', ''), f('B-2303', ''))).toBe(false);
  });
  it('another flat or another registration of another flat is a comparable', () => {
    expect(otherProperty(f('3102, 31st floor', '6863/2024'), f('Flat 1001, 10th floor', 'THN1-13802-2026'))).toBe(true);
    expect(otherProperty(f('3102', ''), f('1001', ''))).toBe(true);
    // an earlier registration of the same flat is not another property (it is the previous Index II)
    expect(otherProperty(f('1001', '4411/2019'), f('1001', '13802/2026'))).toBe(false);
    expect(otherProperty(f('', '', 's2', ['patil']), f('', '', 's1', ['sharma']))).toBe(true);
    expect(otherProperty(f('', '', '', []), f('1001', '13802/2026'))).toBe(false);
  });
});
