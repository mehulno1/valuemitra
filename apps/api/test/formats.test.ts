import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { els, regridTables, replaceKeepingRuns, textOf } from '../src/modules/templates/docx';
import { reportSeries } from '../src/platform/sequences';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = (body: string) => new DOMParser().parseFromString(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, 'text/xml') as any;

describe('placeholders keep the formatting around them', () => {
  it('splits a run: before | tag | after, each keeping its run format', () => {
    const doc = parse('<w:p><w:r><w:t>is </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Rs. {{x}}/- (words)</w:t></w:r></w:p>');
    const p = els(doc, 'w:p')[0];
    expect(replaceKeepingRuns(doc, p, 'Rs. {{x}}/-', '⟪VAL.FMV⟫')).toBe(true);
    expect(textOf(p)).toBe('is ⟪VAL.FMV⟫ (words)');
    const runs = els(p, 'w:r');
    const tagRun = runs.find((r) => textOf(r) === '⟪VAL.FMV⟫')!;
    expect(els(tagRun, 'w:b').length).toBe(1);
    expect(textOf(runs[0])).toBe('is ');
  });
  it('joins a tag split across runs', () => {
    const doc = parse('<w:p><w:r><w:t>A {{CUST.</w:t></w:r><w:r><w:t>NAME}} B</w:t></w:r></w:p>');
    const p = els(doc, 'w:p')[0];
    replaceKeepingRuns(doc, p, '{{CUST.NAME}}', '⟪CUST.NAME⟫');
    expect(textOf(p)).toBe('A ⟪CUST.NAME⟫ B');
  });
});

describe('table grid from cell widths', () => {
  it('rebuilds columns so each cell spans its own width', () => {
    const tc = (w: number, span?: number) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr><w:p/></w:tc>`;
    const doc = parse(`<w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/><w:gridCol w:w="100"/><w:gridCol w:w="900"/></w:tblGrid><w:tr>${tc(500)}${tc(1000, 3)}</w:tr><w:tr>${tc(500)}${tc(400)}${tc(600)}</w:tr></w:tbl>`);
    expect(regridTables(doc)).toBe(1);
    const xml = new XMLSerializer().serializeToString(doc);
    expect([...xml.matchAll(/gridCol w:w="(\d+)"/g)].map((m) => m[1])).toEqual(['500', '400', '600']);
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
  });
});

describe('report series', () => {
  it('runs on across years when the pattern has no year', () => {
    expect(reportSeries('{FIRM}/{BANK}/{N}', '26-27')).toBe('ALL');
    expect(reportSeries('{FIRM}/{BANK}/{FY}/{N}', '26-27')).toBe('26-27');
  });
});
