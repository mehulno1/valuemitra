// Platform canonical parameter dictionary (v1). Every fact a report can need, captured once.
// Sources are in priority order. Document types match the doc_types configuration.
import type { FieldDataType } from '@vm/shared';

export interface FieldDef {
  code: string;
  label: string;
  group: string;
  type: FieldDataType | 'list';
  unit?: string;
  applies?: string[];
  sources: string[];
  derivation?: string;
  rules?: unknown;
  hint?: string;
  aliases?: string[];
  pending?: string;
  enum?: string[];
  validation?: { expr: string; message: string }[];
}

const BUILT = ['flat', 'shop', 'office', 'bungalow'];
const UNITS = ['flat', 'shop', 'office'];

export const FIELDS: FieldDef[] = [
  // ---- Case and firm (filled from the assignment and firm settings) ----
  { code: 'CASE.NO', label: 'Case ID', group: 'CASE', type: 'text', sources: ['case'] },
  { code: 'CASE.BANK_NAME', label: 'Bank name', group: 'CASE', type: 'text', sources: ['case'], aliases: ['Name of the bank', 'Bank'] },
  { code: 'CASE.BANK_CODE', label: 'Bank code', group: 'CASE', type: 'text', sources: ['case'] },
  { code: 'CASE.BRANCH_NAME', label: 'Branch name', group: 'CASE', type: 'text', sources: ['case'], aliases: ['Branch'] },
  { code: 'CASE.BRANCH_CODE', label: 'Branch code', group: 'CASE', type: 'text', sources: ['case'] },
  { code: 'CASE.BANK_BRANCH_TITLE', label: 'Bank and branch (title)', group: 'CASE', type: 'text', sources: ['case'], aliases: ['Name of the bank and branch'] },
  { code: 'CASE.BANK_CONTACT', label: "Bank officer's name", group: 'CASE', type: 'text', sources: ['case'], aliases: ["Name of the bank's officer", 'Bank officer'] },
  { code: 'CASE.PURPOSE', label: 'Purpose of valuation', group: 'CASE', type: 'text', sources: ['case'], aliases: ['Purpose for which valuation is made'] },
  { code: 'CASE.APPOINTMENT_DATE', label: 'Date of appointment', group: 'CASE', type: 'date', sources: ['case'], aliases: ['Date of appointment'] },
  { code: 'CASE.REPORT_DATE', label: 'Date of report', group: 'CASE', type: 'date', sources: ['case'], aliases: ['Date', 'Date of report', 'Date of valuation report'] },
  { code: 'CASE.REPORT_NO', label: 'Report reference no.', group: 'CASE', type: 'text', sources: ['case'], pending: 'Issued at sign-off', aliases: ['Ref No.', 'Reference no.', 'Report no.'] },
  { code: 'CASE.APPLICATION_NO', label: 'Application no.', group: 'CASE', type: 'text', sources: ['case', 'manual'], aliases: ['Apl. No.', 'Loan application no.'] },
  { code: 'CASE.ENGINEER_NAME', label: 'Inspecting engineer', group: 'CASE', type: 'text', sources: ['case'], aliases: ["Valuer's representative"] },
  { code: 'FIRM.NAME', label: 'Firm name', group: 'FIRM', type: 'text', sources: ['firm'] },
  { code: 'FIRM.ADDRESS', label: 'Firm address', group: 'FIRM', type: 'text', sources: ['firm'] },
  { code: 'FIRM.VALUER_NAME', label: 'Name of valuer', group: 'FIRM', type: 'text', sources: ['firm'], aliases: ['Name of the valuer', 'Valuer'] },
  { code: 'FIRM.VALUER_QUALS', label: 'Valuer qualifications', group: 'FIRM', type: 'text', sources: ['firm'] },
  { code: 'FIRM.VALUER_REG', label: 'Valuer registration no.', group: 'FIRM', type: 'text', sources: ['firm'], aliases: ['IBBI registration no.', 'Registration no.'] },
  { code: 'FIRM.VALUER_BLOCK', label: 'Name and address of valuer', group: 'FIRM', type: 'longtext', sources: ['wording'], aliases: ['Name & Address of Valuer'] },
  { code: 'FIRM.PLACE', label: 'Place', group: 'FIRM', type: 'text', sources: ['firm'] },

  // ---- Customer ----
  { code: 'CUST.NAME', label: 'Name of customer', group: 'CUST', type: 'text', sources: ['agreement', 'index2', 'case', 'manual'],
    hint: 'The purchaser / transferee / borrower, with honorific (Mr./Mrs./Ms.) as written. If several, join with " & ".',
    aliases: ['Name of the customer(s)', 'Name of the owner(s)', 'Name of owner', 'Name of the borrower'] },

  // ---- Property ----
  { code: 'PROP.ADDRESS', label: 'Address', group: 'PROP', type: 'longtext', sources: ['agreement', 'index2', 'manual'],
    hint: 'Full postal address of the unit from the schedule of property: unit no., floor, building, society, survey/CTS nos., village, road, city, PIN.',
    aliases: ['Address', 'Postal address of the property', 'Address of the property', 'Property address', 'Location of property'] },
  { code: 'PROP.UNIT_NO', label: 'Unit no.', group: 'PROP', type: 'text', applies: UNITS, sources: ['agreement', 'index2', 'site_sheet', 'manual'], hint: 'Flat/shop/office number only, e.g. "34"', aliases: ['Flat No.', 'Shop No.', 'Office No.'] },
  { code: 'PROP.BUILDING', label: 'Building', group: 'PROP', type: 'text', applies: BUILT, sources: ['agreement', 'index2', 'site_sheet', 'manual'], hint: 'Building name/number, e.g. "Building No. 93"', aliases: ['Name of the building'] },
  { code: 'PROP.SOCIETY', label: 'Society', group: 'PROP', type: 'text', sources: ['agreement', 'society_noc', 'share_cert', 'manual'], hint: 'Co-operative housing society name', aliases: ['Name of the society'] },
  { code: 'PROP.SURVEY_NO', label: 'Survey / CTS no.', group: 'PROP', type: 'text', sources: ['agreement', 'index2', 'property_card', 'seven_twelve', 'manual'], hint: 'Survey, Hissa, CTS, Gat or plot numbers as written', aliases: ['Plot / Survey / CTS No.', 'Survey No.', 'CTS No.', 'Plot No.'] },
  { code: 'PROP.VILLAGE', label: 'Village', group: 'PROP', type: 'text', sources: ['index2', 'agreement', 'manual'], hint: 'Revenue village name in English (transliterate Marathi, e.g. माजिवडे → Majiwade)', aliases: ['Village', 'Mouje'] },
  { code: 'PROP.DISTRICT', label: 'District', group: 'PROP', type: 'text', sources: ['index2', 'agreement', 'manual'], aliases: ['District'] },
  { code: 'PROP.VILLAGE_DISTRICT', label: 'Village / district', group: 'PROP', type: 'text', sources: ['derived'], derivation: "text(PROP.VILLAGE ? 'Village ' + PROP.VILLAGE : '', PROP.DISTRICT ? ', ' + PROP.DISTRICT : '')" },
  { code: 'PROP.PINCODE', label: 'PIN code', group: 'PROP', type: 'text', sources: ['agreement', 'index2', 'manual'] },
  { code: 'PROP.LANDMARK', label: 'Nearby landmark', group: 'PROP', type: 'text', sources: ['site_sheet', 'manual'], aliases: ['Nearby Landmark', 'Landmark'] },
  { code: 'PROP.STATION', label: 'Nearest station', group: 'PROP', type: 'text', sources: ['site_sheet', 'manual'], hint: 'Nearest railway station with distance, and bus stop distance if given', aliases: ['Nearest railway station', 'Distance from railway station'] },
  { code: 'PROP.STATION_KM', label: 'Distance from station (km)', group: 'PROP', type: 'number', unit: 'km', sources: ['site_sheet', 'manual'] },
  { code: 'PROP.LAT', label: 'Latitude', group: 'PROP', type: 'number', sources: ['site_sheet', 'evidence', 'manual'] },
  { code: 'PROP.LNG', label: 'Longitude', group: 'PROP', type: 'number', sources: ['site_sheet', 'evidence', 'manual'] },
  { code: 'PROP.LATLNG_TEXT', label: 'Latitude / longitude', group: 'PROP', type: 'text', sources: ['derived'], derivation: 'dms(PROP.LAT, PROP.LNG)', aliases: ['Latitude/Longitude', 'GPS co-ordinates'] },
  { code: 'PROP.AREA_CLASS', label: 'Classification of locality', group: 'PROP', type: 'enum', enum: ['Residential', 'Commercial', 'Mixed', 'Industrial'], sources: ['site_sheet', 'manual'], aliases: ['Classification of the locality'] },
  { code: 'PROP.BHK', label: 'Configuration', group: 'PROP', type: 'text', applies: ['flat'], sources: ['site_sheet', 'agreement', 'manual'], hint: 'e.g. "1 BHK"' },

  // ---- Approvals ----
  { code: 'DOC.OC.NUMBER', label: 'O.C. number', group: 'APPR', type: 'text', applies: BUILT, sources: ['oc', 'agreement'], pending: 'Awaiting O.C.', hint: 'Occupancy / completion certificate outward number, e.g. "V.P. 85/165/TMC/TDD-4A1"' },
  { code: 'DOC.OC.DATE', label: 'O.C. date', group: 'APPR', type: 'date', applies: BUILT, sources: ['oc', 'agreement'], pending: 'Awaiting O.C.' },
  { code: 'DOC.OC.AUTHORITY', label: 'O.C. issued by', group: 'APPR', type: 'text', applies: BUILT, sources: ['oc', 'agreement'], pending: 'Awaiting O.C.', hint: 'Issuing authority, abbreviated as commonly used, e.g. "TMC"' },
  { code: 'APPR.OC', label: 'Occupancy certificate', group: 'APPR', type: 'longtext', applies: BUILT, sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Occupancy Certificate', 'Completion certificate', 'O.C.'] },
  { code: 'APPR.LAYOUT_PLAN', label: 'Layout plan', group: 'APPR', type: 'longtext', applies: BUILT, sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Layout Plan', 'Approved layout plan'] },
  { code: 'APPR.BUILDING_PLAN', label: 'Building plan', group: 'APPR', type: 'longtext', applies: BUILT, sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Building Plan', 'Approved building plan', 'Approved plan'] },
  { code: 'DOC.CC.NUMBER', label: 'C.C. number', group: 'APPR', type: 'text', applies: BUILT, sources: ['cc', 'agreement'] },
  { code: 'DOC.CC.DATE', label: 'C.C. date', group: 'APPR', type: 'date', applies: BUILT, sources: ['cc', 'agreement'] },
  { code: 'APPR.CC', label: 'Construction permission (C.C.)', group: 'APPR', type: 'longtext', applies: BUILT, sources: ['wording'], aliases: ['Construction Permission', 'Commencement certificate', 'C.C.'] },
  { code: 'PHYS.CONSTRUCTION_STAGE', label: 'Stage of construction', group: 'APPR', type: 'longtext', sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Stage of Construction'] },
  { code: 'PHYS.VIOLATIONS', label: 'Violation if any observed', group: 'APPR', type: 'longtext', sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Violation if any observed', 'Deviations'] },

  // ---- Legal documents ----
  { code: 'DOC.AGREEMENT.DATE', label: 'Agreement date', group: 'DOC', type: 'date', sources: ['agreement', 'index2'] },
  { code: 'DOC.AGREEMENT.SELLER', label: 'Seller (transferor)', group: 'DOC', type: 'text', sources: ['agreement', 'index2'], hint: 'Transferor / vendor names with honorifics' },
  { code: 'DOC.AGREEMENT.BUYER', label: 'Buyer (transferee)', group: 'DOC', type: 'text', sources: ['agreement', 'index2'], hint: 'Transferee / purchaser names with honorifics' },
  { code: 'DOC.AGREEMENT.SUMMARY', label: 'Agreement for sale', group: 'DOC', type: 'longtext', sources: ['wording'] },
  { code: 'DOC.INDEX2.NUMBER', label: 'Index II no.', group: 'DOC', type: 'text', sources: ['index2'], hint: 'दस्त क्रमांक / document number with year, e.g. "4127/2026"' },
  { code: 'DOC.INDEX2.DATE', label: 'Index II date', group: 'DOC', type: 'date', sources: ['index2'], hint: 'दिनांक / date of registration' },
  { code: 'DOC.INDEX2.SUMMARY', label: 'Index II (current)', group: 'DOC', type: 'longtext', sources: ['wording'] },
  { code: 'DOC.INDEX2_PREV.NUMBER', label: 'Previous Index II no.', group: 'DOC', type: 'text', sources: ['index2_prev'] },
  { code: 'DOC.INDEX2_PREV.DATE', label: 'Previous Index II date', group: 'DOC', type: 'date', sources: ['index2_prev'] },
  { code: 'DOC.INDEX2_PREV.SUMMARY', label: 'Index II (previous)', group: 'DOC', type: 'longtext', sources: ['wording'] },
  { code: 'DOC.NOC.DATE', label: 'Society NOC date', group: 'DOC', type: 'date', sources: ['society_noc'] },
  { code: 'DOC.NOC.ISSUED_TO', label: 'Society NOC issued to', group: 'DOC', type: 'text', sources: ['society_noc'] },
  { code: 'DOC.NOC.SUMMARY', label: 'Society NOC', group: 'DOC', type: 'longtext', sources: ['wording'] },
  { code: 'DOC.LEGAL_LIST', label: 'Legal documents', group: 'DOC', type: 'longtext', sources: ['wording'], aliases: ['Legal Documents', 'Documents perused', 'List of documents'] },
  { code: 'DOC.RECEIVED_LIST', label: 'Documents received', group: 'DOC', type: 'list', sources: ['checklist'] },
  { code: 'DOC.NOT_RECEIVED_LIST', label: 'Documents not provided', group: 'DOC', type: 'list', sources: ['checklist'] },

  // ---- Physical ----
  { code: 'PHYS.FLOOR', label: 'Floor of the property', group: 'PHYS', type: 'text', applies: UNITS, sources: ['agreement', 'index2', 'site_sheet'], hint: 'e.g. "3rd Floor"', aliases: ['Floor', 'Floor on which the property is located'] },
  { code: 'PHYS.BOUNDARY_E', label: 'Boundary east', group: 'PHYS', type: 'text', sources: ['site_sheet', 'manual'] },
  { code: 'PHYS.BOUNDARY_W', label: 'Boundary west', group: 'PHYS', type: 'text', sources: ['site_sheet', 'manual'] },
  { code: 'PHYS.BOUNDARY_N', label: 'Boundary north', group: 'PHYS', type: 'text', sources: ['site_sheet', 'manual'] },
  { code: 'PHYS.BOUNDARY_S', label: 'Boundary south', group: 'PHYS', type: 'text', sources: ['site_sheet', 'manual'] },
  { code: 'PHYS.BOUNDARIES', label: 'Boundaries (actual)', group: 'PHYS', type: 'longtext', sources: ['wording'], pending: 'Awaiting site visit', aliases: ['Boundaries as per actual', 'Boundaries of the property', 'Adjoining properties'] },
  { code: 'PHYS.BOUNDARIES_DOC', label: 'Boundaries as per documents', group: 'PHYS', type: 'longtext', sources: ['agreement', 'wording'], pending: 'Awaiting site visit', aliases: ['Boundaries (as per deed)', 'Boundaries as per documents'] },
  { code: 'PHYS.ROOMS', label: 'Rooms', group: 'PHYS', type: 'text', applies: BUILT, sources: ['site_sheet', 'manual'], hint: 'Room list with counts, e.g. "Living 01 · Bedroom 01 · Toilet 01 · Kitchen 01 · Balcony 01"', aliases: ['No. of rooms', 'Accommodation'] },
  { code: 'PHYS.TOTAL_FLOORS', label: 'Floors in building', group: 'PHYS', type: 'text', applies: BUILT, sources: ['site_sheet', 'oc', 'manual'], hint: 'e.g. "Ground + 1st to 4th upper residential floors"' },
  { code: 'PHYS.UNITS_PER_FLOOR', label: 'Units per floor', group: 'PHYS', type: 'number', applies: UNITS, sources: ['site_sheet', 'manual'] },
  { code: 'PHYS.LIFT', label: 'Lift', group: 'PHYS', type: 'enum', enum: ['Yes', 'No'], applies: BUILT, sources: ['site_sheet', 'manual'] },
  { code: 'PHYS.STRUCTURE', label: 'Type of structure', group: 'PHYS', type: 'text', applies: BUILT, sources: ['site_sheet', 'oc', 'manual'], hint: 'e.g. "RCC"', aliases: ['Type of construction', 'Structure'] },
  { code: 'PHYS.FLOORS_STRUCTURE', label: 'Floors / structure', group: 'PHYS', type: 'longtext', applies: BUILT, sources: ['wording'], pending: 'Awaiting site visit', aliases: ['Floors/Structure', 'No. of floors'] },
  { code: 'PHYS.YEAR_BUILT', label: 'Year of construction (site)', group: 'PHYS', type: 'number', applies: BUILT, sources: ['site_sheet', 'manual'], aliases: ['Year of construction'] },
  { code: 'PHYS.AGE_FROM_OC', label: 'Age as per O.C.', group: 'PHYS', type: 'number', unit: 'years', applies: BUILT, sources: ['derived'], derivation: 'years_between(DOC.OC.DATE, CASE.REPORT_DATE)' },
  { code: 'PHYS.AGE_FROM_SITE', label: 'Age as per site sheet', group: 'PHYS', type: 'number', unit: 'years', applies: BUILT, sources: ['derived'], derivation: 'PHYS.YEAR_BUILT ? year(CASE.REPORT_DATE) - PHYS.YEAR_BUILT : null' },
  { code: 'PHYS.AGE', label: 'Age of building', group: 'PHYS', type: 'number', unit: 'years', applies: BUILT, sources: ['manual', 'derived'], pending: 'Awaiting O.C.',
    derivation: 'coalesce(PHYS.AGE_FROM_OC, PHYS.AGE_FROM_SITE)',
    rules: { agree: { candidates: [{ code: 'PHYS.AGE_FROM_OC', basis: 'O.C.' }, { code: 'PHYS.AGE_FROM_SITE', basis: 'year of construction recorded on site sheet' }], tolerance_abs: 2, basis_field: 'PHYS.AGE_BASIS' } },
    aliases: ['Approx. age of the building', 'Age of the building'] },
  { code: 'PHYS.AGE_BASIS', label: 'Age basis', group: 'PHYS', type: 'text', sources: ['manual', 'derived'], derivation: "PHYS.AGE_FROM_OC != null ? 'O.C.' : (PHYS.AGE_FROM_SITE != null ? 'site inspection' : null)" },
  { code: 'PHYS.AGE_TEXT', label: 'Age of building (text)', group: 'PHYS', type: 'text', sources: ['wording'], pending: 'Awaiting O.C.' },
  { code: 'PHYS.RESIDUAL_AGE', label: 'Residual life (years)', group: 'PHYS', type: 'number', unit: 'years', applies: BUILT, sources: ['manual', 'derived'], derivation: 'max(RULE.building_life_years - PHYS.AGE, 0)', pending: 'Awaiting O.C.' },
  { code: 'PHYS.RESIDUAL_AGE_TEXT', label: 'Residual age (text)', group: 'PHYS', type: 'text', sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Residual age', 'Estimated future life'] },
  { code: 'PHYS.FLOOR_AGE_TEXT', label: 'Floor and approx. age', group: 'PHYS', type: 'text', sources: ['wording'], pending: 'Awaiting O.C.', aliases: ['Floor of the property & Approx. age of the building'] },
  { code: 'PHYS.SPEC', label: 'Specifications', group: 'PHYS', type: 'longtext', applies: BUILT, sources: ['site_sheet', 'manual'], hint: 'Flooring, wiring, plumbing, doors, plaster, maintenance', aliases: ['Specifications of construction', 'Quality of construction'] },
  { code: 'PHYS.MAINTENANCE', label: 'Maintenance', group: 'PHYS', type: 'enum', enum: ['Well maintained', 'Average', 'Poor'], applies: BUILT, sources: ['site_sheet', 'manual'] },

  // ---- Tenure / occupancy / inspection ----
  { code: 'OCC.STATUS', label: 'Occupancy', group: 'OCC', type: 'enum', enum: ['Vacant', 'Owner occupied', 'Tenant occupied', 'Locked'], sources: ['site_sheet', 'manual'], aliases: ['Status of Tenure', 'Nature of occupancy', 'Occupied by'] },
  { code: 'OCC.PERSON_MET', label: 'Person met at site', group: 'OCC', type: 'text', sources: ['site_sheet', 'manual'], hint: 'Name and relation to owner, e.g. "Mr. Ajay (owner\'s relative)"', aliases: ['Property shown by'] },
  { code: 'SITE.INSPECTION_DATE', label: 'Date of inspection', group: 'OCC', type: 'date', sources: ['site_sheet', 'case'], aliases: ['Date of inspection', 'Date of site visit'] },

  // ---- Area ----
  { code: 'AREA.BUA', label: 'Built-up area', group: 'AREA', type: 'area', unit: 'sqft', applies: BUILT, sources: ['agreement', 'index2', 'manual'],
    hint: 'Built-up area in sq.ft. If only sq.m. is given convert ×10.764. Index II: "क्षेत्रफळ … चौ. फूट बिल्टअप"',
    validation: [{ expr: 'value > 0', message: 'Built-up area must be more than zero' }],
    aliases: ['Built-up area', 'Built up area', 'Plinth Area as per document', 'Plinth area'] },
  { code: 'AREA.CARPET', label: 'Carpet area', group: 'AREA', type: 'area', unit: 'sqft', applies: BUILT, sources: ['agreement', 'manual', 'derived'],
    derivation: 'round(AREA.BUA / (1 + RULE.loading_pct / 100))',
    hint: 'Carpet area in sq.ft. only if the document states it explicitly as carpet',
    aliases: ['Carpet area', 'Carpet area (as per document)', 'Carpet Area'] },
  { code: 'AREA.SALEABLE', label: 'Saleable area', group: 'AREA', type: 'area', unit: 'sqft', applies: UNITS, sources: ['agreement', 'manual', 'derived'], derivation: 'round(AREA.BUA / (1 + RULE.loading_pct / 100) * RULE.saleable_factor)', aliases: ['Saleable area', 'Super built-up area'] },
  { code: 'AREA.MEASURED', label: 'Site area (measured)', group: 'AREA', type: 'area', unit: 'sqft', applies: BUILT, sources: ['site_sheet', 'manual'], hint: 'Measured carpet area at site in sq.ft., excluding balcony' },
  { code: 'AREA.BALCONY', label: 'Balcony (measured)', group: 'AREA', type: 'area', unit: 'sqft', applies: UNITS, sources: ['site_sheet', 'manual'] },
  { code: 'AREA.MEASURED_TEXT', label: 'Site area (measured, text)', group: 'AREA', type: 'text', sources: ['wording'], pending: 'Awaiting site visit', aliases: ['Site Area', 'Area as per measurement', 'Site area (measured)'] },

  // ---- Registration values ----
  { code: 'REG.CONSIDERATION', label: 'Agreement value', group: 'REG', type: 'money', unit: 'INR', sources: ['index2', 'agreement', 'manual'], hint: 'मोबदला / consideration amount in rupees', aliases: ['Agreement value', 'Purchase price', 'Consideration'] },
  { code: 'REG.GUIDELINE_VALUE', label: 'Government guideline value', group: 'REG', type: 'money', unit: 'INR', sources: ['index2', 'manual'], hint: 'बाजारभाव / market value per ready reckoner as stated in Index II', aliases: ['Value as per Government Approved Rates', 'Guideline value', 'Govt. value'] },

  // ---- Valuation (from the valuation engine) ----
  { code: 'VAL.RR_RATE_SQM', label: 'Ready reckoner rate (per sq.m.)', group: 'VAL', type: 'money', unit: 'INR/sqm', sources: ['evidence', 'manual'], pending: 'Awaiting market evidence' },
  { code: 'VAL.RR_RATE_SQFT', label: 'Ready reckoner rate (per sq.ft.)', group: 'VAL', type: 'money', unit: 'INR/sqft', sources: ['derived'], derivation: 'round(VAL.RR_RATE_SQM / 10.7639104)' },
  { code: 'VAL.RR_YEAR', label: 'Ready reckoner year', group: 'VAL', type: 'text', sources: ['evidence'] },
  { code: 'VAL.PROPOSED_RATE', label: 'Evidence-backed rate', group: 'VAL', type: 'money', unit: 'INR/sqft', sources: ['evidence'], pending: 'Awaiting market evidence' },
  { code: 'VAL.RANGE_LO', label: 'Evidence range (low)', group: 'VAL', type: 'money', unit: 'INR/sqft', sources: ['evidence'], pending: 'Awaiting market evidence' },
  { code: 'VAL.RANGE_HI', label: 'Evidence range (high)', group: 'VAL', type: 'money', unit: 'INR/sqft', sources: ['evidence'], pending: 'Awaiting market evidence' },
  { code: 'VAL.RATE', label: 'Rate adopted (per sq.ft.)', group: 'VAL', type: 'money', unit: 'INR/sqft', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Rate per sq.ft.', 'Rate adopted', 'Present Value of the Flat | Rate'] },
  { code: 'VAL.RATE_REASON', label: 'Reason for rate', group: 'VAL', type: 'longtext', sources: ['valuation'] },
  { code: 'VAL.BASIS_AREA', label: 'Area used for valuation', group: 'VAL', type: 'area', unit: 'sqft', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Present Value of the Flat | Built-up area'] },
  { code: 'VAL.UNIT_VALUE', label: 'Present value of the unit', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Present Value of the Flat | Estimated value', 'Present value of the property'] },
  { code: 'VAL.PARKING', label: 'Car parking', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], aliases: ['Car Parking | Estimated value'] },
  { code: 'VAL.INTERIOR', label: 'Interior decorations', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], aliases: ['Interior Decorations | Estimated value', 'Furniture and fixtures'] },
  { code: 'VAL.OTHERS', label: 'Others', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], aliases: ['Others (Government Charges) | Estimated value'] },
  { code: 'VAL.FMV', label: 'Fair market value', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Market value of the property', 'Fair Market Value', 'Present market value'] },
  { code: 'VAL.REALIZABLE', label: 'Realizable value', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Realisable value', 'Realizable Value'] },
  { code: 'VAL.DISTRESS', label: 'Distress value', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Distress sale value', 'Forced/Distress value', 'Forced sale value'] },
  { code: 'VAL.GUIDELINE', label: 'Guideline value', group: 'VAL', type: 'money', unit: 'INR', sources: ['derived'], derivation: 'REG.GUIDELINE_VALUE', aliases: ['Guideline Value'] },
  { code: 'VAL.AGREEMENT', label: 'Agreement value', group: 'VAL', type: 'money', unit: 'INR', sources: ['derived'], derivation: 'REG.CONSIDERATION' },
  { code: 'VAL.INSURABLE', label: 'Insurable value', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Insurable Value', 'Insurance value'] },
  { code: 'VAL.RENT', label: 'Rent (per month)', group: 'VAL', type: 'money', unit: 'INR', sources: ['valuation'], pending: 'Awaiting valuation', aliases: ['Rental value', 'Rent'] },
  { code: 'VAL.GV_VARIATION', label: 'Variation from guideline value', group: 'VAL', type: 'number', sources: ['derived'], derivation: '(VAL.FMV - VAL.GUIDELINE) / VAL.GUIDELINE' },
  { code: 'VAL.JUSTIFICATION', label: 'Justification for variation', group: 'VAL', type: 'longtext', sources: ['manual', 'wording'], pending: 'Awaiting valuation', aliases: ['Justification for 20% variation in FMV and GV', 'Justification for variation'] },
  { code: 'VAL.GV_SENTENCE', label: 'Guideline variation statement', group: 'VAL', type: 'longtext', sources: ['wording'], pending: 'Awaiting valuation', aliases: ['In case of variation of 20% or more in the valuation proposed by the valuer and the Guideline value provided in the State Govt. notification, a statement on the need for this variation has to be given'] },
  { code: 'VAL.RANGE_TEXT', label: 'Rates in nearby area', group: 'VAL', type: 'longtext', sources: ['wording'], pending: 'Awaiting market evidence', aliases: ['Details of last two transactions in the locality / area to be provided, if available', 'Details of last two transactions'] },
  { code: 'VAL.FMV_WORDS', label: 'Fair market value in words', group: 'VAL', type: 'text', sources: ['derived'], derivation: 'words(VAL.FMV)' },
  { code: 'VAL.REALIZABLE_WORDS', label: 'Realizable value in words', group: 'VAL', type: 'text', sources: ['derived'], derivation: 'words(VAL.REALIZABLE)' },
  { code: 'VAL.DISTRESS_WORDS', label: 'Distress value in words', group: 'VAL', type: 'text', sources: ['derived'], derivation: 'words(VAL.DISTRESS)' },
  { code: 'VAL.GUIDELINE_WORDS', label: 'Guideline value in words', group: 'VAL', type: 'text', sources: ['derived'], derivation: 'words(VAL.GUIDELINE)' },
  { code: 'VAL.METHOD_TEXT', label: 'Valuation method', group: 'VAL', type: 'text', sources: ['wording'], aliases: ['Procedures adopted in carrying out the valuation and valuation standards followed', 'Method of valuation'] },

  // ---- Report wording ----
  { code: 'REPORT.REMARK_1', label: 'Remark 1 (documents)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'] },
  { code: 'REPORT.REMARK_2', label: 'Remark 2 (occupancy)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'], pending: 'Awaiting site visit' },
  { code: 'REPORT.REMARK_3', label: 'Remark 3 (locality)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'] },
  { code: 'REPORT.REMARK_4', label: 'Remark 4 (location)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'] },
  { code: 'REPORT.REMARK_5', label: 'Remark 5 (shown by)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'], pending: 'Awaiting site visit' },
  { code: 'REPORT.REMARK_6', label: 'Remark 6 (area basis)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'] },
  { code: 'REPORT.REMARK_7', label: 'Remark 7 (purpose)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'] },
  { code: 'REPORT.REMARK_8', label: 'Remark 8 (encumbrances)', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'] },
  { code: 'REPORT.REMARKS', label: 'Remarks of the valuer', group: 'REPORT', type: 'longtext', sources: ['wording'], aliases: ['Remarks', 'Remarks of the valuer', 'General remarks'] },
  { code: 'REPORT.INSPECTION_DECL', label: 'Inspection declaration', group: 'REPORT', type: 'longtext', sources: ['wording'], pending: 'Awaiting site visit', aliases: ['i. Inspection', 'Inspection'] },
  { code: 'REPORT.BACKGROUND', label: 'Background of the asset', group: 'REPORT', type: 'longtext', sources: ['manual', 'wording'], aliases: ['Background information of the asset being valued'] },
  { code: 'REPORT.VALUER_IDENTITY', label: 'Valuer and experts involved', group: 'REPORT', type: 'text', sources: ['wording'], aliases: ['Identity of the valuer and any other experts involved in the valuation'] },
  { code: 'CASE.PURPOSE_AUTHORITY', label: 'Purpose and appointing authority', group: 'CASE', type: 'text', sources: ['wording'], aliases: ['Purpose of valuation and appointing authority'] },
  { code: 'REPORT.OPINION', label: 'Opinion on value', group: 'REPORT', type: 'longtext', sources: ['wording'], pending: 'Awaiting valuation', aliases: ['Opinion', 'Valuation opinion'] },
  { code: 'REPORT.SIGNATURE', label: 'Signature and seal', group: 'REPORT', type: 'image', sources: ['firm'], pending: 'Placed at sign-off', aliases: ['Signature', 'Signature of the valuer', 'Signature & seal', 'Signature & seal of the valuer'] },
];
