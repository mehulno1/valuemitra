-- WP3/WP4 Assignments, documents, extraction.

CREATE TABLE assignments (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id             BIGINT UNSIGNED NOT NULL,
  case_no             VARCHAR(30) NOT NULL,          -- VM-2526-0143
  fy                  VARCHAR(5) NOT NULL,
  case_seq            INT UNSIGNED NOT NULL,
  bank_id             BIGINT UNSIGNED NOT NULL,
  branch_id           BIGINT UNSIGNED NOT NULL,
  bank_contact        VARCHAR(150) NULL,
  received_via        VARCHAR(30) NULL,
  bank_ref_no         VARCHAR(100) NULL,
  borrower_name       VARCHAR(200) NULL,
  property_type       VARCHAR(20) NOT NULL,
  locality_hint       VARCHAR(300) NULL,
  purpose             VARCHAR(100) NOT NULL DEFAULT 'Home loan',
  engineer_id         BIGINT UNSIGNED NULL,
  valuer_id           BIGINT UNSIGNED NULL,
  stage               VARCHAR(20) NOT NULL DEFAULT 'new',
  stage_changed_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- pinned configuration (immutable references)
  template_version_id BIGINT UNSIGNED NULL,
  profile_version_id  BIGINT UNSIGNED NULL,
  rule_version_id     BIGINT UNSIGNED NULL,
  check_version_id    BIGINT UNSIGNED NULL,
  wording_version_id  BIGINT UNSIGNED NULL,
  -- report numbering (issued at sign-off)
  report_fy           VARCHAR(5) NULL,
  report_seq          INT UNSIGNED NULL,
  report_rev          INT UNSIGNED NOT NULL DEFAULT 0,
  report_no           VARCHAR(80) NULL,
  signed_at           DATETIME(3) NULL,
  signed_by           BIGINT UNSIGNED NULL,
  sent_at             DATETIME(3) NULL,
  sent_for_review_at  DATETIME(3) NULL,
  draft_version       INT UNSIGNED NOT NULL DEFAULT 0,
  fee                 DECIMAL(12,2) NULL,
  personal_data_removed_at DATETIME(3) NULL,
  created_by          BIGINT UNSIGNED NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_case_no (firm_id, case_no),
  KEY ix_asg_stage (firm_id, stage, updated_at),
  CONSTRAINT fk_asg_firm FOREIGN KEY (firm_id) REFERENCES firms(id),
  CONSTRAINT fk_asg_bank FOREIGN KEY (bank_id) REFERENCES banks(id),
  CONSTRAINT fk_asg_branch FOREIGN KEY (branch_id) REFERENCES bank_branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stage_history (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id BIGINT UNSIGNED NOT NULL,
  from_stage    VARCHAR(20) NULL,
  to_stage      VARCHAR(20) NOT NULL,
  actor_id      BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_sh_asg (assignment_id, created_at),
  CONSTRAINT fk_sh_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One uploaded file (a PDF bundle, a photo of a document, a site sheet).
CREATE TABLE documents (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id        BIGINT UNSIGNED NOT NULL,
  assignment_id  BIGINT UNSIGNED NOT NULL,
  file_id        BIGINT UNSIGNED NOT NULL,
  batch_no       INT UNSIGNED NOT NULL,
  channel        VARCHAR(30) NULL,                  -- WhatsApp, Email, Upload, Engineer link
  received_from  VARCHAR(150) NULL,
  received_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  page_count     INT UNSIGNED NOT NULL DEFAULT 0,
  is_scanned     TINYINT(1) NULL,
  role           ENUM('bank_docs','site_sheet','evidence','other') NOT NULL DEFAULT 'bank_docs',
  status         ENUM('uploaded','reading','read','failed') NOT NULL DEFAULT 'uploaded',
  error          VARCHAR(1000) NULL,
  uploaded_by    BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_doc_asg (assignment_id),
  CONSTRAINT fk_doc_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id),
  CONSTRAINT fk_doc_file FOREIGN KEY (file_id) REFERENCES files(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE document_pages (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id     BIGINT UNSIGNED NOT NULL,
  page_no         INT UNSIGNED NOT NULL,
  image_file_id   BIGINT UNSIGNED NULL,
  thumb_file_id   BIGINT UNSIGNED NULL,
  ocr_text        MEDIUMTEXT NULL,
  ocr_languages   VARCHAR(60) NULL,
  ocr_confidence  DECIMAL(5,2) NULL,
  ocr_json        JSON NULL,                        -- word boxes, for crops
  width_px        INT NULL,
  height_px       INT NULL,
  UNIQUE KEY uq_page (document_id, page_no),
  CONSTRAINT fk_pg_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A logical document found inside an upload (Index II pp. 1-2, Agreement pp. 6-18 ...).
CREATE TABLE document_parts (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  document_id     BIGINT UNSIGNED NOT NULL,
  detected_type   VARCHAR(40) NOT NULL,
  corrected_type  VARCHAR(40) NULL,
  corrected_by    BIGINT UNSIGNED NULL,
  corrected_at    DATETIME(3) NULL,
  title           VARCHAR(200) NULL,                -- "Index II (current registration)"
  page_from       INT UNSIGNED NOT NULL,
  page_to         INT UNSIGNED NOT NULL,
  pages_json      JSON NOT NULL,                    -- non-contiguous pages, e.g. KYC 20,21,23,24
  languages       VARCHAR(60) NULL,
  confidence      DECIMAL(5,2) NULL,
  is_kyc          TINYINT(1) NOT NULL DEFAULT 0,
  excluded        TINYINT(1) NOT NULL DEFAULT 0,
  moved_to        VARCHAR(30) NULL,                 -- site_photos
  part_file_id    BIGINT UNSIGNED NULL,             -- split PDF of this part
  key_facts_json  JSON NULL,                        -- survey no., building, society, reg no. (for "seen before")
  in_report_pages JSON NULL,                        -- page numbers to place in the report's documents annexure
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_part_asg (assignment_id),
  CONSTRAINT fk_part_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE checklist_items (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  item_code       VARCHAR(40) NOT NULL,
  label           VARCHAR(200) NOT NULL,
  remark_label    VARCHAR(200) NULL,                -- wording used in Remark 1
  doc_types       JSON NULL,                        -- document types that satisfy it
  required        TINYINT(1) NOT NULL DEFAULT 0,
  state           ENUM('y','n','na') NOT NULL DEFAULT 'n',
  auto_state      ENUM('y','n','na') NOT NULL DEFAULT 'n',
  overridden      TINYINT(1) NOT NULL DEFAULT 0,
  is_manual       TINYINT(1) NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  updated_by      BIGINT UNSIGNED NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cl (assignment_id, item_code),
  CONSTRAINT fk_cl_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every value for every canonical field, with provenance. History is kept; one row is current per
-- (assignment, field, candidate source); the resolved value is chosen by source priority or by a person.
CREATE TABLE field_values (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  field_code      VARCHAR(80) NOT NULL,
  value_text      TEXT NULL,
  value_num       DECIMAL(18,4) NULL,
  value_json      JSON NULL,
  source_type     VARCHAR(20) NOT NULL,             -- document, site_sheet, derived, manual, report_edit, valuation, case, evidence
  source_doc_type VARCHAR(40) NULL,
  part_id         BIGINT UNSIGNED NULL,
  document_id     BIGINT UNSIGNED NULL,
  page_no         INT UNSIGNED NULL,
  snippet         TEXT NULL,
  snippet_lang    VARCHAR(20) NULL,
  crop_file_id    BIGINT UNSIGNED NULL,
  confidence      DECIMAL(5,2) NULL,
  status          ENUM('proposed','accepted','edited','rejected','superseded') NOT NULL DEFAULT 'proposed',
  is_current      TINYINT(1) NOT NULL DEFAULT 1,
  is_chosen       TINYINT(1) NOT NULL DEFAULT 0,    -- a person picked this candidate in a conflict
  reason          VARCHAR(1000) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  confirmed_by    BIGINT UNSIGNED NULL,
  confirmed_at    DATETIME(3) NULL,
  KEY ix_fv_current (assignment_id, field_code, is_current),
  CONSTRAINT fk_fv_asg FOREIGN KEY (assignment_id) REFERENCES assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Learning system feedback store: every accept/edit/reject, label correction, rate override,
-- check override and mapping confirmation, as labelled data.
CREATE TABLE feedback_events (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id        BIGINT UNSIGNED NULL,             -- NULL = platform onboarding
  assignment_id  BIGINT UNSIGNED NULL,
  kind           VARCHAR(40) NOT NULL,              -- extraction.accept|edit|reject, doc_label.correct, rate.override, check.override, mapping.confirm, report.signed
  field_code     VARCHAR(80) NULL,
  doc_type       VARCHAR(40) NULL,
  property_type  VARCHAR(20) NULL,
  locality       VARCHAR(200) NULL,
  before_json    JSON NULL,
  after_json     JSON NULL,
  context_json   JSON NULL,                         -- source snippet, page, confidence, model version
  user_id        BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_fb_kind (firm_id, kind, created_at),
  KEY ix_fb_field (field_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
