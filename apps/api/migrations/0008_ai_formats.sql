-- AI conversion of bank formats: the model maps each question by meaning, proposes new fields,
-- rewrites or clears paragraphs (earlier case text, earlier valuer identity, annexure pages).
ALTER TABLE template_versions
  ADD COLUMN ai_status VARCHAR(12) NOT NULL DEFAULT 'none',   -- none, reading, done, failed
  ADD COLUMN ai_json   JSON NULL,                             -- summary, proposed new fields, sections
  ADD COLUMN ai_error  VARCHAR(500) NULL;

ALTER TABLE template_mappings
  MODIFY COLUMN method ENUM('auto','history','manual','new_field','placeholder','ai') NULL,
  ADD COLUMN status     VARCHAR(12) NULL,                     -- match, new, needs, clear, fixed
  ADD COLUMN section    VARCHAR(200) NULL,                    -- section of the bank's form, for the review
  ADD COLUMN ai_note    VARCHAR(500) NULL,
  ADD COLUMN ask_json   JSON NULL,                            -- {question, options: [{label, template}]}
  ADD COLUMN answer     VARCHAR(500) NULL,
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

-- a field one bank asks for (e.g. NKGSB.CROPS); NULL = shared by every bank
ALTER TABLE canonical_fields ADD COLUMN origin_bank VARCHAR(20) NULL;
