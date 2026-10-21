import { db, toJson, type Tx } from '../db/index.js';

export interface FirmSettings {
  case_pattern: string;           // VM-{FYC}-{N}
  report_pattern: string;         // {FIRM}/{BANK}/{BRANCH}/{FY}/{N}
  file_pattern: string;           // {CASE}_{BORROWER}_{UNIT}_{BANK}-{BRANCH}
  letterhead_file_id: number | null;
  signature_file_id: number | null;
  seal_file_id: number | null;
  doc_grid: 9 | 4 | 1;
  photo_grid: 9;
  evidence_per_page: 2;
  retention_years: number;
  kyc_policy: 'never' | 'delete_30' | 'delete_90';
  engineer_link_hours: number;
  place: string;                  // "Thane" printed next to the signature
  // billing (the module itself is switched on with the "billing" feature flag)
  invoice_pattern: string;        // INV/{FY}/{N}
  proforma_pattern: string;       // PI/{FY}/{N}
  credit_note_pattern: string;    // CN/{FY}/{N}
  sac: string;                    // valuation services; confirm with the firm's CA
  gst_pct: number;
  tds_pct: number;                // deducted by banks on the taxable value (section 194J)
  due_days: number;               // invoices older than this are overdue
  upi_id: string;
  bank_account: { bank: string; name: string; number: string; ifsc: string; branch: string };
  invoice_note: string;           // printed under the totals
  engineer_fee: number;           // default fee per visit when the engineer has none
  tally_ledgers: { sales: string; cgst: string; sgst: string; igst: string; round_off: string; bank: string; tds: string };
}

export const DEFAULT_SETTINGS: FirmSettings = {
  case_pattern: 'VM-{FYC}-{N}',
  report_pattern: '{FIRM}/{BANK}/{BRANCH}/{FY}/{N}',
  file_pattern: '{CASE}_{BORROWER}_{UNIT}_{BANK}-{BRANCH}',
  letterhead_file_id: null,
  signature_file_id: null,
  seal_file_id: null,
  doc_grid: 9,
  photo_grid: 9,
  evidence_per_page: 2,
  retention_years: 3,
  kyc_policy: 'delete_30',
  engineer_link_hours: 72,
  place: '',
  invoice_pattern: 'INV/{FY}/{N}',
  proforma_pattern: 'PI/{FY}/{N}',
  credit_note_pattern: 'CN/{FY}/{N}',
  sac: '998399',
  gst_pct: 18,
  tds_pct: 10,
  due_days: 30,
  upi_id: '',
  bank_account: { bank: '', name: '', number: '', ifsc: '', branch: '' },
  invoice_note: '',
  engineer_fee: 800,
  tally_ledgers: { sales: 'Valuation Fees', cgst: 'Output CGST', sgst: 'Output SGST', igst: 'Output IGST', round_off: 'Round Off', bank: 'Bank Account', tds: 'TDS Receivable' },
};

function decoded(v: string): unknown {
  try {
    const p = JSON.parse(v);
    return p && typeof p === 'object' ? p : v;
  } catch {
    return v;
  }
}

export async function getSettings(firmId: number, tx: Tx = db): Promise<FirmSettings> {
  const rows = await tx.selectFrom('firm_settings').select(['skey', 'value_json']).where('firm_id', '=', firmId).execute();
  const s: any = { ...DEFAULT_SETTINGS };
  // mysql2 returns JSON columns decoded, so a text setting arrives as a plain string ("{FIRM}/{BANK}/..."
  // is text, not JSON); only a string that parses to an object is treated as encoded JSON
  for (const r of rows) if (r.skey in s) s[r.skey] = typeof r.value_json === 'string' ? decoded(r.value_json) : r.value_json;
  return s as FirmSettings;
}

export async function setSettings(firmId: number, patch: Partial<FirmSettings>, userId: number | null, tx: Tx = db) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    await tx
      .insertInto('firm_settings')
      .values({ firm_id: firmId, skey: k, value_json: toJson(v), updated_by: userId })
      .onDuplicateKeyUpdate({ value_json: toJson(v), updated_by: userId })
      .execute();
  }
}

export const FEATURE_FLAGS = {
  billing: 'Billing & payouts',
  quick_estimate: 'Quick Estimate',
  shared_pool: 'Shared anonymised comparables',
  ai_photo_captions: 'AI photo captions',
} as const;

export async function flagsFor(firmId: number, tx: Tx = db): Promise<Record<string, boolean>> {
  const rows = await tx.selectFrom('feature_flags').select(['flag', 'enabled']).where('firm_id', '=', firmId).execute();
  const out: Record<string, boolean> = { billing: false, quick_estimate: false, shared_pool: false, ai_photo_captions: true };
  for (const r of rows) out[r.flag] = !!r.enabled;
  return out;
}
