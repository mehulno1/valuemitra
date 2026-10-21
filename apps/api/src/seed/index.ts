// Seeds platform master data (dictionary, configuration v1, banks) and, unless --platform-only,
// a demo firm with users, branches, engineers and sample ready reckoner rows.
import path from 'node:path';
import { DEFAULT_PERMISSIONS, type Role } from '@vm/shared';
import { db, toJson } from '../db/index.js';
import { hashPassword } from '../platform/auth.js';
import { CHECK_SET, DOC_TYPES, PROFILE_FLAT, RULE_SET, WORDING } from './config.js';
import { FIELDS } from './fields.js';

const BANKS = [
  ['SBI', 'State Bank of India', 'SBI'],
  ['BOB', 'Bank of Baroda', 'BoB'],
  ['UBI', 'Union Bank of India', 'Union Bank'],
  ['BOI', 'Bank of India', 'BOI'],
  ['BOM', 'Bank of Maharashtra', 'BoM'],
  ['NKGSB', 'NKGSB Co-operative Bank', 'NKGSB'],
  ['FED', 'Federal Bank', 'Federal'],
  ['HDFC', 'HDFC Bank', 'HDFC'],
] as const;

export async function seedPlatform() {
  for (const [code, name, short] of BANKS) {
    await db.insertInto('banks').values({ code, name, short_name: short }).onDuplicateKeyUpdate({ name, short_name: short }).execute();
  }
  // platform dictionary: add new fields as v1; a changed definition ships as a new version (never edited in place)
  const have = await db.selectFrom('canonical_fields').selectAll().where('firm_id', 'is', null).orderBy('version', 'desc').execute();
  const latest = new Map<string, (typeof have)[number]>();
  for (const h of have) if (!latest.has(h.code)) latest.set(h.code, h);
  // MySQL stores JSON with its own key order, so compare with keys sorted
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as any)[k])])) : v);
  const j = (v: unknown) => JSON.stringify(canon(typeof v === 'string' ? JSON.parse(v) : v ?? null));
  let i = 0;
  let added = 0;
  let versioned = 0;
  for (const f of FIELDS) {
    i += 10;
    const row = {
      label: f.label, group_code: f.group, data_type: f.type, unit: f.unit ?? null,
      enum_options: f.enum ? toJson(f.enum) : null, applies_to: toJson(f.applies ?? ['*']), sources: toJson(f.sources),
      validation: f.validation ? toJson(f.validation) : null, derivation: f.derivation ?? null, rules: f.rules ? toJson(f.rules) : null,
      extraction_hint: f.hint ?? null, aliases: toJson(f.aliases ?? []), pending_label: f.pending ?? null, sort_order: i,
    };
    const cur = latest.get(f.code);
    if (cur) {
      const same = cur.label === row.label && cur.group_code === row.group_code && cur.data_type === row.data_type && (cur.unit ?? null) === row.unit &&
        j(cur.enum_options) === j(row.enum_options) && j(cur.applies_to) === j(row.applies_to) && j(cur.sources) === j(row.sources) &&
        j(cur.validation) === j(row.validation) && (cur.derivation ?? null) === row.derivation && j(cur.rules) === j(row.rules) &&
        (cur.extraction_hint ?? null) === row.extraction_hint && j(cur.aliases) === j(row.aliases) && (cur.pending_label ?? null) === row.pending_label;
      if (same) continue;
      await db.insertInto('canonical_fields').values({ firm_id: null, code: f.code, version: cur.version + 1, ...row, change_note: 'Platform dictionary update' }).execute();
      versioned++;
    } else {
      await db.insertInto('canonical_fields').values({ firm_id: null, code: f.code, version: 1, ...row, change_note: 'Initial dictionary' }).execute();
      added++;
    }
  }
  const configs: [string, string, unknown][] = [
    ['doc_types', 'default', DOC_TYPES],
    ['profile', 'flat', PROFILE_FLAT],
    ['rule_set', 'firm', RULE_SET],
    ['check_set', 'default', CHECK_SET],
    ['wording', 'default', WORDING],
  ];
  for (const [kind, ckey, payload] of configs) {
    const exists = await db.selectFrom('config_versions').select('id').where('firm_id', 'is', null).where('kind', '=', kind).where('ckey', '=', ckey).executeTakeFirst();
    if (exists) continue;
    await db.insertInto('config_versions').values({
      firm_id: null, kind, ckey, version: 1, status: 'published', effective_from: new Date('2025-04-01'),
      payload_json: toJson(payload), change_note: 'Initial platform configuration', published_at: new Date(),
    }).execute();
  }
  console.log(`Platform: ${BANKS.length} banks, ${FIELDS.length} fields (${added} added, ${versioned} new versions), ${configs.length} configurations`);
}

export async function seedDemoFirm() {
  const exists = await db.selectFrom('firms').select('id').where('code', '=', 'DVA').executeTakeFirst();
  if (exists) { console.log('Demo firm exists'); return exists.id; }
  const r = await db.insertInto('firms').values({
    code: 'DVA', name: 'Demo Valuers & Associates', address: 'Office 4, Example Chambers, Wagle Estate, Thane (W) 400604',
    city: 'Thane', state_code: '27', state_name: 'Maharashtra', gstin: '27AABFD1234K1Z9', email: 'office@demovaluers.example', phone: '022 0000 0000',
  }).executeTakeFirstOrThrow();
  const firmId = Number(r.insertId);
  const password = process.env.SEED_PASSWORD ?? 'ValueMitra@2026';
  const hash = await hashPassword(password);
  const users: [string, string, Role, Partial<{ qualifications: string; ibbi_reg_no: string }>][] = [
    ['Er. Vikram S. Deshmukh', 'valuer@demo.valuemitra.in', 'valuer', { qualifications: 'B.E. (Civil), F.I.V.', ibbi_reg_no: 'IBBI/RV/00/0000/00000 (dummy)' }],
    ['Sneha Kadam', 'coordinator@demo.valuemitra.in', 'coordinator', {}],
    ['Priya Nair', 'accounts@demo.valuemitra.in', 'accounts', {}],
    ['Firm Admin', 'admin@demo.valuemitra.in', 'admin', {}],
  ];
  for (const [name, email, role, extra] of users) {
    const u = await db.insertInto('users').values({ firm_id: firmId, name, email, role, password_hash: hash, ...extra }).executeTakeFirstOrThrow();
    const perms = DEFAULT_PERMISSIONS[role];
    if (perms.length) await db.insertInto('user_permissions').values(perms.map((perm) => ({ user_id: Number(u.insertId), perm }))).execute();
  }
  const bank = async (code: string) => (await db.selectFrom('banks').select('id').where('code', '=', code).executeTakeFirstOrThrow()).id;
  const branches: [string, string, string, Record<string, unknown>][] = [
    ['SBI', 'HLCTHN', 'Home Loan Centre, Thane', { contact_name: 'Mr. Joshi', contact_role: 'Credit Officer', city: 'Thane', default_payer: 'bank', billing_cycle: 'batch', fee: 3000, gstin: '27AAACS8577K1Z6' }],
    ['SBI', 'THNMN', 'Thane Main', { contact_name: 'Mrs. Rao', contact_role: 'Branch Manager', city: 'Thane', default_payer: 'bank', billing_cycle: 'batch', fee: 3000, gstin: '27AAACS8577K1Z6' }],
    ['SBI', 'MIDCAN', 'MIDC Andheri East', { contact_name: 'Mr. Shah', contact_role: 'Credit Officer', city: 'Mumbai', default_payer: 'bank', billing_cycle: 'batch', fee: 3000, gstin: '27AAACS8577K1Z6' }],
    ['BOB', 'DOMB', 'Dombivli', { contact_name: 'Mr. Patkar', city: 'Dombivli', default_payer: 'bank', billing_cycle: 'batch', fee: 2500, gstin: '27AAACB1534F1ZQ' }],
    ['UBI', 'GHTK', 'Ghatkopar', { contact_name: 'Ms. Iyer', city: 'Mumbai', default_payer: 'bank', billing_cycle: 'batch', fee: 2500, gstin: '27AAACU0564G1ZQ' }],
    ['BOI', 'MULUND', 'Mulund', { contact_name: 'Mr. Desai', city: 'Mumbai', default_payer: 'borrower', billing_cycle: 'case', fee: 2500 }],
  ];
  for (const [b, code, name, extra] of branches) {
    await db.insertInto('bank_branches').values({ firm_id: firmId, bank_id: await bank(b), code, name, state_code: '27', ...extra } as any).execute();
  }
  const engineers: [string, string][] = [
    ['Ramesh Gawde', 'Thane (W): Majiwada, Panchpakhadi, Vartak Nagar'],
    ['Sachin More', 'Thane (E), Kopri, Mulund'],
    ['Imran Khan', 'Kalwa, Mumbra, Diva'],
    ['Pooja Salvi', 'Dombivli, Kalyan'],
  ];
  let n = 1;
  for (const [name, localities] of engineers) {
    await db.insertInto('engineers').values({ firm_id: firmId, name, localities, phone: `98200000${String(n++).padStart(2, '0')}`, fee_per_visit: 800 }).execute();
  }
  console.log(`Demo firm DVA (id ${firmId}); users: ${users.map((u) => u[1]).join(', ')}; password from SEED_PASSWORD or default`);
  return firmId;
}

export async function seedReadyReckoner() {
  const have = await db.selectFrom('ready_reckoner_rates').select('id').limit(1).executeTakeFirst();
  if (have) return;
  const rows: [string, string, string, string, string, string, string, number][] = [
    ['2025-26', '27', 'Thane', 'Thane', 'Majiwade', 'माजिवडे,Majiwada,Majiwde', '6/28', 124400],
    ['2025-26', '27', 'Thane', 'Thane', 'Panchpakhadi', 'पाचपाखाडी', '4/12', 131200],
    ['2025-26', '27', 'Mumbai Suburban', 'Kurla', 'Mulund', 'मुलुंड', '118/602', 168900],
  ];
  for (const [y, st, d, t, v, alt, z, rate] of rows) {
    await db.insertInto('ready_reckoner_rates').values({ firm_id: null, year_label: y, state_code: st, district: d, taluka: t, village: v, village_alt: alt, zone: z, category: 'residential', rate_per_sqm: rate, source: 'Sample rows (replace with the official import)' }).execute();
  }
  await db.insertInto('ready_reckoner_rates').values({ firm_id: null, year_label: '2025-26', state_code: '27', district: 'Thane', taluka: 'Thane', village: 'Majiwade', village_alt: 'माजिवडे,Majiwada', zone: '6/28', category: 'shop', rate_per_sqm: 159600, source: 'Sample rows (replace with the official import)' }).execute();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  (async () => {
    await seedPlatform();
    await seedReadyReckoner();
    if (!process.argv.includes('--platform-only')) await seedDemoFirm();
    // the SBI Format-A template is generated and published by the templates seed
    const { seedTemplates } = await import('./templates.js');
    await seedTemplates();
    await db.destroy();
  })().catch((e) => { console.error(e); process.exit(1); });
}
