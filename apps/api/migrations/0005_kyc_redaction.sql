-- Bundles containing KYC pages are stored redacted; the original upload is kept only until the
-- firm's KYC deletion date (or deleted at once under "never stored").
ALTER TABLE documents ADD COLUMN original_file_id BIGINT UNSIGNED NULL AFTER file_id;
