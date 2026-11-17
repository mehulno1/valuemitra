-- Retest of 13 Nov, H2: a format's rules (realizable / distress %, area factors, rounding) belong to a version,
-- like its layout. A change on a published format becomes the next version, effective from a chosen date; cases
-- pinned to an earlier version keep its rules. report_templates.rules_json stays as the latest published copy.
ALTER TABLE template_versions ADD COLUMN rules_json JSON NULL AFTER layout_json;
UPDATE template_versions v JOIN report_templates t ON t.id = v.template_id SET v.rules_json = t.rules_json WHERE t.rules_json IS NOT NULL;
