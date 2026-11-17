-- Universal re-test of 13 Nov 2026.
-- A6: who sourced the case for the firm (a person or agency from a master list); kept for records and reports,
-- never printed in the bank report. "Application no." stays the bank's own number.
CREATE TABLE case_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  firm_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_case_source (firm_id, name),
  CONSTRAINT fk_case_source_firm FOREIGN KEY (firm_id) REFERENCES firms (id)
);
ALTER TABLE assignments
  ADD COLUMN sourced_by_id BIGINT UNSIGNED NULL AFTER purpose,
  ADD CONSTRAINT fk_asg_source FOREIGN KEY (sourced_by_id) REFERENCES case_sources (id);
