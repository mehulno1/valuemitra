// CSV imports with a validated preview: banks & branches, field engineers, comparable transactions
// and past valuation reports (both feed the firm's comparables database). Import = preview, then
// the same file again with preview off. Rows are matched so re-importing a file updates, not duplicates.
import { db } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { activeConfig } from '../../platform/config.js';

export const IMPORTS = {
  branches: {
    label: 'Banks & branches',
    columns: ['bank_code', 'branch_code', 'branch_name', 'address', 'city', 'state_code', 'gstin', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'default_payer', 'billing_cycle', 'fee'],
    example: ['SBI', 'HLCTHN', 'Home Loan Centre, Thane', 'Station Road, Thane (W)', 'Thane', '27', '27AAACS8577K1Z6', 'Mr. Joshi', 'Credit Officer', 'hlc.thane@example.com', '9800000000', 'bank', 'batch', '3000'],
  },
  engineers: {
    label: 'Field engineers',
    columns: ['name', 'phone', 'email', 'localities', 'fee_per_visit'],
    example: ['Ramesh Gawde', '9820000001', '', 'Thane (W): Majiwada, Panchpakhadi', '800'],
  },
  comparables: {
    label: 'Comparable transactions',
    columns: ['date', 'source', 'document_no', 'building', 'society', 'locality', 'village', 'city', 'property_type', 'area_sqft', 'area_type', 'price', 'floor', 'total_floors', 'building_age', 'lift', 'bhk', 'notes'],
    example: ['2026-08-14', 'index2', '7044/2026', 'Vrindavan Tower', 'Vrindavan CHS', 'Majiwada', 'Majiwade', 'Thane', 'flat', '640', 'carpet', '9850000', '7', '14', '8', 'yes', '2BHK', ''],
  },
  past_reports: {
    label: 'Past valuation reports',
    columns: ['report_no', 'date', 'bank', 'building', 'locality', 'village', 'city', 'property_type', 'bua_sqft', 'rate_per_sqft', 'fmv', 'notes'],
    example: ['DVA/SBI/HLCTHN/25-26/0812', '2026-02-11', 'SBI', 'Vrindavan Tower', 'Majiwada', 'Majiwade', 'Thane', 'flat', '760', '12900', '9804000', ''],
  },
} as const;
export type ImportKind = keyof typeof IMPORTS;

const n = (v: string | undefined) => { const x = Number(String(v ?? '').replace(/[, ₹]|rs\.?/gi, '')); return Number.isFinite(x) && String(v ?? '').trim() !== '' ? x : null; };
const t = (v: string | undefined) => (v ?? '').trim() || null;
const PROPERTY = ['flat', 'shop', 'office', 'open_land', 'bungalow'];
const SOURCES = ['index2', 'igr_search', 'listing', 'broker', 'import'];

export async function importCsv(actor: Actor, kind: ImportKind, rows: Record<string, string>[], preview: boolean) {
  if (!(kind in IMPORTS)) throw badRequest('Unknown import');
  if (!rows.length) throw badRequest('The file has no rows under the header');
  if (rows.length > 20000) throw badRequest('Up to 20,000 rows per file');
  const firmId = actor.firmId!;
  const errors: string[] = [];
  const err = (i: number, m: string) => errors.push(`Row ${i + 2}: ${m}`);
  let clean: Record<string, unknown>[] = [];

  if (kind === 'branches') {
    const banks = new Map((await db.selectFrom('banks').select(['id', 'code']).execute()).map((b) => [b.code.toUpperCase(), b.id]));
    clean = rows.map((r, i) => {
      const bank = banks.get((r.bank_code ?? '').trim().toUpperCase());
      if (!bank) err(i, `unknown bank_code "${r.bank_code ?? ''}" (use ${[...banks.keys()].join(', ')})`);
      if (!t(r.branch_code) || !t(r.branch_name)) err(i, 'branch_code and branch_name are required');
      const payer = (r.default_payer || 'bank').toLowerCase();
      const cycle = (r.billing_cycle || 'case').toLowerCase();
      if (!['bank', 'borrower'].includes(payer)) err(i, 'default_payer is bank or borrower');
      if (!['case', 'batch'].includes(cycle)) err(i, 'billing_cycle is case or batch');
      if (r.gstin && !/^\d{2}[A-Z0-9]{13}$/i.test(r.gstin.trim())) err(i, 'gstin should be 15 characters');
      if (r.fee && n(r.fee) === null) err(i, 'fee must be a number');
      return {
        bank_id: bank ?? 0, code: (r.branch_code ?? '').trim().toUpperCase(), name: (r.branch_name ?? '').trim(), address: t(r.address), city: t(r.city), state_code: t(r.state_code)?.padStart(2, '0') ?? (r.gstin ? r.gstin.slice(0, 2) : null),
        gstin: t(r.gstin)?.toUpperCase() ?? null, contact_name: t(r.contact_name), contact_role: t(r.contact_role), contact_email: t(r.contact_email), contact_phone: t(r.contact_phone),
        default_payer: payer as 'bank' | 'borrower', billing_cycle: cycle as 'case' | 'batch', fee: n(r.fee),
      };
    });
  } else if (kind === 'engineers') {
    clean = rows.map((r, i) => {
      if (!t(r.name)) err(i, 'name is required');
      if (r.fee_per_visit && n(r.fee_per_visit) === null) err(i, 'fee_per_visit must be a number');
      return { name: (r.name ?? '').trim(), phone: t(r.phone), email: t(r.email), localities: t(r.localities), fee_per_visit: n(r.fee_per_visit) };
    });
  } else {
    const rules = await activeConfig('rule_set', 'firm', firmId);
    const loading = Number((rules?.payload as any)?.loading_pct ?? 20);
    const past = kind === 'past_reports';
    clean = rows.map((r, i) => {
      const date = (r.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err(i, 'date like 2026-08-14');
      const type = (r.property_type || 'flat').toLowerCase();
      if (!PROPERTY.includes(type)) err(i, `property_type is one of ${PROPERTY.join(', ')}`);
      const area = n(past ? r.bua_sqft : r.area_sqft);
      if (!(area && area > 0)) err(i, `${past ? 'bua_sqft' : 'area_sqft'} must be a number`);
      const basis = past ? 'bua' : (r.area_type || 'bua').toLowerCase();
      if (!['bua', 'carpet', 'saleable'].includes(basis)) err(i, 'area_type is bua, carpet or saleable');
      const bua = area ? Math.round(basis === 'carpet' ? area * (1 + loading / 100) : area) : 0;
      const price = past ? n(r.fmv) ?? (n(r.rate_per_sqft) && area ? n(r.rate_per_sqft)! * area : null) : n(r.price);
      if (!(price && price > 0)) err(i, past ? 'fmv or rate_per_sqft is required' : 'price must be a number');
      const source = past ? 'own_report' : (r.source || 'import').toLowerCase();
      if (!past && !SOURCES.includes(source)) err(i, `source is one of ${SOURCES.join(', ')}`);
      if (!t(r.locality) && !t(r.village) && !t(r.building)) err(i, 'give at least building, locality or village');
      const lift = (r.lift ?? '').trim().toLowerCase();
      return {
        firm_id: firmId, scope: 'private' as const, source_type: source as any, source_ref: t(past ? r.report_no : r.document_no), property_type: type,
        building: t(r.building), society: t(r.society), locality: t(r.locality), village: t(r.village), city: t(r.city), txn_date: date ? new Date(`${date}T00:00:00Z`) : null,
        is_asking_price: source === 'listing' ? 1 : 0, area_value: area ?? 0, area_basis: basis as any, area_bua_sqft: bua, price: price ?? 0, rate_per_sqft: bua && price ? Math.round(price / bua) : 0,
        floor_no: n(r.floor), total_floors: n(r.total_floors), building_age: n(r.building_age), has_lift: lift ? (['yes', 'y', '1', 'true'].includes(lift) ? 1 : 0) : null, bhk: t(r.bhk),
        notes: [past ? `Imported past report${r.bank ? ` (${r.bank})` : ''}` : 'CSV import', t(r.notes)].filter(Boolean).join(' · ').slice(0, 500), created_by: actor.id ?? null,
      };
    });
  }

  if (preview || errors.length) return { ok: !errors.length, errors: errors.slice(0, 50), errorCount: errors.length, rows: clean.slice(0, 10), count: clean.length };

  let added = 0;
  let updated = 0;
  await db.transaction().execute(async (tx) => {
    if (kind === 'branches') {
      for (const r of clean as any[]) {
        const have = await tx.selectFrom('bank_branches').select('id').where('firm_id', '=', firmId).where('bank_id', '=', r.bank_id).where('code', '=', r.code).executeTakeFirst();
        if (have) { await tx.updateTable('bank_branches').set({ ...r, status: 'active' }).where('id', '=', have.id).execute(); updated++; }
        else { await tx.insertInto('bank_branches').values({ firm_id: firmId, ...r }).execute(); added++; }
      }
    } else if (kind === 'engineers') {
      const have = await tx.selectFrom('engineers').select(['id', 'name']).where('firm_id', '=', firmId).execute();
      for (const r of clean as any[]) {
        const e = have.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
        if (e) { await tx.updateTable('engineers').set({ ...r, status: 'active' }).where('id', '=', e.id).execute(); updated++; }
        else { await tx.insertInto('engineers').values({ firm_id: firmId, ...r }).execute(); added++; }
      }
    } else {
      // the same document / report number again replaces the earlier import
      const refs = (clean as any[]).map((r) => r.source_ref).filter(Boolean);
      if (refs.length) {
        for (let i = 0; i < refs.length; i += 500) {
          const r = await tx.deleteFrom('comparables').where('firm_id', '=', firmId).where('origin_assignment_id', 'is', null).where('source_ref', 'in', refs.slice(i, i + 500))
            .where('source_type', 'in', kind === 'past_reports' ? ['own_report'] : SOURCES as any).executeTakeFirst();
          updated += Number(r.numDeletedRows);
        }
      }
      for (let i = 0; i < clean.length; i += 500) await tx.insertInto('comparables').values(clean.slice(i, i + 500) as any).execute();
      added = clean.length - updated;
    }
  });
  await audit(actor, { entityType: 'import', entityId: kind, action: `import.${kind}`, summary: `${IMPORTS[kind].label}: ${clean.length} rows imported (${added} added, ${updated} updated).` });
  return { ok: true, errors: [], errorCount: 0, rows: [], count: clean.length, added, updated };
}

/** Rows for export in the same columns as the import template. */
export async function exportRows(firmId: number, kind: ImportKind): Promise<string[][]> {
  if (kind === 'branches') {
    const rows = await db.selectFrom('bank_branches as br').innerJoin('banks as b', 'b.id', 'br.bank_id').selectAll('br').select('b.code as bank_code').where('br.firm_id', '=', firmId).where('br.status', '=', 'active').orderBy('b.code').orderBy('br.code').execute();
    return rows.map((r) => [r.bank_code, r.code, r.name, r.address, r.city, r.state_code, r.gstin, r.contact_name, r.contact_role, r.contact_email, r.contact_phone, r.default_payer, r.billing_cycle, r.fee].map((v) => (v === null || v === undefined ? '' : String(v))));
  }
  if (kind === 'engineers') {
    const rows = await db.selectFrom('engineers').selectAll().where('firm_id', '=', firmId).where('status', '=', 'active').orderBy('name').execute();
    return rows.map((r) => [r.name, r.phone, r.email, r.localities, r.fee_per_visit].map((v) => (v === null || v === undefined ? '' : String(v))));
  }
  const past = kind === 'past_reports';
  const rows = await db.selectFrom('comparables').selectAll().where('firm_id', '=', firmId).$if(past, (q) => q.where('source_type', '=', 'own_report')).$if(!past, (q) => q.where('source_type', '!=', 'own_report'))
    .orderBy('txn_date', 'desc').limit(20000).execute();
  const d = (x: Date | null) => (x ? new Date(x).toISOString().slice(0, 10) : '');
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return past
    ? rows.map((r) => [r.source_ref, d(r.txn_date), '', r.building, r.locality, r.village, r.city, r.property_type, r.area_bua_sqft, r.rate_per_sqft, r.price, r.notes].map(s))
    : rows.map((r) => [d(r.txn_date), r.source_type, r.source_ref, r.building, r.society, r.locality, r.village, r.city, r.property_type, r.area_value, r.area_basis, r.price, r.floor_no, r.total_floors, r.building_age, r.has_lift === null ? '' : r.has_lift ? 'yes' : 'no', r.bhk, r.notes].map(s));
}
