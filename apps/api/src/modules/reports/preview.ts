// Bank formats → Preview: a format version (draft or published) rendered with one of the firm's cases, as
// the pages will be issued (no click-to-edit markers, no signature). A placeholder or "[New field: …]"
// never prints (C2): an empty field prints blank and is returned in `empty` (and listed on Checks).
// The same render feeds the on-screen preview (H1), its PDF, and Report layout's first-pages preview.
import { db } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { docxToPdf, pdfToImages } from '../../lib/pdf.js';
import { caseData } from '../casedata/resolver.js';
import { fillTemplate, templateKey, versionFieldCodes, versionTemplates } from '../templates/codes.js';
import { renderDocx } from '../templates/render.js';
import { compileVersion, versionDetail } from '../templates/service.js';
import { buildRenderData } from './data.js';

export async function previewVersion(firmId: number, templateFirmId: number | null, versionId: number, assignmentId: number, opts: { layout?: Record<string, unknown> | null; noAnnex?: boolean } = {}) {
  const { compiled } = await compileVersion(templateFirmId, versionId, db, opts.layout ?? null);
  const built = await buildRenderData(assignmentId, firmId, 'final_preview', db, versionId);
  if (opts.noAnnex) built.data.ANNEX_PAGES = [];
  const data = await caseData(assignmentId, firmId);
  // fields the AI proposes exist only once published: their default text, else blank
  const detail = await versionDetail(firmId, versionId);
  const proposed = new Map<string, any>((detail.ai?.new_fields ?? []).map((f: any) => [f.code, f]));
  const empty: string[] = [];
  for (const code of await versionFieldCodes(versionId)) {
    const f = proposed.get(code);
    if (f && !data.fields.has(code)) { built.data[code] = f.default_text ?? ''; if (!f.default_text) empty.push(f.label); }
    else if (!built.data[code] && data.fields.get(code)?.type !== 'image') empty.push(data.fields.get(code)?.label ?? code);
  }
  for (const t of await versionTemplates(versionId)) built.data[templateKey(t.key)] = fillTemplate(t.template, (c) => String(built.data[c] ?? ''));
  return { docx: renderDocx(compiled, built.data, built.images), empty };
}

/** A case to preview a format with: the given one (this firm's), else the latest case on this format, else the latest case. */
export async function previewCase(firmId: number, versionId: number, assignmentId?: number | null) {
  if (assignmentId) {
    const a = await db.selectFrom('assignments').select('id').where('id', '=', assignmentId).where('firm_id', '=', firmId).executeTakeFirst();
    if (!a) throw badRequest('Choose one of your cases to preview with');
    return a.id;
  }
  const v = await db.selectFrom('template_versions').select('template_id').where('id', '=', versionId).executeTakeFirst();
  const same = v ? await db.selectFrom('assignments as a').innerJoin('template_versions as tv', 'tv.id', 'a.template_version_id').select('a.id')
    .where('a.firm_id', '=', firmId).where('tv.template_id', '=', v.template_id).orderBy('a.id', 'desc').executeTakeFirst() : null;
  const any = same ?? await db.selectFrom('assignments').select('id').where('firm_id', '=', firmId).orderBy('id', 'desc').executeTakeFirst();
  if (!any) throw badRequest('Create a case first: the preview fills the format with a case');
  return any.id;
}

/** The first pages as small pictures (Report layout: letterhead, cover and page 2 at a glance). */
export async function firstPages(firmId: number, templateFirmId: number | null, versionId: number, assignmentId: number, layout?: Record<string, unknown> | null, pages = 2) {
  const { docx } = await previewVersion(firmId, templateFirmId, versionId, assignmentId, { layout, noAnnex: true });
  const imgs = await pdfToImages(await docxToPdf(docx), { dpi: 45, first: 1, last: pages });
  return imgs.map((b) => `data:image/jpeg;base64,${b.toString('base64')}`);
}
