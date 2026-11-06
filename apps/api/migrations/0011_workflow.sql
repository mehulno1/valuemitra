-- Report Maker / Report Checker workflow (Universal review A1, B5): coordinator → maker → checker → valuer,
-- with send-backs. `holder` is who has the case now; the stage still follows the facts of the case.
ALTER TABLE users MODIFY role ENUM('coordinator','valuer','accounts','admin','maker','checker') NOT NULL;
ALTER TABLE assignments
  ADD COLUMN maker_id BIGINT UNSIGNED NULL AFTER engineer_id,
  ADD COLUMN checker_id BIGINT UNSIGNED NULL AFTER maker_id,
  ADD COLUMN holder ENUM('coordinator','maker','checker','valuer') NOT NULL DEFAULT 'coordinator' AFTER checker_id,
  ADD COLUMN handed_at DATETIME(3) NULL AFTER holder,
  ADD CONSTRAINT fk_asg_maker FOREIGN KEY (maker_id) REFERENCES users(id),
  ADD CONSTRAINT fk_asg_checker FOREIGN KEY (checker_id) REFERENCES users(id),
  ADD INDEX ix_asg_holder (firm_id, holder);
-- cases already sent to the valuer stay with the valuer
UPDATE assignments SET holder = 'valuer', handed_at = sent_for_review_at WHERE sent_for_review_at IS NOT NULL OR signed_at IS NOT NULL;
-- new permissions for existing users, as the new defaults give them
INSERT IGNORE INTO user_permissions (user_id, perm) SELECT id, 'assign' FROM users WHERE role IN ('coordinator', 'valuer');
INSERT IGNORE INTO user_permissions (user_id, perm) SELECT id, 'case_rules' FROM users WHERE role = 'valuer';
