import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { borderPictureGrids, fitComparableRows, splitSingleColumnGrids } from '../src/modules/templates/grids';
import { formatValue } from '../src/modules/casedata/resolver';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const tc = (t: string, vm?: 'restart' | 'continue') => `<w:tc><w:tcPr><w:tcW w:w="100"/>${vm ? `<w:vMerge${vm === 'restart' ? ' w:val="restart"' : ''}/>` : ''}</w:tcPr>${p(t)}</w:tc>`;
const chart = () => `<w:body>${p('Rate Indicators Chart')}<w:tbl><w:tblPr/>` +
  `<w:tr>${tc('')}${tc('Source')}${tc('Rate (considered)')}</w:tr>` +
  [1, 2, 3].map((n) => `<w:tr>${tc(`Comparable ${n}`)}${tc(`⟪EVID.COMP${n}.SOURCE⟫`)}${n === 1 ? tc('⟪VAL.RATE⟫', 'restart') : tc('', 'continue')}</w:tr>`).join('') +
  `</w:tbl>${p('after')}</w:body>`;
const parse = (body: string) => new DOMParser().parseFromString(`<w:document ${W}>${body}</w:document>`, 'text/xml') as any;
const xml = (d: any) => new XMLSerializer().serializeToString(d);

describe('comparables chart (D4)', () => {
  it('drops empty rows and moves the merged rate cell to the first row that stays', () => {
    const d = parse(chart());
    expect(fitComparableRows(d, 'filled', new Set([1, 3]))).toBe(2);
    const s = xml(d);
    expect(s).not.toContain('EVID.COMP1'); expect(s).not.toContain('EVID.COMP3');
    expect(s).toContain('EVID.COMP2');
    // the adopted rate survives, now starting the merge in row 2
    expect(s).toMatch(/EVID\.COMP2\.SOURCE.*w:vMerge w:val="restart".*VAL\.RATE/);
  });
  it('keeps one row when the case has no comparables', () => {
    const d = parse(chart());
    fitComparableRows(d, 'filled', new Set([1, 2, 3, 4]));
    expect(xml(d)).toContain('EVID.COMP1'); expect(xml(d)).not.toContain('EVID.COMP2');
  });
  it('"na" keeps every row; "none" removes the table and its caption', () => {
    const a = parse(chart()); expect(fitComparableRows(a, 'na', new Set([3]))).toBe(0);
    const b = parse(chart()); fitComparableRows(b, 'none', new Set());
    expect(xml(b)).not.toContain('w:tbl'); expect(xml(b)).not.toContain('Rate Indicators'); expect(xml(b)).toContain('after');
  });
});

describe('picture grids (G2)', () => {
  const g1 = `<w:body><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr><w:tc><w:tcPr><w:tcBorders><w:top w:val="nil"/></w:tcBorders></w:tcPr>${p('⟪#rows⟫⟪%a_img⟫')}${p('⟪a_cap⟫⟪/rows⟫')}</w:tc></w:tr></w:tbl></w:body>`;
  it('a one-column grid repeats picture and caption as rows, each boxed', () => {
    const d = parse(g1);
    expect(splitSingleColumnGrids(d, '⟪%a_img⟫')).toBe(1);
    expect(borderPictureGrids(d, '⟪%a_img⟫')).toBe(1);
    const s = xml(d);
    expect(s.match(/<w:tr>/g)?.length).toBe(2);
    expect(s).toMatch(/#rows.*<\/w:tr><w:tr>.*\/rows/);
    expect(s).toContain('w:val="single"'); expect(s).not.toContain('w:val="nil"');
    expect(s).toContain('<w:cantSplit/>'); expect(s).toContain('<w:keepNext/>');
  });
});

describe('comparable amounts (G4)', () => {
  it('print in Indian format', () => { expect(formatValue('money', 18000000)).toBe('Rs. 1,80,00,000/-'); });
});
