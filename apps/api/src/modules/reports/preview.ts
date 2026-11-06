// Bank formats → Preview: a format version (draft or published) rendered with one of the firm's cases, as
// the pages will be issued (no click-to-edit markers, no signature). A placeholder or "[New field: …]"
// never prints (C2): an empty field prints blank and is returned in `empty` (and listed on Checks).
import { db } from '../../db/index.js';
import { caseData } from '../casedata/resolver.js';
import { fillTemplate, templateKey, versionFieldCodes, versionTemplates } from '../templates/codes.js';
import { renderDocx } from '../templates/render.js';
import { compileVersion, versionDetail } from '../templates/service.js';
import { buildRenderData } from './data.js';

export async function previewVersion(firmId: number, templateFirmId: number | null, versionId: number, assignmentId: number) {
  const { compiled } = await compileVersion(templateFirmId, versionId);
  const built = await buildRenderData(assignmentId, firmId, 'final_preview', db, versionId);
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
