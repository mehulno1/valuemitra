// Builds the SBI "Annexure XI, Format-A" Word template as a bank would supply it: labels with empty
// value cells, plus a few {{FIELD}} placeholders in running text. The template engine then detects,
// maps and compiles it like any uploaded bank template. Layout follows the ValueMitra prototype.
// Revision 2: the Format-A body flows from page to page (no fixed page breaks), rows never split
// across pages, a section heading stays with its first row and signature blocks stay together.
// Revision 3: annexure pages start with "page break before" on their heading instead of a break
// paragraph, so a page that ends full never leaves a blank page behind it.
import {
  AlignmentType, BorderStyle, Document, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

const FONT = 'Times New Roman';
const SZ = 22; // 11 pt

const t = (text: string, o: { bold?: boolean; size?: number; underline?: boolean; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? SZ, bold: o.bold, italics: o.italics, underline: o.underline ? {} : undefined });

const p = (text: string | TextRun[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; bold?: boolean; size?: number; after?: number; underline?: boolean; before?: number; keepNext?: boolean; pageBefore?: boolean } = {}) =>
  new Paragraph({
    alignment: o.align,
    keepNext: o.keepNext,
    pageBreakBefore: o.pageBefore,
    keepLines: true,
    spacing: { after: o.after ?? 80, before: o.before ?? 0 },
    children: typeof text === 'string' ? [t(text, { bold: o.bold, size: o.size, underline: o.underline })] : text,
  });

const border = { style: BorderStyle.SINGLE, size: 4, color: '333333' };
const borders = { top: border, bottom: border, left: border, right: border };

const cell = (text: string, o: { bold?: boolean; width?: number; span?: number; shade?: boolean; keepNext?: boolean } = {}) =>
  new TableCell({
    borders,
    columnSpan: o.span,
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.shade ? { fill: 'F2F2F2' } : undefined,
    children: text.split('\n').map((line) => p(line, { bold: o.bold, after: 20, keepNext: o.keepNext })),
  });
/** a row that never splits across pages; keepNext holds it on the page of the row below */
const tr = (children: TableCell[]) => new TableRow({ cantSplit: true, children });

const table = (rows: TableRow[]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });

/** numbered section header row */
const sec = (no: string, title: string) => tr([cell(no, { bold: true, width: 6, shade: true, keepNext: true }), cell(title, { bold: true, span: 2, shade: true, keepNext: true })]);
/** label / empty value row */
const row = (label: string, value = '') => tr([cell('', { width: 6 }), cell(label, { width: 40 }), cell(value, { width: 54 })]);

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const sigBlock = () => [
  p('', { keepNext: true }),
  table([
    tr([cell('Place', { width: 30, keepNext: true }), cell('', { width: 70, keepNext: true })]),
    tr([cell('Date', { width: 30, keepNext: true }), cell('', { width: 70, keepNext: true })]),
    tr([cell('Signature & seal of the valuer', { width: 30, keepNext: true }), cell('', { width: 70, keepNext: true })]),
    tr([cell('Name of the valuer', { width: 30 }), cell('', { width: 70 })]),
  ]),
];

const DECLARATIONS = [
  'I am a citizen of India.',
  'I will not undertake valuation of any assets in which I have a direct or indirect interest or become so interested at any time during a period of three years prior to my appointment as valuer or three years after the valuation of assets was conducted by me.',
  'The information furnished in my valuation report dated {{CASE.REPORT_DATE}} is true and correct to the best of my knowledge and belief and I have made an impartial and true valuation of the property.',
  '{{REPORT.INSPECTION_DECL}}',
  'I have not been depanelled / delisted by any other bank and in case any such depanelment by other banks during my empanelment with you, I will inform you within 3 days of such depanelment.',
  'I have not been removed / dismissed from service / employment earlier.',
  'I have not been convicted of any offence and sentenced to a term of imprisonment.',
  'I have not been found guilty of misconduct in professional capacity.',
  'I have not been declared to be unsound mind.',
  'I am not an undischarged bankrupt, or have not applied to be adjudicated as a bankrupt.',
  'I am not an undischarged insolvent.',
  'I have not been levied a penalty under section 271J of Income-tax Act, 1961 (43 of 1961) and time limit for filing appeal before Commissioner of Income-tax (Appeals) or Income-tax Appellate Tribunal, as the case may be has expired, or such penalty has been confirmed by Income-tax Appellate Tribunal, and five years have not elapsed after levy of such penalty.',
  'I have not been convicted of an offence connected with any proceeding under the Income Tax Act 1961, Wealth Tax Act 1957 or Gift Tax Act 1958.',
  'My PAN Card number / Service Tax number as applicable is available with the bank.',
  'I undertake to keep you informed of any events or happenings which would make me ineligible for empanelment as a valuer.',
  'I have not concealed or suppressed any material information, facts and records and I have made a complete and full disclosure.',
  'I have read the Handbook on Policy, Standards and procedure for Real Estate Valuation, 2011 of the IBA and this report is in conformity to the "Standards" enshrined for valuation in the Part-B of the above handbook to the best of my ability.',
  'I have read the International Valuation Standards (IVS) and the report submitted to the Bank for the respective asset class is in conformity to the "Standards" as enshrined for valuation in the IVS in "General Standards" and "Asset Standards" as applicable.',
  'I abide by the Model Code of Conduct for empanelment of valuer in the Bank (Annexure-XIV, a signed copy of same to be taken and kept along with this declaration).',
  'I am registered under Section 247 of the Companies Act, 2013.',
  'I am the proprietor / partner / authorized official of the firm / company, who is competent to sign this valuation report.',
  'I will undertake the valuation work on receipt of Letter of Engagement generated from the system (i.e. LLMS / LOS) only.',
];

const CODE_OF_CONDUCT = [
  'A valuer shall, in the conduct of his/its business, follow high standards of integrity and fairness in all his/its dealings with his/its clients and other valuers.',
  'A valuer shall maintain integrity by being honest, straightforward, and forthright in all professional relationships.',
  'A valuer shall endeavour to ensure that he/it provides true and adequate information and shall not misrepresent any facts or situations.',
  'A valuer shall refrain from being involved in any action that would bring disrepute to the profession.',
  'A valuer shall keep public interest foremost while delivering his services.',
  'A valuer shall render at all times high standards of service, exercise due diligence, ensure proper care and exercise independent professional judgment.',
  'A valuer shall carry out professional services in accordance with the relevant technical and professional standards that may be specified from time to time.',
  'A valuer shall continuously maintain professional knowledge and skill to provide competent professional service based on up-to-date developments in practice, prevailing regulations / guidelines and techniques.',
  'In the preparation of a valuation report, the valuer shall not disclaim liability for his/its expertise or deny his/its duty of care, except to the extent that the assumptions are based on statements of fact provided by the company or its auditors or consultants or information available in public domain and not generated by the valuer.',
  'A valuer shall not carry out any instruction of the client insofar as they are incompatible with the requirements of integrity, objectivity and independence.',
  'A valuer shall clearly state to his client the services that he would be competent to provide and the services for which he would be relying on other valuers or professionals or for which the client can have a separate arrangement with other valuers.',
  'A valuer shall act with objectivity in his/its professional dealings by ensuring that his/its decisions are made without the presence of any bias, conflict of interest, coercion, or undue influence of any party, whether directly connected to the valuation assignment or not.',
  'A valuer shall not take up an assignment if he/it or any of his/its relatives or associates is not independent in terms of association to the company.',
  'A valuer shall maintain complete independence in his/its professional relationships and shall conduct the valuation independent of external influences.',
  'A valuer shall wherever necessary disclose to the clients, possible sources of conflicts of duties and interests, while providing unbiased services.',
  'A valuer shall not deal in securities of any subject company after any time when he/it first becomes aware of the possibility of his / its association with the valuation, and in accordance with the Securities and Exchange Board of India (Prohibition of Insider Trading) Regulations, 2015 or till the time the valuation report becomes public, whichever is earlier.',
  'A valuer shall not indulge in "mandate snatching" or offering "convenience valuations" in order to cater to a company or client\'s needs.',
  'As an independent valuer, the valuer shall not charge success fee.',
  'In any fairness opinion or independent expert opinion submitted by a valuer, if there has been a prior engagement in an unconnected transaction, the valuer shall declare the association with the company during the last five years.',
  'A valuer shall not use or divulge to other clients or any other party any confidential information about the subject company, which has come to his/its knowledge without proper and specific authority or unless there is a legal or professional right or duty to disclose.',
  'A valuer shall not offer gifts or hospitality or a financial or any other advantage to a public servant or any other person with a view to obtain or retain work for himself / itself, or to obtain or retain an advantage in the conduct of profession for himself / itself.',
  'A valuer shall not solicit any gift or hospitality or financial or any other advantage from any person with a view to obtain or retain work for himself / itself.',
  'A valuer shall maintain written contemporaneous records for any decision taken, the reasons for taking the decision, and the information and evidence in support of such decision. This shall be maintained so as to sufficiently enable a reasonable person to take a view on the appropriateness of his /its decisions and actions.',
  'A valuer shall appear, co-operate and be available for inspections and investigations carried out by the authority, any person authorised by the authority, the registered valuers organisation with which he/it is registered or any other statutory regulatory body.',
  'A valuer shall provide all information and records as may be required by the authority, the Tribunal, Appellate Tribunal, the registered valuers organisation with which he/it is registered, or any other statutory regulatory body.',
  'A valuer while respecting the confidentiality of information acquired during the course of performing professional services, shall maintain proper working papers for a period of three years or such longer period as required in its contract for a specific valuation, for production before a regulatory authority or for a peer review.',
  'A valuer shall provide services for remuneration which is charged in a transparent manner, is a reasonable reflection of the work necessarily and properly undertaken, and is not inconsistent with the applicable rules.',
  'A valuer shall not accept any fees or charges other than those which are disclosed in a written contract with the person to whom he would be rendering service.',
  'A valuer shall refrain from accepting too many assignments, if he/it is unlikely to be able to devote adequate time to each of his/ its assignments.',
  'A valuer shall not conduct business which in the opinion of the authority or the registered valuer organisation discredits the profession.',
];

export async function buildSbiFormatA(): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // ---- Cover ----
  children.push(
    p('', { after: 1600 }),
    p('VALUATION REPORT', { align: AlignmentType.CENTER, bold: true, size: 36, underline: true, after: 240 }),
    p('OF', { align: AlignmentType.CENTER, bold: true, size: 28, after: 240 }),
    p('{{CUST.NAME}}', { align: AlignmentType.CENTER, bold: true, size: 32, after: 240 }),
    p('Located at', { align: AlignmentType.CENTER, bold: true, size: 26, after: 240 }),
    p('{{PROP.ADDRESS}}', { align: AlignmentType.CENTER, bold: true, size: 26, after: 240 }),
    p('For', { align: AlignmentType.CENTER, bold: true, size: 26, after: 240 }),
    p('{{CASE.BANK_BRANCH_TITLE}}', { align: AlignmentType.CENTER, bold: true, size: 28, after: 240 }),
    p('By', { align: AlignmentType.CENTER, bold: true, size: 26, after: 240 }),
    p('{{FIRM.VALUER_NAME}}', { align: AlignmentType.CENTER, bold: true, size: 28, after: 80 }),
    p('Govt. Approved Valuer', { align: AlignmentType.CENTER, bold: true, size: 24 }),
    pageBreak(),
  );

  // ---- Format-A, part 1 ----
  children.push(
    p('ANNEXURE- XI', { align: AlignmentType.RIGHT, bold: true, after: 0 }),
    p('Format-A', { align: AlignmentType.RIGHT, bold: true }),
    p('VALUATION REPORT', { align: AlignmentType.CENTER, bold: true, size: 26, underline: true }),
    p('STATE BANK OF INDIA ({{CASE.BRANCH_NAME}})', { align: AlignmentType.CENTER, bold: true }),
    table([
      tr([cell('Ref No.', { width: 15 }), cell('', { width: 45 }), cell('Date', { width: 15 }), cell('', { width: 25 })]),
    ]),
    p(''),
    table([
      sec('1.', 'Customer Details'),
      row('Name of Customer(s)'),
      row('Apl. No.'),
      sec('2.', 'Property Details'),
      row('Address'),
      row('Nearby Landmark'),
      sec('3.', 'Document Details'),
      row('Layout Plan'),
      row('Building Plan'),
      row('Construction Permission'),
      row('Occupancy Certificate'),
      row('Legal Documents'),
      sec('4.', 'Physical Details'),
      row('Adjoining Properties: Boundaries as per Actual'),
      row('Boundaries as per Documents'),
      row('No. of rooms'),
      row('Floors/Structure'),
      row('Floor of the property & Approx. age of the building'),
      row('Residual age'),
      sec('5.', 'Tenure/Occupancy'),
      row('Status of Tenure'),
      sec('6.', 'Stage of Construction'),
      row('Stage of Construction'),
      sec('7.', 'Violation if any observed'),
      row('Violation if any observed'),
    ]),
  );

  // ---- Format-A, part 2 ----
  children.push(
    table([
      sec('8.', 'Area Details'),
      row('Site Area'),
      row('Plinth Area as per document'),
      row('Carpet Area'),
      row('Saleable Area'),
      sec('9.', 'Valuation'),
      row('i. Value as per Government Approved Rates'),
      row('ii. In case of variation of 20% or more in the valuation proposed by the valuer and the Guideline value provided in the State Govt. notification, a statement on the need for this variation has to be given'),
    ]),
    p(''),
    table([
      tr([cell('Description', { bold: true, width: 40 }), cell('Area', { bold: true, width: 20 }), cell('Rate', { bold: true, width: 20 }), cell('Estimated value', { bold: true, width: 20 })]),
      tr([cell('Present Value of the Flat', { width: 40 }), cell('', { width: 20 }), cell('', { width: 20 }), cell('', { width: 20 })]),
      tr([cell('Car Parking', { width: 40 }), cell('', { width: 20 }), cell('', { width: 20 }), cell('', { width: 20 })]),
      tr([cell('Interior Decorations', { width: 40 }), cell('', { width: 20 }), cell('', { width: 20 }), cell('', { width: 20 })]),
      tr([cell('Others (Government Charges)', { width: 40 }), cell('', { width: 20 }), cell('', { width: 20 }), cell('', { width: 20 })]),
    ]),
    p(''),
    p('Summary of Valuation', { bold: true, keepNext: true }),
    table([
      tr([cell('I.', { width: 6 }), cell('Guideline Value', { width: 44 }), cell('', { width: 50 })]),
      tr([cell('II.', { width: 6 }), cell('Fair Market Value', { width: 44 }), cell('', { width: 50 })]),
      tr([cell('III.', { width: 6 }), cell('Realizable Value', { width: 44 }), cell('', { width: 50 })]),
      tr([cell('IV.', { width: 6 }), cell('Forced/Distress Value', { width: 44 }), cell('', { width: 50 })]),
      tr([cell('V.', { width: 6 }), cell('Agreement Value', { width: 44 }), cell('', { width: 50 })]),
      tr([cell('VI.', { width: 6 }), cell('Insurable Value', { width: 44 }), cell('', { width: 50 })]),
      tr([cell('VII.', { width: 6 }), cell('Rent', { width: 44 }), cell('', { width: 50 })]),
    ]),
    p(''),
    table([
      tr([cell('Justification for 20% variation in FMV and GV', { bold: true, width: 40 }), cell('', { width: 60 })]),
    ]),
    p(''),
    table([
      sec('10.', 'Assumptions/Remarks'),
      row('i. Qualifications in TIR / Mitigation suggested, if any', 'No'),
      row('ii. Property is SARFAESI compliant', 'Yes'),
      row('iii. Whether property belongs to social infrastructure like hospital, school, old age home etc.', 'No'),
      row('iv. Details of last two transactions in the locality / area to be provided, if available'),
      sec('11.', 'Declaration'),
      row('i. Inspection'),
      row('ii. The undersigned does not have any direct/indirect interest in the above property', 'Yes'),
      row('iii. The information furnished herein is true and correct to the best of our knowledge', 'Yes'),
      row('iv. We have submitted the valuation report directly to the Bank', 'Yes'),
      sec('12.', 'Name & Address of Valuer'),
      row('Name & Address of Valuer'),
    ]),
    p(''),
  );

  // ---- Opinion page with remarks ----
  children.push(
    p('{{REPORT.OPINION}}', { after: 160 }),
    ...sigBlock(),
    p(''),
    p('Remarks:', { bold: true, underline: true, keepNext: true }),
    // long remarks may run onto the next page rather than leave a gap
    table([new TableRow({ children: [cell('Remarks of the valuer', { width: 25 }), cell('', { width: 75 })] })]),
    p(''),
    p('Followed by Annexure-III (declaration-cum-undertaking), valuer comment table, Model Code of Conduct, photographs, map, ready reckoner, listings, sale transactions and document pages.', { size: 18 }),
  );

  // ---- Annexure-III declaration ----
  children.push(
    p('Annexure-III', { align: AlignmentType.RIGHT, bold: true, pageBefore: true }),
    p('DECLARATION-CUM-UNDERTAKING', { align: AlignmentType.CENTER, bold: true, underline: true, after: 160 }),
    ...DECLARATIONS.map((d, i, all) => p(`${String.fromCharCode(97 + i)})  ${d}`, { after: 40, size: 20, keepNext: i === all.length - 1 })),
    ...sigBlock(),
  );

  // ---- Valuer comment table ----
  const comment = (no: string, label: string, value = '') =>
    tr([cell(no, { width: 6 }), cell(label, { width: 40 }), cell(value, { width: 54 })]);
  children.push(
    p('VALUER COMMENT', { align: AlignmentType.CENTER, bold: true, underline: true, after: 160, pageBefore: true }),
    table([
      tr([cell('Sr. No.', { bold: true, width: 6 }), cell('Particulars', { bold: true, width: 40 }), cell('Valuer comment', { bold: true, width: 54 })]),
      comment('1', 'Background information of the asset being valued'),
      comment('2', 'Purpose of valuation and appointing authority'),
      comment('3', 'Identity of the valuer and any other experts involved in the valuation'),
      comment('4', 'Disclosure of valuer interest or conflict, if any', 'We have no direct or indirect interest in the property valued.'),
      comment('5', 'Date of appointment'),
      comment('6', 'Date of inspection'),
      comment('7', 'Date of report'),
      comment('8', 'Inspections and/or investigations undertaken', 'Site visit and verification of documents provided.'),
      comment('9', 'Nature and sources of the information used or relied upon', 'Documents provided by the bank, site inspection, market enquiries and published rates.'),
      comment('10', 'Procedures adopted in carrying out the valuation and valuation standards followed'),
      comment('11', 'Restrictions on use of the report, if any', 'Valuation is done for the purpose stated and should not be used for any other purpose.'),
      comment('12', 'Caveats, limitations and disclaimers', 'None in particular.'),
    ]),
    ...sigBlock(),
  );

  // ---- Model Code of Conduct ----
  children.push(
    p('Annexure-XIV', { align: AlignmentType.RIGHT, bold: true, pageBefore: true }),
    p('MODEL CODE OF CONDUCT FOR VALUERS', { align: AlignmentType.CENTER, bold: true, underline: true, after: 60 }),
    p('{Adopted in line with Companies (Registered Valuers and Valuation) Rules, 2017}', { align: AlignmentType.CENTER, after: 160, size: 20 }),
    ...CODE_OF_CONDUCT.map((c, i, all) => p(`${i + 1}.  ${c}`, { after: 60, size: 20, keepNext: i === all.length - 1 })),
    ...sigBlock(),
  );

  const doc = new Document({
    creator: 'ValueMitra',
    title: 'SBI Annexure XI Format-A',
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
