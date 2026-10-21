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

/** Bump when the built layout changes; the next seed publishes it as a new version (cases keep theirs). */
const REV = 2;
const REV_NOTES: Record<number, string> = {
  1: 'Recreated from the ValueMitra prototype report pages',
  2: 'Format-A flows from page to page; rows and signature blocks are kept together',
};

export async function seedTemplates() {
  const actor: Actor = { type: 'admin', name: 'ValueMitra onboarding', firmId: null };
  const exists = await db.selectFrom('report_templates').select('id').where('code', '=', 'SBI_FORMAT_A').where('firm_id', 'is', null).executeTakeFirst();
  const tag = `[rev ${REV}]`;
  if (exists) {
    const done = await db.selectFrom('template_versions').select('id').where('template_id', '=', exists.id).where('change_note', 'like', `%${tag}%`).executeTakeFirst();
    if (done) { console.log(`SBI Format-A rev ${REV} exists`); return; }
  }
  const buffer = await buildSbiFormatA();
  const effective = exists ? new Date().toISOString().slice(0, 10) : '2025-04-01';
  await db.transaction().execute(async (tx) => {
    const r = await uploadTemplate(actor, {
      ...(exists ? { templateId: exists.id } : { bankCode: 'SBI', code: 'SBI_FORMAT_A', name: 'Annexure XI, Format-A (Home Loan Centre)', propertyTypes: ['flat', 'shop', 'office'], branchScope: ['*'] }),
      platform: true, fileName: 'SBI_Annexure_XI_Format_A.docx', buffer, effectiveFrom: effective, note: `${REV_NOTES[REV]} ${tag}`,
    }, tx);
    const open = await tx.selectFrom('template_mappings').select(['id', 'label_text']).where('template_version_id', '=', r.versionId).where('confirmed_at', 'is', null).execute();
    for (const m of open) {
      const code = CONFIRM[m.label_text];
      await confirmMapping(actor, r.versionId, m.id, code ? { fieldCode: code } : { ignore: true }, tx);
    }
    await publishVersion(actor, r.versionId, effective, tx);
    console.log(`SBI Format-A v${r.version} (rev ${REV}): ${r.found} slots, ${r.matched} matched automatically, ${open.length} confirmed by onboarding`);
  });
}
