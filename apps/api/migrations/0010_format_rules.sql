-- Rules a bank format brings with it (e.g. SBI Flat Under Construction: realizable 98%, plinth = carpet + 10%,
-- saleable = carpet × 1.35). They overlay the firm's rule set for the bank on cases that use the format.
ALTER TABLE report_templates ADD COLUMN rules_json JSON NULL AFTER branch_scope;
-- numbers in a format that stay as fixed text, confirmed by the admin before publishing (C1)
ALTER TABLE template_versions ADD COLUMN fixed_ok_json JSON NULL AFTER layout_json;
