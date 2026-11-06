-- Per-case changes to the bank defaults (Universal review A6, A8, A7): loading and saleable factors,
-- realizable / distress %, insurance rate. They overlay the format's and the firm's rules for this case only.
ALTER TABLE assignments ADD COLUMN rules_json JSON NULL AFTER holder;
-- What a captured page really shows (B6): a map uploaded as a ready reckoner page is flagged, with a move offered.
-- PropTrace Index II search results are read like IGR searches.
ALTER TABLE evidence_captures
  MODIFY source_kind ENUM('igr','listing','other','rr','map','proptrace') NOT NULL,
  ADD COLUMN suggested_kind VARCHAR(20) NULL AFTER source_kind,
  ADD COLUMN check_note VARCHAR(500) NULL AFTER suggested_kind;
