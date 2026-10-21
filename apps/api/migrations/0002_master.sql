-- WP2 Master data: canonical dictionary, versioned configuration (profiles, rules, checks, wording,
-- checklists), banks and branches, engineers, ready reckoner, comparables.

-- Canonical parameter dictionary. A field code is stable and never reused; edits create a new version.
CREATE TABLE canonical_fields (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NULL,             -- NULL = platform field available to every firm
  code            VARCHAR(80)  NOT NULL,            -- AREA.BUA, DOC.OC.NUMBER, VAL.FMV
  version         INT UNSIGNED NOT NULL,
  label           VARCHAR(200) NOT NULL,
  group_code      VARCHAR(40)  NOT NULL,            -- CUST, PROP, APPR, DOC, PHYS, OCC, AREA, REG, VAL, SITE, FIRM, CASE, REPORT
  description     VARCHAR(1000) NULL,
  data_type       VARCHAR(20)  NOT NULL,            -- text, longtext, number, area, money, date, enum, boolean, image, list
  unit            VARCHAR(20)  NULL,                -- sqft, sqm, INR, years, km
  enum_options    JSON NULL,
  applies_to      JSON NOT NULL,                    -- ["flat","shop","office"] or ["*"]
  sources         JSON NOT NULL,                    -- ordered: ["agreement","index2","site_sheet","manual"]
  validation      JSON NULL,                        -- [{"expr":"value > 0","message":"..."}]
  derivation      VARCHAR(1000) NULL,               -- expression in the config language
  rules           JSON NULL,                        -- e.g. agreement between two derived candidates
  extraction_hint VARCHAR(1000) NULL,               -- guidance to the extraction model
  aliases         JSON NULL,                        -- alternate labels, used by template auto-mapping
  pending_label   VARCHAR(80) NULL,                 -- "Awaiting O.C."
  sort_order      INT NOT NULL DEFAULT 0,
  status          ENUM('active','deprecated') NOT NULL DEFAULT 'active',
  change_note     VARCHAR(500) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  firm_key        BIGINT UNSIGNED AS (IFNULL(firm_id, 0)) STORED,
  UNIQUE KEY uq_field_version (firm_key, code, version),
  KEY ix_field_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Generic versioned configuration objects. kind: profile | rule_set | check_set | wording | checklist | doc_types.
-- Published versions are immutable; edits create a new draft. Assignments pin the versions they use.
CREATE TABLE config_versions (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NULL,
  kind          VARCHAR(30) NOT NULL,
  ckey          VARCHAR(80) NOT NULL,               -- flat, default, bank:SBI, ...
  version       INT UNSIGNED NOT NULL,
  status        ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  effective_from DATE NULL,
  payload_json  JSON NOT NULL,
  change_note   VARCHAR(500) NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_by  BIGINT UNSIGNED NULL,
  published_at  DATETIME(3) NULL,
  firm_key      BIGINT UNSIGNED AS (IFNULL(firm_id, 0)) STORED,
  UNIQUE KEY uq_cfg (firm_key, kind, ckey, version),
  KEY ix_cfg_lookup (kind, ckey, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE banks (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(12) NOT NULL,
  name       VARCHAR(150) NOT NULL,
  short_name VARCHAR(60) NULL,
  status     ENUM('active','retired') NOT NULL DEFAULT 'active',
  UNIQUE KEY uq_bank_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Branches a firm works with (contacts, payer, cycle and fee are firm-specific).
CREATE TABLE bank_branches (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id        BIGINT UNSIGNED NOT NULL,
  bank_id        BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(20) NOT NULL,              -- HLCTHN
  name           VARCHAR(150) NOT NULL,             -- Home Loan Centre, Thane
  address        VARCHAR(500) NULL,
  city           VARCHAR(100) NULL,
  state_code     CHAR(2) NULL,
  gstin          VARCHAR(15) NULL,
  contact_name   VARCHAR(150) NULL,
  contact_role   VARCHAR(100) NULL,
  contact_email  VARCHAR(190) NULL,
  contact_phone  VARCHAR(30) NULL,
  default_payer  ENUM('bank','borrower') NOT NULL DEFAULT 'bank',
  billing_cycle  ENUM('case','batch') NOT NULL DEFAULT 'case',
  fee            DECIMAL(12,2) NULL,
  status         ENUM('active','retired') NOT NULL DEFAULT 'active',
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_branch (firm_id, bank_id, code),
  CONSTRAINT fk_br_bank FOREIGN KEY (bank_id) REFERENCES banks(id),
  CONSTRAINT fk_br_firm FOREIGN KEY (firm_id) REFERENCES firms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE engineers (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(150) NOT NULL,
  phone         VARCHAR(30) NULL,
  email         VARCHAR(190) NULL,
  localities    VARCHAR(500) NULL,
  fee_per_visit DECIMAL(10,2) NULL,
  status        ENUM('active','retired') NOT NULL DEFAULT 'active',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_eng_firm (firm_id),
  CONSTRAINT fk_eng_firm FOREIGN KEY (firm_id) REFERENCES firms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Ready reckoner (stamp-duty guideline) rates, imported per year. Not tied to one state.
CREATE TABLE ready_reckoner_rates (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NULL,               -- NULL = shared import
  year_label    VARCHAR(9) NOT NULL,                -- 2025-26
  state_code    CHAR(2) NOT NULL,
  district      VARCHAR(100) NOT NULL,
  taluka        VARCHAR(100) NULL,
  village       VARCHAR(150) NOT NULL,
  village_alt   VARCHAR(300) NULL,                  -- other spellings / Marathi name, comma-separated
  zone          VARCHAR(40) NULL,
  category      VARCHAR(40) NOT NULL,               -- residential, shop, office, open_land, industrial
  rate_per_sqm  DECIMAL(14,2) NOT NULL,
  source        VARCHAR(200) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_rr_lookup (year_label, state_code, district, village, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Comparables database: firm-private by default; anonymised shared copies only with consent.
CREATE TABLE comparables (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NULL,             -- NULL = shared anonymised pool
  scope           ENUM('private','shared') NOT NULL DEFAULT 'private',
  source_type     ENUM('index2','igr_search','listing','own_report','import','broker') NOT NULL,
  source_ref      VARCHAR(200) NULL,                -- Index II 7044/2025, 99acres URL, report no.
  property_type   VARCHAR(20) NOT NULL,
  building        VARCHAR(200) NULL,
  society         VARCHAR(200) NULL,
  locality        VARCHAR(200) NULL,
  village         VARCHAR(150) NULL,
  city            VARCHAR(100) NULL,
  lat             DECIMAL(10,7) NULL,
  lng             DECIMAL(10,7) NULL,
  txn_date        DATE NULL,
  is_asking_price TINYINT(1) NOT NULL DEFAULT 0,
  area_value      DECIMAL(12,2) NOT NULL,
  area_basis      ENUM('bua','carpet','saleable','plot') NOT NULL,
  area_bua_sqft   DECIMAL(12,2) NOT NULL,
  price           DECIMAL(15,2) NOT NULL,
  rate_per_sqft   DECIMAL(12,2) NOT NULL,           -- on built-up area
  floor_no        INT NULL,
  total_floors    INT NULL,
  building_age    INT NULL,
  has_lift        TINYINT(1) NULL,
  bhk             VARCHAR(10) NULL,
  notes           VARCHAR(500) NULL,
  file_id         BIGINT UNSIGNED NULL,             -- captured page
  origin_assignment_id BIGINT UNSIGNED NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_comp_firm (firm_id, property_type, txn_date),
  KEY ix_comp_loc (village, locality)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
