-- Area basis and rate unit chosen per case on the Valuation tab; map screenshots recognised among
-- the site photos (the pin's coordinates are read from the picture).
ALTER TABLE valuations
  ADD COLUMN rate_unit ENUM('sqft','sqm') NOT NULL DEFAULT 'sqft';

ALTER TABLE site_photos
  ADD COLUMN is_map TINYINT NOT NULL DEFAULT 0;
