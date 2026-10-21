import { db, json, toJson, type Tx } from '../db/index.js';

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
  billing_enabled: boolean;
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
  billing_enabled: false,
};

export async function getSettings(firmId: number, tx: Tx = db): Promise<FirmSettings> {
  const rows = await tx.selectFrom('firm_settings').select(['skey', 'value_json']).where('firm_id', '=', firmId).execute();
  const s: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.skey in s) s[r.skey] = json(r.value_json, null);
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
