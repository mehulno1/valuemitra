// Per-format page layout (retest of 13 Nov, H3): photos per page, document pages per page, evidence per page,
// documents at the end and minimum photos are firm defaults (Settings → Report layout) that a bank format can
// override. A value the format leaves unset follows the firm. Read at render time, so changing the firm default
// changes every format that has no own choice.
import { db, json, type Tx } from '../../db/index.js';
import { getSettings } from '../../platform/settings.js';

export interface PageLayout {
  photo_grid?: 4 | 6 | 9;
  doc_grid?: 1 | 4 | 9;
  evidence_per_page?: 1 | 2;
  docs_at_end?: boolean;
  min_photos?: number;
  /** ValueMitra's standard annexure sections this format leaves out (tagged formats: the "Undo" on the
   *  standard sections line) */
  annex_off?: AnnexKey[];
}

export const PAGE_KEYS = ['photo_grid', 'doc_grid', 'evidence_per_page', 'docs_at_end', 'min_photos'] as const;
export const ANNEX_SECTIONS = [
  { key: 'photos', label: 'Photographs', title: /^PHOTOGRAPHS/ },
  { key: 'map', label: 'Location map', title: /^LOCATION MAP/ },
  { key: 'rr', label: 'Ready reckoner', title: /^STAMP DUTY READY RECKONER/ },
  { key: 'listings', label: 'Property listings', title: /^PROPERTY LISTING/ },
  { key: 'sales', label: 'Sale transactions', title: /^SALE TRANSACTIONS/ },
  { key: 'documents', label: 'Copies of documents', title: /^DOCUMENTS/ },
] as const;
export type AnnexKey = (typeof ANNEX_SECTIONS)[number]['key'];

/** Checks one page-layout patch; null clears a choice (the firm default applies). Throws a message on bad input. */
export function checkPageLayout(l: Record<string, unknown>): string | null {
  if (l.photo_grid != null && ![4, 6, 9].includes(Number(l.photo_grid))) return 'Photos per page: 4, 6 or 9';
  if (l.doc_grid != null && ![1, 4, 9].includes(Number(l.doc_grid))) return 'Document pages per page: 1, 4 or 9';
  if (l.evidence_per_page != null && ![1, 2].includes(Number(l.evidence_per_page))) return 'Evidence per page: 1 or 2';
  if (l.docs_at_end != null && typeof l.docs_at_end !== 'boolean') return 'Documents at the end: yes or no';
  if (l.min_photos != null && !(Number.isInteger(Number(l.min_photos)) && Number(l.min_photos) >= 1 && Number(l.min_photos) <= 30)) return 'Minimum photos: 1 to 30';
  if (l.annex_off != null && !(Array.isArray(l.annex_off) && l.annex_off.every((k) => ANNEX_SECTIONS.some((s) => s.key === k)))) return 'Unknown standard section';
  return null;
}

/** The page layout a case's report uses: the format version's own choices over the firm's Report layout. */
export async function pageLayout(firmId: number, versionId: number | null, tx: Tx = db) {
  const s = await getSettings(firmId, tx);
  const own: PageLayout = versionId
    ? json<PageLayout>((await tx.selectFrom('template_versions').select('layout_json').where('id', '=', versionId).executeTakeFirst())?.layout_json, {})
    : {};
  return {
    photo_grid: Number(own.photo_grid ?? s.photo_grid ?? 9),
    doc_grid: Number(own.doc_grid ?? s.doc_grid ?? 9),
    evidence_per_page: Number(own.evidence_per_page ?? s.evidence_per_page ?? 2),
    docs_at_end: own.docs_at_end ?? s.docs_at_end ?? true,
    min_photos: Number(own.min_photos ?? s.min_photos ?? 9),
    annex_off: (own.annex_off ?? []) as AnnexKey[],
  };
}

/** Annexure pages without the standard sections the format leaves out (by page title). */
export function keepAnnexures<T extends { title?: string }>(pages: T[], off: AnnexKey[]): T[] {
  if (!off.length) return pages;
  const drop = ANNEX_SECTIONS.filter((s) => off.includes(s.key));
  return pages.filter((p) => !drop.some((s) => s.title.test(String(p.title ?? ''))));
}
