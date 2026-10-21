// Firm settings, users & permissions, banks/branches, engineers, ready reckoner import,
// retention & privacy requests.
import sharp from 'sharp';
import { canHoldPermission, PERMISSIONS, ROLES, type Permission, type Role } from '@vm/shared';
import { db, toJson } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { grantDefaultPermissions, hashPassword, invalidatePerms } from '../../platform/auth.js';
import { financialYear } from '@vm/shared';
import { peekNumber, setNext } from '../../platform/sequences.js';
import { DEFAULT_SETTINGS, getSettings, setSettings, type FirmSettings } from '../../platform/settings.js';
import { purgeFile, saveFile } from '../../platform/storage.js';
import { IMAGES, requireKind } from '../../lib/sniff.js';

export async function firmProfile(firmId: number) {
  const firm = await db.selectFrom('firms').selectAll().where('id', '=', firmId).executeTakeFirstOrThrow();
  const settings = await getSettings(firmId);
  const fy = financialYear().short;
  const valuer = await db.selectFrom('users').select(['id', 'name', 'qualifications', 'ibbi_reg_no', 'ibbi_valid_upto']).where('firm_id', '=', firmId).where('role', '=', 'valuer').where('status', '=', 'active').orderBy('id').executeTakeFirst();
  return { firm, settings, valuer, nextCase: await peekNumber(db, firmId, 'case', fy), nextReport: await peekNumber(db, firmId, 'report', fy), fy };
}

export async function updateFirm(actor: Actor, patch: { name?: string; address?: string; city?: string; state_code?: string; gstin?: string; phone?: string; email?: string; code?: string; settings?: Partial<FirmSettings>; nextCase?: number; nextReport?: number; valuer?: { qualifications?: string; ibbi_reg_no?: string; ibbi_valid_upto?: string | null } }) {
  const firmId = actor.firmId!;
  const f: Record<string, unknown> = {};
  for (const k of ['name', 'address', 'city', 'state_code', 'gstin', 'phone', 'email', 'code'] as const) if (patch[k] !== undefined) f[k] = patch[k];
  if ((patch as any).shared_pool_consent !== undefined) f.shared_pool_consent = (patch as any).shared_pool_consent ? 1 : 0;
  if (f.code && !/^[A-Z0-9]{2,10}$/.test(String(f.code))) throw badRequest('Firm code: 2 to 10 capital letters or digits');
  if (Object.keys(f).length) await db.updateTable('firms').set(f).where('id', '=', firmId).execute();
  if (patch.settings) {
    const s = patch.settings;
    if (s.doc_grid !== undefined && ![9, 4, 1].includes(Number(s.doc_grid))) throw badRequest('Document pages per page: 9, 4 or 1');
    if (s.retention_years !== undefined && ![3, 5, 7, 10].includes(Number(s.retention_years))) throw badRequest('Retention: 3, 5, 7 or 10 years');
    const allowed = Object.fromEntries(Object.entries(s).filter(([k]) => k in DEFAULT_SETTINGS && !k.endsWith('_file_id')));
    await setSettings(firmId, allowed, actor.id ?? null);
  }
  const fy = financialYear().short;
  if (patch.nextCase !== undefined) {
    if (!(Number.isInteger(patch.nextCase) && patch.nextCase > 0)) throw badRequest('Next case no. must be a whole number');
    if (patch.nextCase < (await peekNumber(db, firmId, 'case', fy))) throw badRequest('Case numbers cannot go backwards');
    await setNext(db, firmId, 'case', fy, patch.nextCase);
  }
  if (patch.nextReport !== undefined) {
    if (!(Number.isInteger(patch.nextReport) && patch.nextReport > 0)) throw badRequest('Next report no. must be a whole number');
    const issued = await db.selectFrom('report_register').select('id').where('firm_id', '=', firmId).where('fy', '=', fy).limit(1).executeTakeFirst();
    if (issued && patch.nextReport < (await peekNumber(db, firmId, 'report', fy))) throw badRequest('Report numbers cannot go backwards once issued');
    await setNext(db, firmId, 'report', fy, patch.nextReport);
  }
  if (patch.valuer) {
    const v = await db.selectFrom('users').select('id').where('firm_id', '=', firmId).where('role', '=', 'valuer').where('status', '=', 'active').orderBy('id').executeTakeFirst();
    if (v) await db.updateTable('users').set({ qualifications: patch.valuer.qualifications, ibbi_reg_no: patch.valuer.ibbi_reg_no, ibbi_valid_upto: patch.valuer.ibbi_valid_upto ? new Date(patch.valuer.ibbi_valid_upto) : null }).where('id', '=', v.id).execute();
  }
  await audit(actor, { entityType: 'firm', entityId: firmId, action: 'firm.update', summary: `Firm settings changed: ${[...Object.keys(f), ...Object.keys(patch.settings ?? {}), ...(patch.nextCase ? ['next case no.'] : []), ...(patch.nextReport ? ['next report no.'] : []), ...(patch.valuer ? ['valuer'] : [])].join(', ')}`, after: patch });
}

export async function uploadBranding(actor: Actor, kind: 'letterhead' | 'signature' | 'seal', file: { name: string; mime: string; buffer: Buffer } | null) {
  const key = `${kind}_file_id` as const;
  const settings = await getSettings(actor.firmId!);
  if (!file) {
    await setSettings(actor.firmId!, { [key]: null } as any, actor.id ?? null);
    await audit(actor, { entityType: 'firm', action: 'firm.branding', summary: `${kind} removed` });
    return null;
  }
  requireKind(file.buffer, IMAGES, file.name);
  const buf = await sharp(file.buffer).rotate().resize({ width: kind === 'letterhead' ? 2400 : 900, withoutEnlargement: true }).png().toBuffer();
  const stored = await saveFile({ firmId: actor.firmId!, purpose: 'branding', buffer: buf, name: file.name, mime: 'image/png', userId: actor.id });
  await setSettings(actor.firmId!, { [key]: stored.id } as any, actor.id ?? null);
  await audit(actor, { entityType: 'firm', action: 'firm.branding', summary: `${kind} uploaded; used on signed reports.`, before: { file: settings[key] }, after: { file: stored.id } });
  return stored.id;
}

// ---- users & permissions --------------------------------------------------------------------

export async function listUsers(firmId: number) {
  const users = await db.selectFrom('users').select(['id', 'name', 'email', 'phone', 'role', 'status', 'qualifications', 'ibbi_reg_no', 'totp_enabled', 'last_login_at']).where('firm_id', '=', firmId).orderBy('id').execute();
  const perms = users.length ? await db.selectFrom('user_permissions').select(['user_id', 'perm']).where('user_id', 'in', users.map((u) => u.id)).execute() : [];
  return { permissions: PERMISSIONS, users: users.map((u) => ({ ...u, perms: perms.filter((p) => p.user_id === u.id).map((p) => p.perm) })) };
}

export async function addUser(actor: Actor, input: { name: string; email: string; role: Role; password: string; phone?: string | null }) {
  if (!ROLES.includes(input.role)) throw badRequest('Unknown role');
  if (!input.name?.trim()) throw badRequest('Name is required');
  if (!/^\S+@\S+\.\S+$/.test(input.email ?? '')) throw badRequest('Enter a valid email');
  if ((input.password ?? '').length < 10) throw badRequest('Password must be at least 10 characters');
  const exists = await db.selectFrom('users').select('id').where('email', '=', input.email.toLowerCase()).executeTakeFirst();
  if (exists) throw conflict('A user with this email already exists');
  const r = await db.insertInto('users').values({ firm_id: actor.firmId!, name: input.name.trim(), email: input.email.toLowerCase(), phone: input.phone ?? null, role: input.role, password_hash: await hashPassword(input.password) }).executeTakeFirstOrThrow();
  await grantDefaultPermissions(Number(r.insertId), input.role);
  await audit(actor, { entityType: 'user', entityId: Number(r.insertId), action: 'user.add', summary: `${input.name} added as ${input.role}` });
  return Number(r.insertId);
}

export async function setPermission(actor: Actor, userId: number, perm: Permission, on: boolean) {
  const u = await db.selectFrom('users').select(['id', 'role', 'name', 'firm_id']).where('id', '=', userId).executeTakeFirst();
  if (!u || u.firm_id !== actor.firmId) throw notFound('User');
  if (!(perm in PERMISSIONS)) throw badRequest('Unknown permission');
  if (on && !canHoldPermission(u.role as Role, perm)) throw badRequest('Only a registered valuer can sign');
  if (on) await db.insertInto('user_permissions').values({ user_id: userId, perm, granted_by: actor.id ?? null }).onDuplicateKeyUpdate({ granted_by: actor.id ?? null }).execute();
  else await db.deleteFrom('user_permissions').where('user_id', '=', userId).where('perm', '=', perm).execute();
  invalidatePerms(userId);
  await audit(actor, { entityType: 'user', entityId: userId, action: 'user.permission', summary: `${u.name}: ${PERMISSIONS[perm]} ${on ? 'granted' : 'removed'}` });
}

export async function setUserStatus(actor: Actor, userId: number, status: 'active' | 'disabled') {
  if (userId === actor.id) throw badRequest('You cannot disable yourself');
  const r = await db.updateTable('users').set({ status }).where('id', '=', userId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw notFound('User');
  if (status === 'disabled') await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
  invalidatePerms(userId);
  await audit(actor, { entityType: 'user', entityId: userId, action: 'user.status', summary: `User ${status}` });
}

// ---- banks, branches, engineers -------------------------------------------------------------

export const banks = () => db.selectFrom('banks').selectAll().where('status', '=', 'active').orderBy('code').execute();

export async function branches(firmId: number) {
  return db.selectFrom('bank_branches as br').innerJoin('banks as b', 'b.id', 'br.bank_id').selectAll('br').select(['b.code as bank_code', 'b.name as bank_name'])
    .where('br.firm_id', '=', firmId).where('br.status', '=', 'active').orderBy('b.code').orderBy('br.name').execute();
}

export async function saveBranch(actor: Actor, input: any) {
  if (input.id) {
    const keys = ['bank_id', 'code', 'name', 'address', 'city', 'state_code', 'gstin', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'default_payer', 'billing_cycle', 'fee', 'status'];
    const set = Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, k === 'code' ? String(input[k]).toUpperCase().trim() : input[k]]));
    if (!Object.keys(set).length) return;
    const r = await db.updateTable('bank_branches').set(set).where('id', '=', input.id).where('firm_id', '=', actor.firmId!).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound('Branch');
    await audit(actor, { entityType: 'branch', entityId: input.id, action: 'branch.update', summary: `Branch ${set.code ?? input.id} updated`, after: set });
    return;
  }
  const row = {
    bank_id: Number(input.bank_id), code: String(input.code ?? '').toUpperCase().trim(), name: String(input.name ?? '').trim(), address: input.address ?? null, city: input.city ?? null,
    state_code: input.state_code ?? null, gstin: input.gstin ?? null, contact_name: input.contact_name ?? null, contact_role: input.contact_role ?? null,
    contact_email: input.contact_email ?? null, contact_phone: input.contact_phone ?? null, default_payer: input.default_payer ?? 'bank', billing_cycle: input.billing_cycle ?? 'case', fee: input.fee ?? null,
  };
  if (!row.code || !row.name || !row.bank_id) throw badRequest('Bank, branch code and name are required');
  if (input.id) await db.updateTable('bank_branches').set(row).where('id', '=', input.id).where('firm_id', '=', actor.firmId!).execute();
  else await db.insertInto('bank_branches').values({ firm_id: actor.firmId!, ...row }).execute();
  await audit(actor, { entityType: 'branch', entityId: input.id ?? row.code, action: input.id ? 'branch.update' : 'branch.add', summary: `Branch ${row.code} ${row.name} saved`, after: row });
}

export const engineers = (firmId: number) => db.selectFrom('engineers').selectAll().where('firm_id', '=', firmId).where('status', '=', 'active').orderBy('name').execute();

export async function saveEngineer(actor: Actor, input: { id?: number; name: string; phone?: string; email?: string; localities?: string; fee_per_visit?: number | null; status?: 'active' | 'retired' }) {
  if (!input.name?.trim()) throw badRequest('Name is required');
  const row = { name: input.name.trim(), phone: input.phone ?? null, email: input.email ?? null, localities: input.localities ?? null, fee_per_visit: input.fee_per_visit ?? null, status: input.status ?? 'active' };
  if (input.id) await db.updateTable('engineers').set(row).where('id', '=', input.id).where('firm_id', '=', actor.firmId!).execute();
  else await db.insertInto('engineers').values({ firm_id: actor.firmId!, ...row }).execute();
  await audit(actor, { entityType: 'engineer', entityId: input.id ?? row.name, action: 'engineer.save', summary: `Field engineer ${row.name} saved` });
}

/** Ready reckoner rows from CSV: year_label,state_code,district,taluka,village,village_alt,zone,category,rate_per_sqm */
export async function importReadyReckoner(actor: Actor, rows: Record<string, string>[], preview: boolean) {
  const errors: string[] = [];
  const clean = rows.map((r, i) => {
    const rate = Number(String(r.rate_per_sqm ?? '').replace(/[, ]/g, ''));
    if (!r.year_label || !/^\d{4}-\d{2}$/.test(r.year_label)) errors.push(`Row ${i + 2}: year_label like 2025-26`);
    if (!r.village) errors.push(`Row ${i + 2}: village is required`);
    if (!(rate > 0)) errors.push(`Row ${i + 2}: rate_per_sqm must be a number`);
    return { firm_id: actor.firmId!, year_label: r.year_label, state_code: r.state_code || '27', district: r.district ?? '', taluka: r.taluka || null, village: r.village, village_alt: r.village_alt || null, zone: r.zone || null, category: (r.category || 'residential').toLowerCase(), rate_per_sqm: rate, source: r.source || 'CSV import' };
  });
  if (preview || errors.length) return { ok: !errors.length, errors: errors.slice(0, 50), rows: clean.slice(0, 20), count: clean.length };
  for (let i = 0; i < clean.length; i += 500) await db.insertInto('ready_reckoner_rates').values(clean.slice(i, i + 500)).execute();
  await audit(actor, { entityType: 'ready_reckoner', action: 'rr.import', summary: `${clean.length} ready reckoner rows imported` });
  return { ok: true, errors: [], rows: [], count: clean.length };
}

// ---- privacy: borrower data requests ----------------------------------------------------------

export async function findBorrower(firmId: number, q: string) {
  if ((q ?? '').trim().length < 3) throw badRequest('Type at least 3 letters of the name');
  return db.selectFrom('assignments').select(['id', 'case_no', 'borrower_name', 'created_at', 'personal_data_removed_at']).where('firm_id', '=', firmId).where('borrower_name', 'like', `%${q.trim()}%`).limit(50).execute();
}

/** Remove names, contacts and KYC; keep property and rate data (DPDP Act request). */
export async function deletePersonalData(actor: Actor, assignmentId: number, requestedBy: string) {
  const a = await db.selectFrom('assignments').select(['id', 'case_no', 'borrower_name']).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('assignments').set({ borrower_name: null, bank_contact: null, personal_data_removed_at: new Date() }).where('id', '=', assignmentId).execute();
    const personal = ['CUST.NAME', 'DOC.AGREEMENT.SELLER', 'DOC.AGREEMENT.BUYER', 'DOC.NOC.ISSUED_TO', 'OCC.PERSON_MET'];
    await tx.updateTable('field_values').set({ value_text: '(removed)', snippet: null, value_json: null }).where('assignment_id', '=', assignmentId).where('field_code', 'in', personal).execute();
    const kyc = await tx.selectFrom('files as f').innerJoin('document_pages as p', (j) => j.on((eb) => eb.or([eb('p.image_file_id', '=', eb.ref('f.id')), eb('p.thumb_file_id', '=', eb.ref('f.id'))])))
      .innerJoin('documents as d', 'd.id', 'p.document_id').select('f.id').where('d.assignment_id', '=', assignmentId).where('f.is_kyc', '=', 1).execute();
    for (const k of kyc) await purgeFile(k.id, tx);
    await audit(actor, { entityType: 'privacy', entityId: assignmentId, assignmentId, action: 'privacy.delete', summary: `Personal data removed for ${a.case_no} on request of ${requestedBy}; property and rate data kept.`, reason: `Borrower data request: ${requestedBy}` }, tx);
  });
}

export async function privacyRequests(firmId: number) {
  return db.selectFrom('audit_log').select(['id', 'created_at', 'summary', 'reason', 'action']).where('firm_id', '=', firmId).where('entity_type', '=', 'privacy').orderBy('id', 'desc').limit(100).execute();
}

export async function exportPersonalData(actor: Actor, assignmentId: number, requestedBy: string) {
  const a = await db.selectFrom('assignments').select(['id', 'case_no', 'borrower_name', 'created_at']).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  const vals = await db.selectFrom('field_values').select(['field_code', 'value_text', 'source_type', 'created_at']).where('assignment_id', '=', assignmentId).where('is_current', '=', 1).where('field_code', 'in', ['CUST.NAME', 'PROP.ADDRESS', 'DOC.AGREEMENT.BUYER', 'DOC.AGREEMENT.SELLER']).execute();
  await audit(actor, { entityType: 'privacy', entityId: assignmentId, assignmentId, action: 'privacy.export', summary: `Copy of personal data for ${a.case_no} prepared for ${requestedBy}.`, reason: `Borrower data request: ${requestedBy}` });
  return { case: a, values: vals };
}

export { toJson };
