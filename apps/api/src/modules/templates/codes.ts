// Which fields a format prints. A mapping prints its field, or a template of several fields with
// fixed words between them ("{{CUST.NAME}}, {{CASE.BRANCH_NAME}}"). No other imports: used by checks,
// rendering and the template engine alike.
import { db, json, type Tx } from '../../db/index.js';

const TAG_RE = /\{\{\s*([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)\s*\}\}/g;

/** Field codes a template prints: "{{CUST.NAME}}, {{CASE.BRANCH_NAME}}" → both codes. */
export const templateCodes = (t: string | null | undefined) => (t ? [...t.matchAll(TAG_RE)].map((m) => m[1]) : []);

/** A template that is just one field compiles to that field's own tag. */
export const singleField = (t: string | null | undefined) => { const m = t ? /^\s*\{\{\s*([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)\s*\}\}\s*$/.exec(t) : null; return m ? m[1] : null; };

/** Render key of a template with fixed words or several fields: filled at render time. */
export const templateKey = (slotKey: string) => `TPL.${slotKey}`;

/** Fill a template from the values already prepared for the report; empty fields drop with their separator. */
export function fillTemplate(t: string, value: (code: string) => string) {
  const GAP = '\u0000';
  const s = t.replace(TAG_RE, (_, c: string) => value(c) || GAP);
  return s.replace(/\s*[,;/]\s*\u0000/g, '').replace(/\u0000\s*[,;/]\s*/g, '').replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Templates of a version that compile to their own render key. */
export async function versionTemplates(versionId: number | null, tx: Tx = db) {
  if (!versionId) return [];
  const rows = await tx.selectFrom('template_mappings').select(['slot_key', 'location_json']).where('template_version_id', '=', versionId).where('ignored', '=', 0).execute();
  return rows.map((r) => ({ key: r.slot_key, template: json<any>(r.location_json, {}).template as string | null })).filter((r) => r.template && !singleField(r.template)) as { key: string; template: string }[];
}

/** Every field a version prints: mapped fields plus those inside templates. */
export async function versionFieldCodes(versionId: number | null, tx: Tx = db): Promise<string[]> {
  if (!versionId) return [];
  const rows = await tx.selectFrom('template_mappings').select(['field_code', 'location_json']).where('template_version_id', '=', versionId).where('ignored', '=', 0).execute();
  const out = new Set<string>();
  for (const r of rows) {
    if (r.field_code) out.add(r.field_code);
    for (const c of templateCodes(json<any>(r.location_json, {}).template)) out.add(c);
  }
  return [...out];
}
