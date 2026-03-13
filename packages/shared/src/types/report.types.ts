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

  // Bank-specific conditional flags
  realizableValuePct: number;           // 0.90 (default) or 0.95 (BOI/UBI)
  showDualStageValuation: boolean;      // BOI/UBI UC: show 100% + current stage
  showInsuranceValue: boolean;          // SBI, BOM
  showBookValue: boolean;               // BOM UC, SBI L&B, UBI UC
  showRentalValue: boolean;             // Canara, SBI
  showPurchasePrice: boolean;           // BOI UC, UBI UC

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
  firmCity: string;
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
  ownershipNature: string;         // Individual/Joint/Company/HUF/Partnership
  ownerShareDetails: string;       // e.g. "50% each"
  developerName: string;           // Builder/Developer (UC/L&B)
  propertyAddress: string;
  surveyNo: string;
  hissaNo: string;                 // Hissa/sub-division number
  ctsSurveyNo: string;
  municipalNo: string;
  societyName: string;
  flatNo: string;
  floor: string;
  wingName: string;                // Wing/Tower/Block
  buildingName: string;
  reraNo: string;                  // RERA registration number
  district: string;
  taluka: string;
  village: string;
  landmark: string;
  municipalCorporation: string;    // MCGM/Panchayat etc.
  pincode: string;

  // Area classification
  areaType: string;                // Residential/Commercial/Industrial
  areaClassificationGrade: string; // High/Middle/Poor
  urbanRuralClass: string;         // Urban/Semi-Urban/Rural
  municipalBodyType: string;       // Corporation/Municipality/Gram Panchayat
  govtEnactments: string;          // Covered under enactments (if any)

  // Physical / site description
  landNature: string;              // Agricultural/Non-Agricultural/Commercial Plot
  plotShape: string;               // Regular/Irregular/Corner
  directAccess: string;            // Yes/No — NKGSB requirement
  boundaryNature: string;          // Compound Wall/Wire Fencing etc.
  possessionStatus: string;        // Owner's Possession/Third-Party/Disputed

  // Boundary details (N/S/E/W × doc/actual)
  northBoundaryDoc: string;
  southBoundaryDoc: string;
  eastBoundaryDoc: string;
  westBoundaryDoc: string;
  northBoundaryActual: string;
  southBoundaryActual: string;
  eastBoundaryActual: string;
  westBoundaryActual: string;

  // Land
  landAreaSqFt: string;
  landAreaSqM: string;
  landTenure: string;
  zoningClassification: string;
  udsArea: string;                  // Undivided Share of Land (flat/UC)
  udsAreaFormatted: string;
  udsUnit: string;                  // Sq.Ft / Sq.M / fraction
  dpZone: string;                   // Development Plan zone
  fsi: string;                      // FSI/FAR permitted
  permissibleUse: string;           // Permissible use as per DP
  naOrderDetails: string;           // Non-agricultural order
  miDcPlotNo: string;               // MIDC plot number

  // Building
  builtUpAreaSqFt: string;
  builtUpAreaSqM: string;
  carpetAreaSqFt: string;
  carpetAreaSqM: string;
  superBuiltUpAreaSqFt: string;    // Saleable/super built-up area
  superBuiltUpAreaSqM: string;
  unitConfiguration: string;       // e.g. "2BHK+2T", "Open plan office"
  numberOfFloors: string;
  yearOfConstruction: string;
  ageOfBuilding: string;
  remainingLifeYears: string;      // Remaining economic life (years)
  structureType: string;
  condition: string;

  // Actual site-measured areas (vs document values above)
  builtUpAreaActualSqFt: string;
  builtUpAreaActualSqM: string;
  carpetAreaActualSqFt: string;
  carpetAreaActualSqM: string;
  landAreaActualSqFt: string;
  landAreaActualSqM: string;

  // Building compliance
  approvedPlanAuthority: string;   // MCGM/NMMC/CIDCO/Gram Panchayat
  approvedPlanDateFormatted: string;
  approvedPlanValidityFormatted: string;
  planGenuinenessVerified: string; // "Yes" / "No" / ""
  unauthorizedConstruction: string; // "Yes" / "No" / ""
  demolitionProceedings: string;   // "Yes" / "No" / ""

  // L&B building floors breakdown
  buildingFloorsNarrative: string; // Formatted per-floor summary

  // Unit finishes (from inspection)
  flooringType: string;
  wallFinishing: string;
  ceilingHeightFt: string;
  electricalFittings: string;
  sanitaryFittings: string;
  acType: string;
  leaseholdDetails: string;        // Canara Shop: Lessor/Lessee/Period

  // Site occupancy (from inspection)
  occupantName: string;
  occupantRelation: string;
  occupiedSince: string;
  nameOnBoard: string;             // Society/building name on board

  // Market analysis narrative
  marketAnalysisNarrative: string;

  // Under-construction specific
  freshOrRevaluation: string;      // Fresh/Revaluation/Review
  percentageCompletion?: string;
  expectedHandoverDate?: string;
  // presentStageValue is in the extended valuation fields section below

  // Government rates
  govtRateYear: string;
  govtRatePerSqFt: string;
  govtRatePerSqM: string;
  govtRateSource: string;

  // Valuation results
  landValue: string;
  buildingValue: string;
  finalValue: string;
  finalValueWords: string;         // "Rupees Forty-Five Lakhs Only"
  fairMarketValue: string;
  realizableValue: string;         // computed from finalValue × realizableValuePct
  realizableValueWords: string;
  realizableValuePct: string;      // "90%" or "95%" — from ReportTemplate
  distressSaleValue: string;

  // Market analysis
  marketabilityRating: string;     // Good/Average/Poor/Low
  positiveFactors: string;         // Canara "favourable factors"
  negativeFactors: string;         // Canara "negative factors"

  // Extended valuation fields (flat / commercial templates)
  compositeRatePerSqFt?: string;   // ₹/sq.ft composite rate
  compositeRateFormatted?: string;
  carParkingCount?: string;
  carParkingValuePerUnit?: string;
  carParkingTotalValue?: string;

  // Bank-conditional output values
  insuranceValue?: string;         // SBI, BOM
  insuranceValueWords?: string;
  insuranceValueFormatted?: string;
  rentalValueMonthly?: string;     // Canara, SBI (monthly)
  rentalValueFormatted?: string;
  bookValue?: string;              // BOM UC, SBI L&B
  bookValueFormatted?: string;
  bookValueWords?: string;

  // Bank-conditional flags (for template conditional rendering)
  showDualStageValuation?: boolean;
  showInsuranceValue?: boolean;
  showBookValue?: boolean;
  showRentalValue?: boolean;
  showPurchasePrice?: boolean;

  // Under-construction: value at current stage (BOI/UBI dual-stage)
  presentStageValue?: string;
  presentStageValueWords?: string;

  // Site visit / inspection photos (up to 12)
  propertyPhoto1?: string;
  propertyPhoto2?: string;
  propertyPhoto3?: string;
  propertyPhoto4?: string;
  propertyPhoto5?: string;
  propertyPhoto6?: string;
  propertyPhoto7?: string;
  propertyPhoto8?: string;
  propertyPhoto9?: string;
  propertyPhoto10?: string;
  propertyPhoto11?: string;
  propertyPhoto12?: string;
  // Location map (Google Maps Static API or uploaded LOCATION_MAP doc)
  locationMap?: string;
  // RV signature + stamp
  rvSignature?: string;
  rvStamp?: string;
  // Government RR rate screenshot
  rrRateScreenshot?: string;
  // Online property rate evidence screenshots (from documents)
  onlineRate1?: string;
  onlineRate2?: string;
  onlineRate3?: string;
  onlineRate4?: string;

  // Comparable transactions (for narrative)
  comparablesNarrative?: string;

  // IBBI certificate
  ibbiCertificateText: string;
  independenceDeclaration: string;
  limitingConditions: string;
}
