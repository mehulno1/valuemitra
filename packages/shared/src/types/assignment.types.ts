import {
  AssignmentStatus,
  ValuationPurpose,
  PropertyType,
  LandTenure,
  ClientType,
  BankCode,
  ChecklistStatus,
  DocumentType,
  LoanType,
  BuildingCompletionStatus,
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
  freshOrRevaluation?: string;     // "Fresh" | "Revaluation" | "Review"

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

  // GEN_006: Bank branch for this specific assignment
  bankBranchAddress?: string;
  // GEN_007: Bank RM / contact
  bankRepresentative?: string;

  // INS_001: Loan / assignment type
  loanType?: LoanType;
  // INS_002: Detailed property sub-type
  propertySubType?: string;

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
  taluka?: string;
  village?: string;
  state?: string;
  pincode?: string;
  landmark?: string;
  municipalCorporation?: string;
  latitude?: number;
  longitude?: number;

  // Revenue identification
  surveyNo?: string;
  hissaNo?: string;
  ctsSurveyNo?: string;
  municipalNo?: string;
  societyName?: string;
  flatNo?: string;
  floor?: number;
  wingName?: string;
  buildingName?: string;
  streetName?: string;           // LOC_008

  // Ownership (OWN section)
  ownerNames?: string[];
  ownerAddress?: string;         // OWN_002
  ownerContact?: string;         // OWN_003
  ownerPan?: string;             // OWN_004
  ownershipNature?: string;      // OWN_005
  ownerShareDetails?: string;    // OWN_006
  borrowerName?: string;         // OWN_007: applicant/borrower (may differ from owner)
  developerName?: string;        // OWN_008
  reraNo?: string;

  // Land details
  landAreaSqM?: number;
  landAreaSqFt?: number;
  landAreaAcre?: number;
  landAreaHectare?: number;
  landTenure?: LandTenure;
  leaseExpiryDate?: Date;
  zoningClassification?: string;

  // Building details — document values
  builtUpAreaSqM?: number;
  builtUpAreaSqFt?: number;
  carpetAreaSqM?: number;
  carpetAreaSqFt?: number;
  superBuiltUpAreaSqM?: number;
  superBuiltUpAreaSqFt?: number;
  unitConfiguration?: string;
  numberOfFloors?: number;
  yearOfConstruction?: number;
  ageOfBuilding?: number;
  remainingLifeYears?: number;

  // Actual site-measured areas
  builtUpAreaActualSqM?: number;
  builtUpAreaActualSqFt?: number;
  carpetAreaActualSqM?: number;
  carpetAreaActualSqFt?: number;
  landAreaActualSqM?: number;
  landAreaActualSqFt?: number;

  // UDS + land details
  udsArea?: number;
  udsUnit?: string;
  dpZone?: string;
  fsi?: number;
  permissibleUse?: string;
  naOrderDetails?: string;
  miDcPlotNo?: string;

  // BLDG_006: Building completion status
  buildingCompletionStatus?: BuildingCompletionStatus;

  // BLDA_005–006: External development + industrial structures
  externalDevAreaSqM?: number;
  externalDevAreaSqFt?: number;
  industrialStructures?: string;

  // SITE_011 / ANN_004: Location map screenshot
  locationMapUrl?: string;

  // Structure
  structureType?: string;
  roofType?: string;
  exteriorCondition?: string;
  interiorCondition?: string;

  // Building compliance
  approvedPlanAuthority?: string;
  approvedPlanDate?: Date;
  approvedPlanValidity?: Date;
  planGenuinenessVerified?: boolean;
  unauthorizedConstruction?: boolean;
  unauthorizedConstructionNotes?: string;
  demolitionProceedings?: boolean;
  demolitionProceedingsNotes?: string;

  // Grouped JSON fields
  areaClassification?: Record<string, string>;
  physicalDetails?: Record<string, string>;
  boundaryDetails?: Record<string, string>;
  buildingFloors?: Array<{ floorLabel: string; useType: string; builtUpAreaSqM?: number; builtUpAreaSqFt?: number; remarks?: string }>;

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

// New workflow order:
// INITIATED → DOCUMENTS_PENDING → DOCUMENTS_RECEIVED → OCR_COMPLETE
//   → DATA_VERIFIED → INSPECTION_SCHEDULED → INSPECTION_DONE
//   → ANALYSIS_IN_PROGRESS → REPORT_DRAFT → review stages → DELIVERED
export const ASSIGNMENT_STATUS_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  [AssignmentStatus.INITIATED]: [AssignmentStatus.DOCUMENTS_PENDING, AssignmentStatus.ASSIGNED, AssignmentStatus.INSPECTION_SCHEDULED],
  [AssignmentStatus.TEMPLATE_SELECTED]: [AssignmentStatus.ASSIGNED, AssignmentStatus.INITIATED],
  [AssignmentStatus.ASSIGNED]: [AssignmentStatus.DOCUMENTS_PENDING, AssignmentStatus.INSPECTION_SCHEDULED],
  [AssignmentStatus.DOCUMENTS_PENDING]: [AssignmentStatus.DOCUMENTS_RECEIVED],
  [AssignmentStatus.DOCUMENTS_RECEIVED]: [AssignmentStatus.OCR_COMPLETE, AssignmentStatus.DOCUMENTS_PENDING],
  [AssignmentStatus.OCR_COMPLETE]: [AssignmentStatus.DATA_VERIFIED, AssignmentStatus.ANALYSIS_IN_PROGRESS],
  [AssignmentStatus.DATA_VERIFIED]: [AssignmentStatus.INSPECTION_SCHEDULED, AssignmentStatus.ANALYSIS_IN_PROGRESS],
  [AssignmentStatus.INSPECTION_SCHEDULED]: [AssignmentStatus.INSPECTION_DONE, AssignmentStatus.DATA_VERIFIED],
  [AssignmentStatus.INSPECTION_DONE]: [AssignmentStatus.ANALYSIS_IN_PROGRESS],
  [AssignmentStatus.ANALYSIS_IN_PROGRESS]: [AssignmentStatus.REPORT_DRAFT, AssignmentStatus.OCR_COMPLETE],
  [AssignmentStatus.REPORT_DRAFT]: [AssignmentStatus.INTERNAL_REVIEW, AssignmentStatus.ANALYSIS_IN_PROGRESS],
  [AssignmentStatus.INTERNAL_REVIEW]: [AssignmentStatus.CLIENT_BANK_REVIEW, AssignmentStatus.REPORT_DRAFT],
  [AssignmentStatus.CLIENT_BANK_REVIEW]: [AssignmentStatus.COMPLIANCE_CHECK, AssignmentStatus.REPORT_DRAFT],
  [AssignmentStatus.COMPLIANCE_CHECK]: [AssignmentStatus.APPROVED, AssignmentStatus.REPORT_DRAFT],
  [AssignmentStatus.APPROVED]: [AssignmentStatus.DELIVERED],
  [AssignmentStatus.DELIVERED]: [AssignmentStatus.ARCHIVED],
  [AssignmentStatus.ARCHIVED]: [],
};
