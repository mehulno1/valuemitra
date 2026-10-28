import { describe, expect, it } from 'vitest';
import { check } from '../src/modules/templates/aiconvert';
import { fillTemplate, singleField, templateCodes } from '../src/modules/templates/codes';
import { DOMParser } from '@xmldom/xmldom';
import { unfloatTables } from '../src/modules/templates/docx';

const fields = new Map<string, any>([['VAL.RENT', { type: 'money' }], ['AREA.BUA', { type: 'area' }], ['CUST.NAME', { type: 'text' }], ['CASE.BRANCH_NAME', { type: 'text' }], ['REPORT.REMARKS', { type: 'longtext' }], ['REPORT.REMARK_6', { type: 'longtext' }]]);
const o = { text: '', cells: new Map([['t0r0c1', ''], ['t0r1c1', 'old value'], ['t0r2c1', '']]), paras: new Map([[5, 'Ref: XYZ/123'], [6, ''], [7, 'remark'], [8, 'Area as per agreement']]), order: new Map([['t0r0c1', 1], ['t0r1c1', 2], ['t0r2c1', 3], ['p5', 0]]) };
const cell = (id: string, template: string | null, status = 'match') => ({ cell: id, section: 'S', question: id, status, template, confidence: 90, note: null, ask: null });
const ctx = { o: o as any, fields, bank: 'NKGSB', sources: new Set(['manual', 'site_sheet', 'seven_twelve']), groups: ['PROP', 'VAL'] };

describe('AI format answer is checked', () => {
  const r = check({
    summary: { title: 'x', filled_report: true },
    cells: [cell('t0r0c1', '₹{{VAL.RENT}}/- per month'), cell('t0r1c1', '{{AREA.BUA}} sq.ft.'), cell('t9r9c9', '{{CUST.NAME}}'), cell('t0r2c1', '{{CROPS}}', 'new'), cell('t0r0c1', '{{CUST.NAME}}')],
    paragraphs: [
      { from: 'p5', to: 'p5', kind: 'earlier_case', label: 'Ref', section: 'H', template: 'Ref: {{CASE.REPORT_NO}}', confidence: 95, note: null },
      { from: 'p6', to: 'p7', kind: 'earlier_case', label: 'Remarks', section: 'H', template: '{{REPORT.REMARKS}}', confidence: 95, note: null },
      { from: 'p7', to: 'p7', kind: 'annexure', label: 'overlap', section: 'H', template: null, confidence: 95, note: null },
      { from: 'p8', to: 'p8', kind: 'earlier_case', label: 'Remark 6', section: 'H', template: '{{REPORT.REMARK_6}}', confidence: 95, note: null },
    ],
    new_fields: [{ code: 'CROPS', label: 'Crops', group: 'LAND', type: 'text', unit: null, options: null, sources: ['seven_twelve', 'valuation'], hint: null, default_text: 'Not applicable', scope: 'bank' }],
  } as any, ctx);
  const by = new Map(r.rows.map((x) => [x.slot_key, x]));
  it('drops currency and units around money and area fields', () => {
    expect(by.get('t0r0c1')!.template).toBe('{{VAL.RENT}} per month');
    expect(by.get('t0r1c1')!.template).toBe('{{AREA.BUA}}');
  });
  it('keeps the earlier value as a sample, never as the template', () => expect(by.get('t0r1c1')!.sample).toBe('old value'));
  it('ignores cells not in the document and duplicates', () => { expect(by.has('t9r9c9')).toBe(false); expect(r.rows.filter((x) => x.slot_key === 't0r0c1')).toHaveLength(1); });
  it('puts bank-only fields under the bank code and keeps only listed sources', () => {
    expect(r.newFields[0].code).toBe('NKGSB.CROPS');
    expect(r.newFields[0].group).toBe('NKGSB');
    expect(r.newFields[0].sources).toEqual(['seven_twelve', 'manual']);
    expect(by.get('t0r2c1')!.template).toBe('{{NKGSB.CROPS}}');
    expect(by.get('t0r2c1')!.status).toBe('new');
  });
  it('unknown fields need the valuer; overlapping paragraph ranges are dropped', () => {
    expect(by.get('p5-p5')!.status).toBe('clear');
    expect(by.get('p5-p5')!.template).toBeNull(); // CASE.REPORT_NO is not in this test dictionary
    expect(by.has('p6-p7')).toBe(true);
    expect(by.has('p7-p7')).toBe(false);
  });
  it('a single remark beside the whole remarks list is removed, not printed twice', () => {
    expect(by.get('p8-p8')!.template).toBeNull();
    expect(by.get('p8-p8')!.status).toBe('clear');
  });
});

describe('templates', () => {
  it('lists and recognises fields', () => {
    expect(templateCodes('{{CUST.NAME}}, {{CASE.BRANCH_NAME}}')).toEqual(['CUST.NAME', 'CASE.BRANCH_NAME']);
    expect(singleField(' {{CUST.NAME}} ')).toBe('CUST.NAME');
    expect(singleField('Ref: {{CASE.REPORT_NO}}')).toBeNull();
  });
  it('drops empty fields with their separator', () => {
    const v: Record<string, string> = { A: 'Maharashtra', B: 'Thane', C: '', D: 'Majiwade' };
    expect(fillTemplate('{{X.A}}, {{X.B}}, {{X.C}}, {{X.D}}', (c) => v[c.slice(2)])).toBe('Maharashtra, Thane, Majiwade');
    expect(fillTemplate('{{X.C}}, {{X.A}}', (c) => v[c.slice(2)])).toBe('Maharashtra');
    expect(fillTemplate('Ref: {{X.A}} Date: {{X.B}}', (c) => v[c.slice(2)])).toBe('Ref: Maharashtra Date: Thane');
  });
  it('fixed words the value already starts with print once', () => {
    const v: Record<string, string> = { B: 'Example Heights, B Wing', S: 'Survey No. 101/2 (Part)', M: 'Rs. 5,00,000/-' };
    expect(fillTemplate('{{X.B}}, Survey No. {{X.S}}', (c) => v[c.slice(2)])).toBe('Example Heights, B Wing, Survey No. 101/2 (Part)');
    expect(fillTemplate('Price: Rs. {{X.M}}', (c) => v[c.slice(2)])).toBe('Price: Rs. 5,00,000/-');
    expect(fillTemplate('Survey No. {{X.S}}', () => '\uE000X.S\uE001Survey No. 5\uE002')).toBe('\uE000X.S\uE001Survey No. 5\uE002');
  });
});

describe('floating tables', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (t: string) => `<w:p>${t ? `<w:r><w:t>${t}</w:t></w:r>` : ''}</w:p>`;
  const tbl = (pos: string) => `<w:tbl><w:tblPr>${pos}</w:tblPr><w:tr><w:tc>${p('cell')}</w:tc></w:tr></w:tbl>`;
  const order = (xml: string) => {
    const doc = new DOMParser().parseFromString(`<w:document ${W}><w:body>${xml}</w:body></w:document>`, 'text/xml') as any;
    unfloatTables(doc);
    const body = doc.getElementsByTagName('w:body')[0];
    return { doc, seq: Array.from(body.childNodes as any[]).map((n: any) => (n.nodeName === 'w:tbl' ? 'T' : n.textContent || '_')).join(' ') };
  };
  it('a table fixed to the page goes after the text Word prints above it, and stops floating', () => {
    const r = order(`${p('')}${tbl('<w:tblpPr w:vertAnchor="page" w:tblpY="2982"/>')}${p('Ref: 1')}${p('')}${tbl('<w:tblpPr w:vertAnchor="page" w:tblpY="1534"/>')}${tbl('')}`);
    expect(r.seq).toBe('_ Ref: 1 T _ T T');
    expect(r.doc.getElementsByTagName('w:tblpPr').length).toBe(0);
  });
  it('a table anchored to the text stays where it is', () => expect(order(`${tbl('<w:tblpPr w:vertAnchor="text"/>')}${p('after')}`).seq).toBe('T after'));
});
