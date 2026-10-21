// Retention: KYC pages are deleted per the firm's policy (never stored / 30 / 90 days after
// dispatch); case files are kept for the firm's retention period (Model Code: at least 3 years).
import cron from 'node-cron';
import { env } from '../config/env.js';
import { db, type Tx } from '../db/index.js';
import { audit, systemActor } from './audit.js';
import { getSettings } from './settings.js';
import { purgeFile } from './storage.js';

/** KYC page images of a case get a purge date when the report is dispatched. */
export async function scheduleKycPurge(firmId: number, assignmentId: number, tx: Tx = db) {
  const s = await getSettings(firmId, tx);
  const days = s.kyc_policy === 'never' ? 0 : s.kyc_policy === 'delete_90' ? 90 : 30;
  const ids = await kycFileIds(assignmentId, tx);
  if (!ids.length) return;
  await tx.updateTable('files').set({ purge_after: new Date(Date.now() + days * 86400_000) }).where('id', 'in', ids).where('purged_at', 'is', null).execute();
}

export async function kycFileIds(assignmentId: number, tx: Tx = db) {
  const rows = await tx
    .selectFrom('document_pages as p')
    .innerJoin('documents as d', 'd.id', 'p.document_id')
    .innerJoin('files as f', (j) => j.on((eb) => eb.or([eb('f.id', '=', eb.ref('p.image_file_id')), eb('f.id', '=', eb.ref('p.thumb_file_id'))])))
    .select('f.id')
    .where('d.assignment_id', '=', assignmentId)
    .where('f.is_kyc', '=', 1)
    .execute();
  return rows.map((r) => r.id);
}

/** Daily: delete files whose purge date has passed. */
export async function runRetention() {
  const due = await db.selectFrom('files').select(['id', 'firm_id', 'purpose']).where('purge_after', '<=', new Date()).where('purged_at', 'is', null).limit(5000).execute();
  const byFirm = new Map<number, number>();
  for (const f of due) {
    await purgeFile(f.id);
    if (f.firm_id) byFirm.set(f.firm_id, (byFirm.get(f.firm_id) ?? 0) + 1);
  }
  for (const [firmId, n] of byFirm) await audit(systemActor(firmId), { entityType: 'retention', action: 'retention.purge', summary: `${n} file(s) deleted under the retention policy (KYC and expired records).` });
  return due.length;
}

export function startRetentionSchedule() {
  if (!env.RUN_JOBS) return;
  // 02:30 IST every day
  cron.schedule('30 2 * * *', () => { runRetention().catch((e) => console.error('[retention]', e)); }, { timezone: 'Asia/Kolkata' });
}
