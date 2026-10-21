// Onboards the SBI Format-A template through the template engine, the way an admin would:
// upload → auto-map → confirm the remaining labels → publish v1.
import { db } from '../db/index.js';
import type { Actor } from '../platform/audit.js';
import { confirmMapping, publishVersion, uploadTemplate } from '../modules/templates/service.js';
import { buildSbiFormatA } from './sbi-format-a.js';

// labels the admin confirms by hand (everything else below the auto-accept threshold stays fixed text)
const CONFIRM: Record<string, string> = {
  'Adjoining Properties: Boundaries as per Actual': 'PHYS.BOUNDARIES',
};

export async function seedTemplates() {
  const exists = await db.selectFrom('report_templates').select('id').where('code', '=', 'SBI_FORMAT_A').executeTakeFirst();
  if (exists) { console.log('SBI Format-A exists'); return; }
  const actor: Actor = { type: 'admin', name: 'ValueMitra onboarding', firmId: null };
  const buffer = await buildSbiFormatA();
  await db.transaction().execute(async (tx) => {
    const r = await uploadTemplate(actor, {
      platform: true, bankCode: 'SBI', code: 'SBI_FORMAT_A', name: 'Annexure XI, Format-A (Home Loan Centre)',
      propertyTypes: ['flat', 'shop', 'office'], branchScope: ['*'], fileName: 'SBI_Annexure_XI_Format_A.docx', buffer,
      effectiveFrom: '2025-04-01', note: 'Recreated from the ValueMitra prototype report pages',
    }, tx);
    const open = await tx.selectFrom('template_mappings').select(['id', 'label_text']).where('template_version_id', '=', r.versionId).where('confirmed_at', 'is', null).execute();
    for (const m of open) {
      const code = CONFIRM[m.label_text];
      await confirmMapping(actor, r.versionId, m.id, code ? { fieldCode: code } : { ignore: true }, tx);
    }
    await publishVersion(actor, r.versionId, '2025-04-01', tx);
    console.log(`SBI Format-A v${r.version}: ${r.found} slots, ${r.matched} matched automatically, ${open.length} confirmed by onboarding`);
  });
}
