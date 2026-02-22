import {
  AssignmentStatus,
  ValuationPurpose,
  PropertyType,
  LandTenure,
  ClientType,
  BankCode,
  ChecklistStatus,
  DocumentType,
} from './enums.js';

export interface Client {
  id: string;
  tenantId: string;
  clientType: ClientType;

  // Individual
  fullName?: string;
  pan?: string;
  aadhaarLast4?: string;

  // Corporate / Bank
  companyName?: string;
  cin?: string;
  gstin?: string;

  // Contact
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;

  // Bank-specific
  isBank: boolean;
  bankName?: string;
  bankCode?: BankCode;
  bankBranch?: string;
  ifscCode?: string;
  loanAccountNo?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface Assignment {
  id: string;
  tenantId: string;
  assignmentNo: string;           // e.g. "VM/2024-25/0042"
  firmReferenceNo: string;        // e.g. "UCVLLP/PNB/2025-26/0001"

  clientId: string;
  client?: Client;
  createdById: string;
  assignedToId?: string;

  purposeOfValuation: ValuationPurpose;
  propertyType: PropertyType;
  status: AssignmentStatus;

  // Under-construction specific
  isUnderConstruction: boolean;
  percentageCompletion?: number;
  expectedHandoverDate?: Date;

  // Key dates (IBBI compliance)
  inspectionDate?: Date;
  reportDate?: Date;
  submittedAt?: Date;

  // Fee
  agreedFee?: number;
  feeGst?: number;
  feePaidAt?: Date;

  // Bank instruction
  bankRefNo?: string;
  bankInstructionDate?: Date;

  // Result
  finalValue?: number;
  valuationCurrency: string;

  referenceNote?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface Property {
  id: string;
  tenantId: string;
  assignmentId: string;

  // Location
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;

  // Revenue identification
  surveyNo?: string;
  ctsSurveyNo?: string;
  municipalNo?: string;
  societyName?: string;
  flatNo?: string;
  floor?: number;
  buildingName?: string;

  // Land details
  landAreaSqM?: number;
  landAreaSqFt?: number;
  landAreaAcre?: number;
  landAreaHectare?: number;
  landTenure?: LandTenure;
  leaseExpiryDate?: Date;
  zoningClassification?: string;

  // Building details
  builtUpAreaSqM?: number;
  builtUpAreaSqFt?: number;
  carpetAreaSqM?: number;
  carpetAreaSqFt?: number;
  numberOfFloors?: number;
  yearOfConstruction?: number;
  ageOfBuilding?: number;

  // Structure
  structureType?: string;
  roofType?: string;
  exteriorCondition?: string;
  interiorCondition?: string;

  // Ownership (from OCR)
  ownerNames?: string[];

  // Flexible OCR extracted data
  extractedData?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export interface ChecklistItem {
  id: string;
  assignmentId: string;
  documentType: DocumentType;
  label: string;
  isMandatory: boolean;
  status: ChecklistStatus;
  documentId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// Assignment status transition rules
// ─────────────────────────────────────────────

export const ASSIGNMENT_STATUS_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  [AssignmentStatus.INITIATED]: [AssignmentStatus.TEMPLATE_SELECTED],
  [AssignmentStatus.TEMPLATE_SELECTED]: [AssignmentStatus.ASSIGNED, AssignmentStatus.INITIATED],
  [AssignmentStatus.ASSIGNED]: [AssignmentStatus.INSPECTION_SCHEDULED, AssignmentStatus.TEMPLATE_SELECTED],
  [AssignmentStatus.INSPECTION_SCHEDULED]: [AssignmentStatus.INSPECTION_DONE, AssignmentStatus.ASSIGNED],
  [AssignmentStatus.INSPECTION_DONE]: [AssignmentStatus.DOCUMENTS_PENDING],
  [AssignmentStatus.DOCUMENTS_PENDING]: [AssignmentStatus.DOCUMENTS_RECEIVED],
  [AssignmentStatus.DOCUMENTS_RECEIVED]: [AssignmentStatus.OCR_COMPLETE, AssignmentStatus.DOCUMENTS_PENDING],
  [AssignmentStatus.OCR_COMPLETE]: [AssignmentStatus.ANALYSIS_IN_PROGRESS],
  [AssignmentStatus.ANALYSIS_IN_PROGRESS]: [AssignmentStatus.REPORT_DRAFT, AssignmentStatus.OCR_COMPLETE],
  [AssignmentStatus.REPORT_DRAFT]: [AssignmentStatus.INTERNAL_REVIEW, AssignmentStatus.ANALYSIS_IN_PROGRESS],
  [AssignmentStatus.INTERNAL_REVIEW]: [AssignmentStatus.CLIENT_BANK_REVIEW, AssignmentStatus.REPORT_DRAFT],
  [AssignmentStatus.CLIENT_BANK_REVIEW]: [AssignmentStatus.COMPLIANCE_CHECK, AssignmentStatus.REPORT_DRAFT],
  [AssignmentStatus.COMPLIANCE_CHECK]: [AssignmentStatus.APPROVED, AssignmentStatus.REPORT_DRAFT],
  [AssignmentStatus.APPROVED]: [AssignmentStatus.DELIVERED],
  [AssignmentStatus.DELIVERED]: [AssignmentStatus.ARCHIVED],
  [AssignmentStatus.ARCHIVED]: [],
};
