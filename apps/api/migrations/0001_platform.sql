-- WP1 Platform foundation: firms, users, roles, sessions, audit, events, files, jobs, flags, sequences.

CREATE TABLE firms (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(12)  NOT NULL,            -- used in report numbers, e.g. DVA
  name          VARCHAR(200) NOT NULL,
  legal_name    VARCHAR(200) NULL,
  address       VARCHAR(500) NULL,
  city          VARCHAR(100) NULL,
  state_code    CHAR(2)      NULL,                -- GST state code, e.g. 27 (Maharashtra)
  state_name    VARCHAR(60)  NULL,
  gstin         VARCHAR(15)  NULL,
  pan           VARCHAR(10)  NULL,
  phone         VARCHAR(30)  NULL,
  email         VARCHAR(190) NULL,
  status        ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
  shared_pool_consent TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_firm_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Key/value settings per firm: letterhead/signature/seal file ids, numbering patterns, report layout, retention.
CREATE TABLE firm_settings (
  firm_id     BIGINT UNSIGNED NOT NULL,
  skey        VARCHAR(80) NOT NULL,
  value_json  JSON NOT NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (firm_id, skey),
  CONSTRAINT fk_fs_firm FOREIGN KEY (firm_id) REFERENCES firms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(190) NOT NULL,
  phone           VARCHAR(30)  NULL,
  password_hash   VARCHAR(100) NOT NULL,
  role            ENUM('coordinator','valuer','accounts','admin') NOT NULL,
  qualifications  VARCHAR(200) NULL,                -- valuers: "B.E. (Civil), F.I.V."
  ibbi_reg_no     VARCHAR(60)  NULL,
  ibbi_valid_upto DATE NULL,
  totp_secret_enc VARBINARY(255) NULL,
  totp_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  status          ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at   DATETIME(3) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_email (email),
  KEY ix_user_firm (firm_id),
  CONSTRAINT fk_user_firm FOREIGN KEY (firm_id) REFERENCES firms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_permissions (
  user_id    BIGINT UNSIGNED NOT NULL,
  perm       VARCHAR(20) NOT NULL,
  granted_by BIGINT UNSIGNED NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, perm),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE refresh_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  family      CHAR(26) NOT NULL,                   -- rotation family; reuse revokes the family
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  revoked_at  DATETIME(3) NULL,
  user_agent  VARCHAR(255) NULL,
  ip          VARCHAR(45) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rt_hash (token_hash),
  KEY ix_rt_user (user_id),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Immutable audit trail. The app never updates or deletes rows; infrastructure/mysql/audit_triggers.sql
-- (applied as MySQL root) adds triggers that forbid UPDATE and DELETE at the database level.
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NULL,
  assignment_id BIGINT UNSIGNED NULL,
  entity_type   VARCHAR(40) NOT NULL,
  entity_id     VARCHAR(40) NULL,
  action        VARCHAR(60) NOT NULL,
  summary       VARCHAR(1000) NOT NULL,
  actor_type    ENUM('user','system','engineer','admin') NOT NULL,
  actor_id      BIGINT UNSIGNED NULL,
  actor_name    VARCHAR(150) NULL,
  reason        VARCHAR(1000) NULL,
  before_json   JSON NULL,
  after_json    JSON NULL,
  ip            VARCHAR(45) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_firm (firm_id, created_at),
  KEY ix_audit_assignment (assignment_id, created_at),
  KEY ix_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Domain events (outbox). Published in-process and kept for new listeners / replay.
CREATE TABLE events (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NULL,
  type          VARCHAR(60) NOT NULL,                -- document.received, value.applied, report.signed ...
  entity_type   VARCHAR(40) NULL,
  entity_id     VARCHAR(40) NULL,
  payload_json  JSON NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ev_type (type, created_at),
  KEY ix_ev_firm (firm_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every stored binary (uploads, page images, crops, generated reports). Storage key is firm-scoped.
CREATE TABLE files (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NULL,               -- NULL only for platform assets
  storage_key   VARCHAR(400) NOT NULL,
  original_name VARCHAR(255) NULL,
  mime          VARCHAR(120) NOT NULL,
  size_bytes    BIGINT UNSIGNED NOT NULL,
  sha256        CHAR(64) NOT NULL,
  purpose       VARCHAR(40) NOT NULL,               -- upload, page_image, crop, photo, report_docx, report_pdf, template, branding
  is_kyc        TINYINT(1) NOT NULL DEFAULT 0,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  purge_after   DATETIME(3) NULL,                   -- retention / KYC auto-delete
  purged_at     DATETIME(3) NULL,
  UNIQUE KEY uq_file_key (storage_key),
  KEY ix_file_firm (firm_id),
  KEY ix_file_sha (firm_id, sha256),
  KEY ix_file_purge (purge_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- MySQL-backed job queue (OCR, extraction, rendering, retention) with retry and back-off.
CREATE TABLE jobs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id       BIGINT UNSIGNED NULL,
  type          VARCHAR(60) NOT NULL,
  payload_json  JSON NOT NULL,
  status        ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 4,
  run_after     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at     DATETIME(3) NULL,
  locked_by     VARCHAR(60) NULL,
  last_error    TEXT NULL,
  result_json   JSON NULL,
  dedupe_key    VARCHAR(120) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   DATETIME(3) NULL,
  KEY ix_job_pick (status, run_after),
  KEY ix_job_dedupe (dedupe_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feature_flags (
  firm_id    BIGINT UNSIGNED NOT NULL,
  flag       VARCHAR(60) NOT NULL,
  enabled    TINYINT(1) NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (firm_id, flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Gap-free counters per firm, series and financial year (case, report, qe, invoice, proforma, credit_note).
CREATE TABLE sequences (
  firm_id    BIGINT UNSIGNED NOT NULL,
  series     VARCHAR(30) NOT NULL,
  fy         VARCHAR(5)  NOT NULL,                  -- '25-26'
  last_no    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (firm_id, series, fy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- In-product feedback ("comments on any screen or field") feeding the change loop.
CREATE TABLE product_feedback (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  screen      VARCHAR(120) NOT NULL,
  target      VARCHAR(200) NULL,
  kind        ENUM('bug','wording','idea') NOT NULL DEFAULT 'idea',
  body        TEXT NOT NULL,
  status      ENUM('new','triaged_config','triaged_code','done','wontfix') NOT NULL DEFAULT 'new',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_pf_firm (firm_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
