import { DocumentType, PropertyType } from '../types/enums.js';

// ─────────────────────────────────────────────
// IBBI MANDATORY FIELDS FOR REPORT GENERATION
// Report generation is BLOCKED unless all these are present
// ─────────────────────────────────────────────

export const IBBI_MANDATORY_USER_FIELDS = [
  'ibbiRegNo',
  'ibbiRegCategory',
  'ibbiRegValidUpto',
  'signatureUrl',
] as const;

export const IBBI_MANDATORY_ASSIGNMENT_FIELDS = [
  'inspectionDate',
  'purposeOfValuation',
  // reportDate intentionally omitted — auto-populated in report builder as today's date
] as const;

export const IBBI_MANDATORY_PROPERTY_FIELDS = [
  'addressLine1',
  'city',
  'state',
] as const;

// Standard IBBI Certificate of Valuation text
export const IBBI_CERTIFICATE_TEXT = `I/We hereby certify that I/We have personally inspected the property/asset described herein and have valued the same as per the relevant valuation standards prescribed by the Insolvency and Bankruptcy Board of India (IBBI) under the IBBI (Registered Valuers and Valuation) Rules, 2017.

The valuation has been carried out independently and without any bias. I/We have no direct or indirect interest in the property/asset valued.

The value indicated herein is the fair market value of the property/asset as on the date of valuation, based on the information/documents provided to me/us and as observed during the site inspection.`;

export const IBBI_INDEPENDENCE_DECLARATION = `I/We declare that I/We have no present or prospective interest in the property that is the subject of this report, and I/We have no personal interest or bias with respect to the parties involved. My/Our compensation is not contingent upon the reporting of a predetermined value or a value that favours the cause of the client.`;

export const IBBI_LIMITING_CONDITIONS = `1. The valuation is based on information provided by the client and documents made available for inspection.
2. No responsibility is assumed for matters of legal nature affecting the property.
3. The valuation is subject to the accuracy of information provided.
4. The valuer has not carried out structural survey unless specifically instructed.
5. This report is for the exclusive use of the client and the specific purpose stated herein.`;

// ─────────────────────────────────────────────
// AUTO-GENERATED DOCUMENT CHECKLISTS
// Based on property type and valuation purpose
// ─────────────────────────────────────────────

export interface ChecklistTemplate {
  documentType: DocumentType;
  label: string;
  isMandatory: boolean;
}

export const DOCUMENT_CHECKLISTS: Record<PropertyType, ChecklistTemplate[]> = {
  [PropertyType.RESIDENTIAL_FLAT]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Agreement for Sale', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.PROPERTY_CARD, label: 'Property Card / CTS Extract', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt (Latest)', isMandatory: true },
    { documentType: DocumentType.OCCUPANCY_CERTIFICATE, label: 'Occupancy Certificate', isMandatory: false },
    { documentType: DocumentType.COMPLETION_CERTIFICATE, label: 'Completion Certificate', isMandatory: false },
    { documentType: DocumentType.SOCIETY_NOC, label: 'Society NOC / Share Certificate', isMandatory: false },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: false },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
    { documentType: DocumentType.IDENTITY_PROOF, label: 'Owner Identity Proof (PAN / Aadhaar)', isMandatory: false },
  ],
  [PropertyType.COMMERCIAL_SHOP]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Agreement for Sale', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.PROPERTY_CARD, label: 'Property Card / CTS Extract', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt', isMandatory: true },
    { documentType: DocumentType.OCCUPANCY_CERTIFICATE, label: 'Occupancy Certificate', isMandatory: true },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: false },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.COMMERCIAL_OFFICE]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Agreement for Sale', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.PROPERTY_CARD, label: 'Property Card / CTS Extract', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt', isMandatory: true },
    { documentType: DocumentType.OCCUPANCY_CERTIFICATE, label: 'Occupancy Certificate', isMandatory: true },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: false },
  ],
  [PropertyType.LAND_AND_BUILDING]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt', isMandatory: true },
    { documentType: DocumentType.NA_ORDER, label: 'NA Order (if applicable)', isMandatory: false },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: false },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.OPEN_LAND]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.NA_ORDER, label: 'NA Order (if applicable)', isMandatory: false },
    { documentType: DocumentType.LAYOUT_APPROVAL, label: 'Layout Approval', isMandatory: false },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.AGRICULTURAL_LAND]: [
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract', isMandatory: true },
    { documentType: DocumentType.EIGHT_A_EXTRACT, label: '8-A Extract (Gujarat)', isMandatory: false },
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.INDUSTRIAL_FACTORY]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract or Property Card', isMandatory: true },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Factory Building Plan Approval', isMandatory: true },
    { documentType: DocumentType.OCCUPANCY_CERTIFICATE, label: 'Occupancy Certificate', isMandatory: false },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Property Tax Receipt', isMandatory: true },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.INDUSTRIAL_PLOT]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Allotment Letter', isMandatory: true },
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract', isMandatory: false },
    { documentType: DocumentType.NA_ORDER, label: 'NA Order', isMandatory: false },
    { documentType: DocumentType.LAYOUT_APPROVAL, label: 'Layout Approval', isMandatory: false },
  ],
  [PropertyType.RESIDENTIAL_BUNGALOW]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract or Property Card', isMandatory: true },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: true },
    { documentType: DocumentType.COMPLETION_CERTIFICATE, label: 'Completion Certificate', isMandatory: false },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt', isMandatory: true },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.RESIDENTIAL_PLOT]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.SEVEN_TWELVE_EXTRACT, label: '7/12 Extract', isMandatory: true },
    { documentType: DocumentType.NA_ORDER, label: 'NA Order', isMandatory: false },
    { documentType: DocumentType.LAYOUT_APPROVAL, label: 'Approved Layout', isMandatory: false },
  ],
  [PropertyType.COMMERCIAL_SHOWROOM]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: true },
    { documentType: DocumentType.PROPERTY_CARD, label: 'Property Card', isMandatory: true },
    { documentType: DocumentType.OCCUPANCY_CERTIFICATE, label: 'Occupancy Certificate', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Tax Receipt', isMandatory: true },
  ],
  [PropertyType.MIXED_USE]: [
    { documentType: DocumentType.SALE_DEED, label: 'Sale Deed / Title Deed', isMandatory: true },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt', isMandatory: true },
    { documentType: DocumentType.OCCUPANCY_CERTIFICATE, label: 'Occupancy Certificate', isMandatory: false },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
  [PropertyType.UC_FLAT]: [
    { documentType: DocumentType.SALE_DEED, label: 'Agreement for Sale / Allotment Letter', isMandatory: true },
    { documentType: DocumentType.INDEX_II, label: 'Index II', isMandatory: false },
    { documentType: DocumentType.BUILDING_PLAN_APPROVAL, label: 'Approved Building Plan', isMandatory: true },
    { documentType: DocumentType.OTHER, label: 'RERA Registration Certificate', isMandatory: true },
    { documentType: DocumentType.MUNICIPAL_TAX_RECEIPT, label: 'Municipal Tax Receipt', isMandatory: false },
    { documentType: DocumentType.ENCUMBRANCE_CERTIFICATE, label: 'Encumbrance Certificate', isMandatory: false },
  ],
};
