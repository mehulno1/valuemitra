import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parsePages } from '../src/modules/templates/compile';
import { keepTablesWithHeadings } from '../src/modules/templates/docx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const row = (t: string) => `<w:tr><w:tc>${p(t)}</w:tc></w:tr>`;

describe('letterhead pages (#9)', () => {
  it('reads page lists and ranges', () => {
    expect(parsePages('2')).toEqual([2]);
    expect(parsePages('1, 2')).toEqual([1, 2]);
    expect(parsePages('2-4')).toEqual([2, 3, 4]);
    expect(parsePages('4–2')).toBeNull();
    expect(parsePages('two')).toBeNull();
    expect(parsePages('')).toBeNull();
  });
});

describe('headings stay with their tables (#11)', () => {
  it('keeps the heading and all but the last row of a short table with the next', () => {
    const doc = new DOMParser().parseFromString(`<w:document xmlns:w="${W}"><w:body>${p('Body text')}${p('Rate Indicators Chart')}<w:p/><w:tbl>${row('a')}${row('b')}${row('c')}</w:tbl><w:sectPr/></w:body></w:document>`, 'text/xml');
    expect(keepTablesWithHeadings(doc as any)).toBe(1);
    const xml = new XMLSerializer().serializeToString(doc);
    const kept = (t: string) => new RegExp(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>${t}</w:t>`).test(xml);
    expect(kept('Rate Indicators Chart')).toBe(true);
    expect(kept('Body text')).toBe(false);
    expect(kept('a') && kept('b')).toBe(true);
    expect(kept('c')).toBe(false);
  });
  it('leaves a table that holds a page break alone', () => {
    const doc = new DOMParser().parseFromString(`<w:document xmlns:w="${W}"><w:body>${p('H')}<w:tbl>${row('a')}<w:tr><w:tc><w:p><w:r><w:br w:type="page"/></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`, 'text/xml');
    expect(keepTablesWithHeadings(doc as any)).toBe(0);
  });
});
