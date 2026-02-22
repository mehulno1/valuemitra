import { ReportStatus, BankCode, PropertyType } from './enums.js';

export interface ReportTemplate {
  id: string;
  tenantId?: string;
  name: string;
  bankName: string;
  bankCode: BankCode;
  propertyType: PropertyType;
  isUnderConstruction: boolean;
  version: string;
  templateFilePath: string;     // S3 key to processed .docx template
  fieldMappings: ReportFieldMappings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportFieldMappings {
  // Maps {token} names → data model paths
  textFields: Record<string, string>;

  // Dynamic table population
  tableFields: {
    valuationSummary?: { tableIndex: number; startRow: number };
    comparables?: { tableIndex: number; startRow: number };
    boundaryDetails?: { tableIndex: number; startRow: number };
  };

  // Image insertion tokens
  imageFields: {
    propertyPhotos?: { placeholderToken: string; maxCount: number };
    locationMap?: { placeholderToken: string };
    rvSignature?: { placeholderToken: string };
    rvStamp?: { placeholderToken: string };
    bankLogo?: { placeholderToken: string };
  };

  bankCode: BankCode;
  propertyType: PropertyType;
  isUnderConstruction: boolean;
}

export interface Report {
  id: string;
  assignmentId: string;
  templateId: string;
  valuationRunId?: string;
  status: ReportStatus;

  docxPath?: string;            // S3 key
  pdfPath?: string;             // S3 key

  // Complete merged data used to generate report (audit snapshot)
  reportData: ReportData;

  signedAt?: Date;
  signedById?: string;
  digitalSignature?: string;

  version: number;
  isLatest: boolean;

  generatedAt?: Date;
  deliveredAt?: Date;
  deliveredToEmail?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// REPORT DATA — flat merged object passed to docxtemplater
// All {token} values in templates map to fields here
// ─────────────────────────────────────────────

export interface ReportData {
  // Reference & dates
  referenceNo: string;
  firmReferenceNo: string;
  reportDate: string;
  inspectionDate: string;
  valuationDate: string;

  // RV / Valuer details (IBBI compliance)
  rvFullName: string;
  rvIbbiRegNo: string;
  rvIbbiRegCategory: string;
  rvIbbiRegValidUpto: string;
  rvQualifications: string;
  rvRvoName: string;
  rvPhone: string;
  rvEmail: string;

  // Firm details
  firmName: string;
  firmAddress: string;
  firmGstin: string;
  firmPhone: string;
  firmEmail: string;

  // Bank / Client details
  bankName: string;
  bankBranch: string;
  bankRefNo: string;
  clientName: string;
  loanAccountNo: string;

  // Purpose
  purposeOfValuation: string;
  propertyTypeLabel: string;

  // Property identification
  ownerName: string;
  propertyAddress: string;
  surveyNo: string;
  ctsSurveyNo: string;
  municipalNo: string;
  societyName: string;
  flatNo: string;
  floor: string;
  buildingName: string;
  district: string;
  taluka: string;
  pincode: string;

  // Land
  landAreaSqFt: string;
  landAreaSqM: string;
  landTenure: string;
  zoningClassification: string;

  // Building
  builtUpAreaSqFt: string;
  builtUpAreaSqM: string;
  carpetAreaSqFt: string;
  carpetAreaSqM: string;
  numberOfFloors: string;
  yearOfConstruction: string;
  ageOfBuilding: string;
  structureType: string;
  condition: string;

  // Under-construction specific
  percentageCompletion?: string;
  expectedHandoverDate?: string;

  // Government rates
  govtRateYear: string;
  govtRatePerSqFt: string;
  govtRatePerSqM: string;
  govtRateSource: string;

  // Valuation results
  landValue: string;
  buildingValue: string;
  finalValue: string;
  finalValueWords: string;     // "Rupees Forty-Five Lakhs Only"
  fairMarketValue: string;
  realizableValue: string;
  distressSaleValue: string;

  // Images (base64 or S3 signed URLs)
  propertyPhoto1?: string;
  propertyPhoto2?: string;
  propertyPhoto3?: string;
  propertyPhoto4?: string;
  locationMap?: string;
  rvSignature?: string;
  rvStamp?: string;

  // Comparable transactions (for narrative)
  comparablesNarrative?: string;

  // IBBI certificate
  ibbiCertificateText: string;
  independenceDeclaration: string;
  limitingConditions: string;
}
