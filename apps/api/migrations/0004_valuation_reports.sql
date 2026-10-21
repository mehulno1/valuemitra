-- WP5-WP8 Site visit, evidence, valuation, checks, templates, reports, dispatch.

CREATE TABLE site_visits (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  engineer_id     BIGINT UNSIGNED NULL,
  token_hash      CHAR(64) NOT NULL,
  expires_at      DATETIME(3) NOT NULL,
  revoked_at      DATETIME(3) NULL,
  status          ENUM('assigned','in_progress','submitted') NOT NULL DEFAULT 'assigned',
  visit_date      DATE NULL,
  pin_lat         DECIMAL(10,7) NULL,
  pin_lng         DECIMAL(10,7) NULL,
  submitted_at    DATETIME(3) NULL,
  engineer_note   VARCHAR(1000) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sv_token (token_hash),
  KEY ix_sv_asg (assignment_id),
  CONSTRAINT fk_sv_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE site_photos (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  site_visit_id   BIGINT UNSIGNED NULL,
  file_id         BIGINT UNSIGNED NOT NULL,
  thumb_file_id   BIGINT UNSIGNED NULL,
  source          ENUM('engineer','upload','document') NOT NULL DEFAULT 'engineer',
  taken_at        DATETIME(3) NULL,
  lat             DECIMAL(10,7) NULL,
  lng             DECIMAL(10,7) NULL,
  dhash           CHAR(16) NULL,
  duplicate_of    BIGINT UNSIGNED NULL,
  is_selfie       TINYINT(1) NOT NULL DEFAULT 0,
  names_visible   TINYINT(1) NOT NULL DEFAULT 0,
  distance_m      INT NULL,
  flags_json      JSON NULL,
  ai_caption      VARCHAR(200) NULL,
  caption         VARCHAR(200) NULL,
  room_tag        VARCHAR(40) NULL,
  selected        TINYINT(1) NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ph_asg (assignment_id),
  CONSTRAINT fk_ph_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Captured IGR / listing pages (assisted capture).
CREATE TABLE evidence_captures (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  file_id         BIGINT UNSIGNED NOT NULL,
  source_kind     ENUM('igr','listing','other') NOT NULL,
  source_name     VARCHAR(100) NULL,                -- 99acres, MagicBricks, IGR Maharashtra
  url             VARCHAR(1000) NULL,
  status          ENUM('uploaded','reading','read','failed') NOT NULL DEFAULT 'uploaded',
  error           VARCHAR(1000) NULL,
  in_report       TINYINT(1) NOT NULL DEFAULT 1,
  captured_by     BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ec_asg (assignment_id),
  CONSTRAINT fk_ec_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A comparable as used in one case: adjustments, weight and whether it is in the set.
CREATE TABLE case_comparables (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  comparable_id   BIGINT UNSIGNED NOT NULL,
  capture_id      BIGINT UNSIGNED NULL,
  is_subject      TINYINT(1) NOT NULL DEFAULT 0,    -- the property's own registration
  distance_km     DECIMAL(6,2) NULL,
  age_months      DECIMAL(6,1) NULL,
  adjustments     JSON NOT NULL,                    -- [{"code":"listing","label":"Listing","pct":-5}]
  adjusted_rate   DECIMAL(12,2) NOT NULL,
  weight          DECIMAL(6,3) NOT NULL,
  weight_label    VARCHAR(10) NOT NULL,             -- High / Medium / Low
  included        TINYINT(1) NOT NULL DEFAULT 1,
  exclusion_reason VARCHAR(300) NULL,
  note            VARCHAR(500) NULL,
  manual_override TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cc (assignment_id, comparable_id),
  CONSTRAINT fk_cc_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id),
  CONSTRAINT fk_cc_comp FOREIGN KEY (comparable_id) REFERENCES comparables(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Each applied valuation is a new row (value history); the latest is current.
CREATE TABLE valuations (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  method          VARCHAR(30) NOT NULL,             -- market_comparison, cost, land_building
  basis           VARCHAR(20) NOT NULL,             -- bua, carpet, saleable, plot
  basis_area      DECIMAL(12,2) NOT NULL,
  proposed_rate   DECIMAL(12,2) NULL,
  proposed_lo     DECIMAL(12,2) NULL,
  proposed_hi     DECIMAL(12,2) NULL,
  proposal_json   JSON NULL,                        -- the working shown
  adopted_rate    DECIMAL(12,2) NOT NULL,
  reason          VARCHAR(2000) NULL,
  extras_json     JSON NOT NULL,                    -- [{"code":"parking","label":"Car parking","qty":1,"rate":300000}]
  values_json     JSON NOT NULL,                    -- {"fmv":..,"realizable":..,"distress":..,...}
  rule_version_id BIGINT UNSIGNED NOT NULL,
  draft_version   INT UNSIGNED NOT NULL,
  is_current      TINYINT(1) NOT NULL DEFAULT 1,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_val_asg (assignment_id, is_current),
  CONSTRAINT fk_val_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Result of the configurable check engine; acceptances with reason persist by fingerprint.
CREATE TABLE check_results (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  check_code      VARCHAR(60) NOT NULL,
  fingerprint     CHAR(40) NOT NULL,                -- hash of the facts the check fired on
  severity        ENUM('crit','warn','ok','info') NOT NULL,
  title           VARCHAR(300) NOT NULL,
  detail          VARCHAR(2000) NULL,
  target_tab      VARCHAR(20) NULL,
  actions_json    JSON NULL,                        -- quick resolutions offered, e.g. pick a conflict candidate
  status          ENUM('open','accepted','passed','info') NOT NULL,
  accepted_reason VARCHAR(1000) NULL,
  accepted_by     BIGINT UNSIGNED NULL,
  accepted_at     DATETIME(3) NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_check (assignment_id, check_code),
  CONSTRAINT fk_chk_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Bank templates and their immutable versions.
CREATE TABLE report_templates (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NULL,             -- NULL = platform template (e.g. ValueMitra standard)
  bank_id         BIGINT UNSIGNED NULL,
  code            VARCHAR(60) NOT NULL,
  name            VARCHAR(200) NOT NULL,            -- Annexure XI Format-A (Home Loan Centre)
  property_types  JSON NOT NULL,
  branch_scope    JSON NOT NULL,                    -- ["*"] or branch codes
  status          ENUM('active','retired') NOT NULL DEFAULT 'active',
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  firm_key        BIGINT UNSIGNED AS (IFNULL(firm_id, 0)) STORED,
  UNIQUE KEY uq_tpl_code (firm_key, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE template_versions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_id     BIGINT UNSIGNED NOT NULL,
  version         INT UNSIGNED NOT NULL,
  status          ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  effective_from  DATE NULL,
  source_file_id  BIGINT UNSIGNED NOT NULL,          -- the bank's Word file as uploaded
  compiled_file_id BIGINT UNSIGNED NULL,             -- same file with tags written into mapped slots
  detect_json     JSON NULL,                         -- detected slots and blocks
  layout_json     JSON NULL,                         -- annexure options (photos/docs per page, order)
  change_note     VARCHAR(500) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_by    BIGINT UNSIGNED NULL,
  published_at    DATETIME(3) NULL,
  UNIQUE KEY uq_tv (template_id, version),
  CONSTRAINT fk_tv_tpl FOREIGN KEY (template_id) REFERENCES report_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE template_mappings (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_version_id BIGINT UNSIGNED NOT NULL,
  slot_key            VARCHAR(60) NOT NULL,          -- stable within a version: t3r5c2, p41u1
  slot_kind           VARCHAR(20) NOT NULL,          -- cell, inline, placeholder, image
  label_text          VARCHAR(500) NOT NULL,
  context_text        VARCHAR(500) NULL,             -- section heading / neighbours
  sample_text         VARCHAR(500) NULL,
  location_json       JSON NOT NULL,
  field_code          VARCHAR(80) NULL,              -- NULL = not mapped yet / ignored
  ignored             TINYINT(1) NOT NULL DEFAULT 0,
  confidence          DECIMAL(5,2) NULL,
  method              ENUM('auto','history','manual','new_field','placeholder') NULL,
  confirmed_by        BIGINT UNSIGNED NULL,
  confirmed_at        DATETIME(3) NULL,
  UNIQUE KEY uq_tm (template_version_id, slot_key),
  CONSTRAINT fk_tm_tv FOREIGN KEY (template_version_id) REFERENCES template_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every rendered report (drafts and finals). Finals are locked.
CREATE TABLE report_versions (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id       BIGINT UNSIGNED NOT NULL,
  draft_version       INT UNSIGNED NOT NULL,
  kind                ENUM('preview','draft','final') NOT NULL,
  template_version_id BIGINT UNSIGNED NOT NULL,
  report_no           VARCHAR(80) NULL,
  data_json           JSON NOT NULL,                 -- exact data snapshot used to render
  docx_file_id        BIGINT UNSIGNED NULL,
  pdf_file_id         BIGINT UNSIGNED NULL,
  status              ENUM('queued','rendering','ready','failed') NOT NULL DEFAULT 'queued',
  error               VARCHAR(1000) NULL,
  created_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_rv_asg (assignment_id, created_at),
  CONSTRAINT fk_rv_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Report register: continuous, no gaps per firm and FY; revisions keep the serial and add /R1.
CREATE TABLE report_register (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  fy              VARCHAR(5) NOT NULL,
  seq             INT UNSIGNED NOT NULL,
  rev             INT UNSIGNED NOT NULL DEFAULT 0,
  report_no       VARCHAR(80) NOT NULL,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  report_version_id BIGINT UNSIGNED NULL,
  bank_code       VARCHAR(12) NOT NULL,
  branch_code     VARCHAR(20) NOT NULL,
  fmv             DECIMAL(15,2) NULL,
  signed_by       BIGINT UNSIGNED NOT NULL,
  signed_at       DATETIME(3) NOT NULL,
  superseded_at   DATETIME(3) NULL,
  UNIQUE KEY uq_reg (firm_id, fy, seq, rev),
  UNIQUE KEY uq_reg_no (firm_id, report_no),
  CONSTRAINT fk_reg_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE dispatches (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  report_no       VARCHAR(80) NOT NULL,
  email_sent      TINYINT(1) NOT NULL DEFAULT 0,
  email_sent_at   DATETIME(3) NULL,
  email_to        VARCHAR(500) NULL,
  whatsapp_sent   TINYINT(1) NOT NULL DEFAULT 0,
  printed         TINYINT(1) NOT NULL DEFAULT 0,
  couriered       TINYINT(1) NOT NULL DEFAULT 0,
  awb             VARCHAR(100) NULL,
  courier_name    VARCHAR(100) NULL,
  marked_sent_at  DATETIME(3) NULL,
  marked_sent_by  BIGINT UNSIGNED NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_disp (assignment_id, report_no),
  CONSTRAINT fk_disp_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE messages (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  assignment_id   BIGINT UNSIGNED NULL,
  channel         ENUM('email','whatsapp','sms') NOT NULL,
  purpose         VARCHAR(40) NOT NULL,             -- doc_reminder, engineer_link, draft_share, report_email
  to_text         VARCHAR(500) NULL,
  subject         VARCHAR(500) NULL,
  body            TEXT NOT NULL,
  status          ENUM('draft','copied','sent','failed') NOT NULL DEFAULT 'draft',
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_msg_asg (assignment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
