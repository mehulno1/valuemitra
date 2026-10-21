-- WP11 Billing: GST tax invoices and proformas (one per case or a batch per bank branch), payments
-- with TDS, credit notes and write-offs, engineer payouts.

-- A case can be billed to a different payer than its branch's default.
ALTER TABLE assignments ADD COLUMN bill_payer ENUM('bank','borrower') NULL AFTER fee;

-- Tax invoices and proformas. Issued invoices are never edited or deleted; a credit note reduces them.
CREATE TABLE invoices (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  kind            ENUM('tax','proforma') NOT NULL,
  invoice_no      VARCHAR(60) NOT NULL,              -- INV/26-27/0001, PI/26-27/0001
  fy              VARCHAR(5) NOT NULL,
  seq             INT UNSIGNED NOT NULL,
  invoice_date    DATE NOT NULL,
  bill_mode       ENUM('case','batch') NOT NULL,
  payer           ENUM('bank','borrower') NOT NULL,
  bank_id         BIGINT UNSIGNED NULL,
  branch_id       BIGINT UNSIGNED NULL,
  bill_to_name    VARCHAR(250) NOT NULL,
  bill_to_address VARCHAR(500) NULL,
  bill_to_gstin   VARCHAR(15) NULL,                  -- NULL = unregistered (B2C)
  bill_to_email   VARCHAR(190) NULL,
  bill_to_phone   VARCHAR(30) NULL,
  pos_code        CHAR(2) NOT NULL,                  -- place of supply, GST state code
  sac             VARCHAR(10) NOT NULL,
  gst_rate        DECIMAL(5,2) NOT NULL,
  taxable         DECIMAL(14,2) NOT NULL,
  cgst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  sgst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  igst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  round_off       DECIMAL(8,2) NOT NULL DEFAULT 0,
  total           DECIMAL(14,2) NOT NULL,
  period_label    VARCHAR(60) NULL,                  -- batch bills: "Oct 2026"
  seller_json     JSON NOT NULL,                     -- firm name, address, GSTIN, PAN, bank account, UPI on the invoice date
  notes           VARCHAR(1000) NULL,
  proforma_id     BIGINT UNSIGNED NULL,              -- tax invoice: the proforma it was converted from
  converted_invoice_id BIGINT UNSIGNED NULL,         -- proforma: the tax invoice it became
  cancelled_at    DATETIME(3) NULL,                  -- proformas only (not a tax document)
  sent_at         DATETIME(3) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_inv_no (firm_id, kind, invoice_no),
  KEY ix_inv_firm (firm_id, kind, invoice_date),
  CONSTRAINT fk_inv_firm FOREIGN KEY (firm_id) REFERENCES firms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE invoice_lines (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id      BIGINT UNSIGNED NOT NULL,
  line_no         INT UNSIGNED NOT NULL,
  assignment_id   BIGINT UNSIGNED NULL,
  ref_text        VARCHAR(120) NOT NULL,             -- report no. or "Advance"
  description     VARCHAR(500) NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  released_at     DATETIME(3) NULL,                  -- a credit note released the case to be billed again
  KEY ix_il_inv (invoice_id),
  KEY ix_il_asg (assignment_id),
  CONSTRAINT fk_il_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Money received against an invoice; TDS deducted by the payer counts towards the balance.
CREATE TABLE payments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  invoice_id      BIGINT UNSIGNED NOT NULL,
  received_on     DATE NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  tds             DECIMAL(14,2) NOT NULL DEFAULT 0,
  pay_mode        VARCHAR(20) NOT NULL,              -- NEFT, RTGS, IMPS, UPI, Cheque, Cash
  ref_no          VARCHAR(100) NULL,                 -- UTR / cheque no.
  note            VARCHAR(500) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_pay_inv (invoice_id),
  KEY ix_pay_firm (firm_id, received_on),
  CONSTRAINT fk_pay_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Credit notes (numbered, GST reversed) and write-offs (no number, no GST effect) close a balance.
CREATE TABLE credit_notes (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  invoice_id      BIGINT UNSIGNED NOT NULL,
  kind            ENUM('credit_note','write_off') NOT NULL,
  note_no         VARCHAR(60) NULL,
  fy              VARCHAR(5) NULL,
  seq             INT UNSIGNED NULL,
  note_date       DATE NOT NULL,
  taxable         DECIMAL(14,2) NOT NULL DEFAULT 0,
  cgst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  sgst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  igst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  total           DECIMAL(14,2) NOT NULL,
  reason          VARCHAR(1000) NOT NULL,
  released_cases  TINYINT(1) NOT NULL DEFAULT 0,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cn_no (firm_id, note_no),
  KEY ix_cn_inv (invoice_id),
  CONSTRAINT fk_cn_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Field engineer payouts: visits in a month × fee per visit, marked paid.
CREATE TABLE engineer_payouts (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firm_id         BIGINT UNSIGNED NOT NULL,
  engineer_id     BIGINT UNSIGNED NOT NULL,
  period_month    CHAR(7) NOT NULL,                  -- 2026-10
  visits          INT UNSIGNED NOT NULL,
  fee_per_visit   DECIMAL(10,2) NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  paid_on         DATE NOT NULL,
  ref_no          VARCHAR(100) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payout (firm_id, engineer_id, period_month),
  CONSTRAINT fk_po_eng FOREIGN KEY (engineer_id) REFERENCES engineers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
