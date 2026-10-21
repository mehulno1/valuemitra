-- Market evidence: ready reckoner and location map screenshots are captured alongside IGR and
-- listing pages. They print on their own report pages and are not read into comparables.
ALTER TABLE evidence_captures
  MODIFY source_kind ENUM('igr','listing','other','rr','map') NOT NULL;
