// ─────────────────────────────────────────────
// USER & AUTH ENUMS
// ─────────────────────────────────────────────

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',    // ValueMitra platform admin
  TENANT_ADMIN = 'TENANT_ADMIN',  // Firm admin
  VALUER = 'VALUER',              // Registered Valuer (can sign reports)
  ASSISTANT = 'ASSISTANT',        // Support staff (can prepare, cannot sign)
  VIEWER = 'VIEWER',              // Read-only (bank user / client portal)
  INSPECTOR = 'INSPECTOR',        // Site inspector — can only fill assigned inspections
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
  DATA_VERIFIED = 'DATA_VERIFIED',       // Property data extracted + verified by valuer

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
  UC_FLAT = 'UC_FLAT',  // Under-Construction Flat — distinct workflow from RESIDENTIAL_FLAT
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
  INSPECTION_PHOTO = 'INSPECTION_PHOTO',  // Taken during site inspection
  EXTERIOR_PHOTO = 'EXTERIOR_PHOTO',      // Exterior / building photo
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

// ─────────────────────────────────────────────
// PHOTO CATEGORY ENUM (INS_051–062)
// ─────────────────────────────────────────────

export enum PhotoCategory {
  BUILDING_EXTERIOR = 'BUILDING_EXTERIOR',       // INS_051: Compulsory, min 2
  ENTRANCE_DOOR = 'ENTRANCE_DOOR',               // INS_052: Door with nameplate
  SOCIETY_BOARD = 'SOCIETY_BOARD',               // INS_053: Building/society name board
  LIVING_ROOM = 'LIVING_ROOM',                   // INS_054: Hall/living area
  KITCHEN = 'KITCHEN',                           // INS_055
  BEDROOM = 'BEDROOM',                           // INS_056: At least 1 per room
  TOILET_BATHROOM = 'TOILET_BATHROOM',           // INS_057
  TERRACE_BALCONY = 'TERRACE_BALCONY',           // INS_058: If present
  INTERIOR_GENERAL = 'INTERIOR_GENERAL',         // INS_059: General interior
  DAMAGE_DEFECTS = 'DAMAGE_DEFECTS',             // INS_060: Cracks, seepage, defects
  APPROACH_ROAD = 'APPROACH_ROAD',               // INS_061: Road & surroundings
  FLOOR_PLAN_SKETCH = 'FLOOR_PLAN_SKETCH',       // INS_062: Compulsory dimensioned sketch
}

// ─────────────────────────────────────────────
// LOAN / ASSIGNMENT TYPE (INS_001)
// ─────────────────────────────────────────────

export enum LoanType {
  BUILDER = 'BUILDER',
  RESALE = 'RESALE',
  TOP_UP = 'TOP_UP',
  BALANCE_TRANSFER = 'BALANCE_TRANSFER',
  HEHL = 'HEHL',                // Home Equity / Home Loan
  LAP = 'LAP',                  // Loan Against Property
  APF = 'APF',                  // Approved Project Finance
  OTHER = 'OTHER',
}

// ─────────────────────────────────────────────
// UC CONSTRUCTION STAGE STATUS (INS_035–044)
// ─────────────────────────────────────────────

export enum ConstructionStageStatus {
  COMPLETED = 'COMPLETED',
  IN_PROGRESS = 'IN_PROGRESS',
  NOT_STARTED = 'NOT_STARTED',
}

export enum LiftInstallationStatus {
  INSTALLED = 'INSTALLED',
  IN_PROGRESS = 'IN_PROGRESS',
  NOT_STARTED = 'NOT_STARTED',
}

// ─────────────────────────────────────────────
// BUILDING COMPLETION STATUS (BLDG_006)
// ─────────────────────────────────────────────

export enum BuildingCompletionStatus {
  FULLY_COMPLETED = 'FULLY_COMPLETED',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
  UNDER_CONSTRUCTION = 'UNDER_CONSTRUCTION',
}
