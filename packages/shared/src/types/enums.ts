// ─────────────────────────────────────────────
// USER & AUTH ENUMS
// ─────────────────────────────────────────────

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',    // ValueMitra platform admin
  TENANT_ADMIN = 'TENANT_ADMIN',  // Firm admin
  VALUER = 'VALUER',              // Registered Valuer (can sign reports)
  ASSISTANT = 'ASSISTANT',        // Support staff (can prepare, cannot sign)
  VIEWER = 'VIEWER',              // Read-only (bank user / client portal)
}

// ─────────────────────────────────────────────
// ASSIGNMENT LIFECYCLE (matches Valuation Report Lifecycle diagram)
// ─────────────────────────────────────────────

export enum AssignmentStatus {
  // Phase 1: Initiation
  INITIATED = 'INITIATED',
  TEMPLATE_SELECTED = 'TEMPLATE_SELECTED',
  ASSIGNED = 'ASSIGNED',
  INSPECTION_SCHEDULED = 'INSPECTION_SCHEDULED',

  // Phase 2: Data Gathering
  INSPECTION_DONE = 'INSPECTION_DONE',
  DOCUMENTS_PENDING = 'DOCUMENTS_PENDING',
  DOCUMENTS_RECEIVED = 'DOCUMENTS_RECEIVED',
  OCR_COMPLETE = 'OCR_COMPLETE',

  // Phase 3: AI & Analysis
  ANALYSIS_IN_PROGRESS = 'ANALYSIS_IN_PROGRESS',

  // Phase 4: Report Generation
  REPORT_DRAFT = 'REPORT_DRAFT',

  // Phase 5: Review & Delivery
  INTERNAL_REVIEW = 'INTERNAL_REVIEW',
  CLIENT_BANK_REVIEW = 'CLIENT_BANK_REVIEW',
  COMPLIANCE_CHECK = 'COMPLIANCE_CHECK',
  APPROVED = 'APPROVED',

  // Phase 6: Final Output
  DELIVERED = 'DELIVERED',
  ARCHIVED = 'ARCHIVED',
}

export enum ValuationPurpose {
  MORTGAGE = 'MORTGAGE',
  INSURANCE = 'INSURANCE',
  ACQUISITION = 'ACQUISITION',
  AMALGAMATION = 'AMALGAMATION',
  COURT_MATTER = 'COURT_MATTER',
  INCOME_TAX = 'INCOME_TAX',
  WEALTH_TAX = 'WEALTH_TAX',
  STAMP_DUTY = 'STAMP_DUTY',
  FAIR_VALUE = 'FAIR_VALUE',
  LIQUIDATION = 'LIQUIDATION',
  OTHER = 'OTHER',
}

// ─────────────────────────────────────────────
// PROPERTY TYPES (covers all 21 templates)
// ─────────────────────────────────────────────

export enum PropertyType {
  RESIDENTIAL_FLAT = 'RESIDENTIAL_FLAT',
  RESIDENTIAL_BUNGALOW = 'RESIDENTIAL_BUNGALOW',
  RESIDENTIAL_PLOT = 'RESIDENTIAL_PLOT',
  COMMERCIAL_OFFICE = 'COMMERCIAL_OFFICE',
  COMMERCIAL_SHOP = 'COMMERCIAL_SHOP',
  COMMERCIAL_SHOWROOM = 'COMMERCIAL_SHOWROOM',
  INDUSTRIAL_FACTORY = 'INDUSTRIAL_FACTORY',
  INDUSTRIAL_PLOT = 'INDUSTRIAL_PLOT',
  LAND_AND_BUILDING = 'LAND_AND_BUILDING',
  OPEN_LAND = 'OPEN_LAND',
  AGRICULTURAL_LAND = 'AGRICULTURAL_LAND',
  MIXED_USE = 'MIXED_USE',
}

export enum LandTenure {
  FREEHOLD = 'FREEHOLD',
  LEASEHOLD = 'LEASEHOLD',
  GOVERNMENT_LEASE = 'GOVERNMENT_LEASE',
}

// ─────────────────────────────────────────────
// CLIENT TYPES
// ─────────────────────────────────────────────

export enum ClientType {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
  BANK = 'BANK',
  NBFC = 'NBFC',
  HFC = 'HFC',
}

// ─────────────────────────────────────────────
// BANK CODES (covers all 21 templates + extensible)
// ─────────────────────────────────────────────

export enum BankCode {
  BOB = 'BOB',        // Bank of Baroda
  BOI = 'BOI',        // Bank of India
  BOM = 'BOM',        // Bank of Maharashtra
  CANARA = 'CANARA',  // Canara Bank
  PNB = 'PNB',        // Punjab National Bank
  SBI = 'SBI',        // State Bank of India
  NKGSB = 'NKGSB',   // NKGSB Cooperative Bank
  UBI = 'UBI',        // Union Bank of India
  HDFC = 'HDFC',      // HDFC Bank
  ICICI = 'ICICI',    // ICICI Bank
  AXIS = 'AXIS',      // Axis Bank
  OTHER = 'OTHER',
}

// ─────────────────────────────────────────────
// DOCUMENT TYPES
// ─────────────────────────────────────────────

export enum DocumentType {
  SALE_DEED = 'SALE_DEED',
  SEVEN_TWELVE_EXTRACT = 'SEVEN_TWELVE_EXTRACT',   // 7/12 Utara (Maharashtra)
  EIGHT_A_EXTRACT = 'EIGHT_A_EXTRACT',              // 8-A (Gujarat)
  PROPERTY_CARD = 'PROPERTY_CARD',
  INDEX_II = 'INDEX_II',
  MUNICIPAL_TAX_RECEIPT = 'MUNICIPAL_TAX_RECEIPT',
  ENCUMBRANCE_CERTIFICATE = 'ENCUMBRANCE_CERTIFICATE',
  BUILDING_PLAN_APPROVAL = 'BUILDING_PLAN_APPROVAL',
  COMPLETION_CERTIFICATE = 'COMPLETION_CERTIFICATE',
  OCCUPANCY_CERTIFICATE = 'OCCUPANCY_CERTIFICATE',
  POSSESSION_CERTIFICATE = 'POSSESSION_CERTIFICATE',
  SOCIETY_NOC = 'SOCIETY_NOC',
  TITLE_CHAIN_DOCUMENT = 'TITLE_CHAIN_DOCUMENT',
  IDENTITY_PROOF = 'IDENTITY_PROOF',
  SITE_PHOTOGRAPH = 'SITE_PHOTOGRAPH',
  LOCATION_MAP = 'LOCATION_MAP',
  NA_ORDER = 'NA_ORDER',                            // Non-Agricultural conversion order
  LAYOUT_APPROVAL = 'LAYOUT_APPROVAL',
  LEASE_DEED = 'LEASE_DEED',
  VALUATION_REPORT_DRAFT = 'VALUATION_REPORT_DRAFT',
  OTHER = 'OTHER',
}

export enum OCRStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

export enum ChecklistStatus {
  PENDING = 'PENDING',
  UPLOADED = 'UPLOADED',
  VERIFIED = 'VERIFIED',
  WAIVED = 'WAIVED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

// ─────────────────────────────────────────────
// VALUATION ENUMS
// ─────────────────────────────────────────────

export enum ValuationApproach {
  MARKET_COMPARISON = 'MARKET_COMPARISON',
  COST_APPROACH = 'COST_APPROACH',
  INCOME_APPROACH = 'INCOME_APPROACH',
  COMBINED = 'COMBINED',
}

export enum DepreciationMethod {
  STRAIGHT_LINE = 'STRAIGHT_LINE',
  WDV = 'WDV',
  OBSERVED = 'OBSERVED',
  CPWD_SCHEDULE = 'CPWD_SCHEDULE',
}

// ─────────────────────────────────────────────
// REPORT ENUMS
// ─────────────────────────────────────────────

export enum ReportStatus {
  DRAFT = 'DRAFT',
  GENERATED = 'GENERATED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  SIGNED = 'SIGNED',
  DELIVERED = 'DELIVERED',
  REJECTED = 'REJECTED',
}

// ─────────────────────────────────────────────
// NOTIFICATION ENUMS
// ─────────────────────────────────────────────

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  IN_APP = 'IN_APP',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

// ─────────────────────────────────────────────
// JOB QUEUE ENUMS
// ─────────────────────────────────────────────

export enum JobStatus {
  PENDING = 'PENDING',
  LOCKED = 'LOCKED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum JobType {
  OCR_PROCESSING = 'OCR_PROCESSING',
  GOVT_RATE_FETCH = 'GOVT_RATE_FETCH',
  REPORT_GENERATE = 'REPORT_GENERATE',
  REPORT_PDF_CONVERT = 'REPORT_PDF_CONVERT',
  EMAIL_SEND = 'EMAIL_SEND',
  CACHE_CLEANUP = 'CACHE_CLEANUP',
}

// ─────────────────────────────────────────────
// GOVERNMENT RATE ENUMS
// ─────────────────────────────────────────────

export enum StateCode {
  MAHARASHTRA = 'MAHARASHTRA',
  GUJARAT = 'GUJARAT',
  KARNATAKA = 'KARNATAKA',
  DELHI = 'DELHI',
  RAJASTHAN = 'RAJASTHAN',
  MADHYA_PRADESH = 'MADHYA_PRADESH',
  UTTAR_PRADESH = 'UTTAR_PRADESH',
  TELANGANA = 'TELANGANA',
  TAMIL_NADU = 'TAMIL_NADU',
  WEST_BENGAL = 'WEST_BENGAL',
}

export enum RateCategory {
  RESIDENTIAL = 'RESIDENTIAL',
  COMMERCIAL = 'COMMERCIAL',
  INDUSTRIAL = 'INDUSTRIAL',
  AGRICULTURAL = 'AGRICULTURAL',
  OPEN_LAND = 'OPEN_LAND',
}
