import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@vm/shared';
import { db } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { actorOf, authenticate, requirePerm } from '../platform/auth.js';
import { configById, discardDraft, listConfig, publishConfig, saveDraft, type ConfigKind } from '../platform/config.js';
import { FEATURE_FLAGS, flagsFor } from '../platform/settings.js';
import { audit } from '../platform/audit.js';
import * as firm from '../modules/firm/service.js';
import { dictionary, fieldHistory, saveField } from '../modules/master/dictionary.js';
import * as tpl from '../modules/templates/service.js';
import { buildRenderData } from '../modules/reports/data.js';
import { renderDocx } from '../modules/templates/render.js';
import { body, idParam, multipartFiles } from './util.js';

const KINDS: ConfigKind[] = ['profile', 'rule_set', 'check_set', 'wording', 'doc_types'];

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...rest] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- reference lists any signed-in user needs ----
  app.get('/api/meta', async (req) => ({
    banks: await firm.banks(),
    branches: await firm.branches(req.auth!.firmId),
    engineers: await firm.engineers(req.auth!.firmId),
    flags: await flagsFor(req.auth!.firmId),
  }));

  // ---- firm settings ----
  app.get('/api/firm', async (req) => firm.firmProfile(req.auth!.firmId));
  app.patch('/api/firm', { preHandler: requirePerm('set') }, async (req) => { await firm.updateFirm(actorOf(req), req.body as any); return firm.firmProfile(req.auth!.firmId); });
  app.post('/api/firm/branding/:kind', { preHandler: requirePerm('set') }, async (req) => {
    const kind = (req.params as any).kind;
    if (!['letterhead', 'signature', 'seal'].includes(kind)) throw badRequest('Unknown upload');
    const { files } = await multipartFiles(req);
    return { fileId: await firm.uploadBranding(actorOf(req), kind, files[0] ?? null) };
  });
  app.delete('/api/firm/branding/:kind', { preHandler: requirePerm('set') }, async (req) => ({ fileId: await firm.uploadBranding(actorOf(req), (req.params as any).kind, null) }));
  app.put('/api/firm/flags/:flag', { preHandler: requirePerm('set') }, async (req) => {
    const flag = (req.params as any).flag;
    if (!(flag in FEATURE_FLAGS)) throw badRequest('Unknown feature');
    const { enabled } = body(req, z.object({ enabled: z.boolean() }));
    await db.insertInto('feature_flags').values({ firm_id: req.auth!.firmId, flag, enabled: enabled ? 1 : 0, updated_by: req.auth!.userId }).onDuplicateKeyUpdate({ enabled: enabled ? 1 : 0, updated_by: req.auth!.userId }).execute();
    await audit(actorOf(req), { entityType: 'flag', entityId: flag, action: 'flag.set', summary: `${FEATURE_FLAGS[flag as keyof typeof FEATURE_FLAGS]} ${enabled ? 'on' : 'off'}` });
    return flagsFor(req.auth!.firmId);
  });

  // ---- users ----
  app.get('/api/users', async (req) => firm.listUsers(req.auth!.firmId));
  app.post('/api/users', { preHandler: requirePerm('set') }, async (req) => {
    const b = body(req, z.object({ name: z.string(), email: z.string(), role: z.enum(ROLES), password: z.string(), phone: z.string().nullish() }));
    return { id: await firm.addUser(actorOf(req), b) };
  });
  app.put('/api/users/:id/permissions/:perm', { preHandler: requirePerm('set') }, async (req) => {
    const { on } = body(req, z.object({ on: z.boolean() }));
    await firm.setPermission(actorOf(req), idParam(req), (req.params as any).perm, on);
    return firm.listUsers(req.auth!.firmId);
  });
  app.put('/api/users/:id/status', { preHandler: requirePerm('set') }, async (req) => {
    const { status } = body(req, z.object({ status: z.enum(['active', 'disabled']) }));
    await firm.setUserStatus(actorOf(req), idParam(req), status);
    return { ok: true };
  });

  // ---- banks, branches, engineers ----
  app.post('/api/branches', { preHandler: requirePerm('set') }, async (req) => { await firm.saveBranch(actorOf(req), req.body); return firm.branches(req.auth!.firmId); });
  app.post('/api/engineers', { preHandler: requirePerm('set') }, async (req) => { await firm.saveEngineer(actorOf(req), req.body as any); return firm.engineers(req.auth!.firmId); });

  // ---- ready reckoner import ----
  app.post('/api/ready-reckoner/import', { preHandler: requirePerm('set') }, async (req) => {
    const { files, fields } = await multipartFiles(req);
    if (!files[0]) throw badRequest('Choose a CSV file');
    return firm.importReadyReckoner(actorOf(req), parseCsv(files[0].buffer.toString('utf8')), fields.preview === 'true');
  });
  app.get('/api/ready-reckoner', async (req) => db.selectFrom('ready_reckoner_rates').selectAll().where((eb) => eb.or([eb('firm_id', 'is', null), eb('firm_id', '=', req.auth!.firmId)])).orderBy('year_label', 'desc').orderBy('village').limit(500).execute());

  // ---- privacy ----
  app.get('/api/privacy/search', async (req) => firm.findBorrower(req.auth!.firmId, (req.query as any).q));
  app.get('/api/privacy/requests', async (req) => firm.privacyRequests(req.auth!.firmId));
  app.post('/api/privacy/:id/delete', { preHandler: requirePerm('set') }, async (req) => {
    const { requestedBy } = body(req, z.object({ requestedBy: z.string().min(2) }));
    await firm.deletePersonalData(actorOf(req), idParam(req), requestedBy);
    return { ok: true };
  });
  app.post('/api/privacy/:id/export', { preHandler: requirePerm('exp') }, async (req) => {
    const { requestedBy } = body(req, z.object({ requestedBy: z.string().min(2) }));
    return firm.exportPersonalData(actorOf(req), idParam(req), requestedBy);
  });

  // ---- master data: canonical dictionary ----
  app.get('/api/admin/fields', async (req) => [...(await dictionary(req.auth!.firmId)).values()].sort((a, b) => a.group.localeCompare(b.group) || a.sort - b.sort));
  app.get('/api/admin/fields/:code/history', async (req) => fieldHistory(req.auth!.firmId, (req.params as any).code));
  app.post('/api/admin/fields', { preHandler: requirePerm('config') }, async (req) => saveField(actorOf(req), req.body as any));

  // ---- versioned configuration ----
  app.get('/api/admin/config/:kind', async (req) => {
    const kind = (req.params as any).kind as ConfigKind;
    if (!KINDS.includes(kind)) throw badRequest('Unknown configuration');
    return listConfig(kind, req.auth!.firmId, (req.query as any).key);
  });
  app.get('/api/admin/config/version/:id', async (req) => configById(idParam(req)));
  app.put('/api/admin/config/:kind/:key', { preHandler: requirePerm('config') }, async (req) => {
    const kind = (req.params as any).kind as ConfigKind;
    if (!KINDS.includes(kind)) throw badRequest('Unknown configuration');
    const b = body(req, z.object({ payload: z.any(), note: z.string().nullish() }));
    return saveDraft(actorOf(req), kind, (req.params as any).key, b.payload, b.note ?? null);
  });
  app.post('/api/admin/config/version/:id/publish', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ effectiveFrom: z.string().nullish() }));
    return publishConfig(actorOf(req), idParam(req), b.effectiveFrom ? new Date(b.effectiveFrom) : null);
  });
  app.delete('/api/admin/config/version/:id', { preHandler: requirePerm('config') }, async (req) => { await discardDraft(actorOf(req), idParam(req)); return { ok: true }; });

  // ---- template engine ----
  app.get('/api/templates', async (req) => tpl.listTemplates(req.auth!.firmId));
  app.post('/api/templates/upload', { preHandler: requirePerm('config') }, async (req) => {
    const { files, fields } = await multipartFiles(req);
    const f = files[0];
    if (!f || !/\.docx$/i.test(f.name)) throw badRequest('Upload the bank template as a .docx Word file (save .doc files as .docx first)');
    return db.transaction().execute((tx) => tpl.uploadTemplate(actorOf(req), {
      templateId: fields.templateId ? Number(fields.templateId) : undefined, bankCode: fields.bankCode || undefined, name: fields.name || undefined,
      propertyTypes: fields.propertyTypes ? fields.propertyTypes.split(',') : undefined, branchScope: fields.branchScope ? fields.branchScope.split(',') : undefined,
      fileName: f.name, buffer: f.buffer, effectiveFrom: fields.effectiveFrom || null, note: fields.note || null,
    }, tx));
  });
  app.get('/api/templates/versions/:id', async (req) => tpl.versionDetail(req.auth!.firmId, idParam(req)));
  app.patch('/api/templates/versions/:id/mappings/:mid', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ fieldCode: z.string().nullish(), ignore: z.boolean().optional(), newField: z.any().optional() }));
    await db.transaction().execute((tx) => tpl.confirmMapping(actorOf(req), idParam(req), idParam(req, 'mid'), b, tx));
    return tpl.versionDetail(req.auth!.firmId, idParam(req));
  });
  app.patch('/api/templates/versions/:id/layout', { preHandler: requirePerm('config') }, async (req) => { await tpl.setLayout(actorOf(req), idParam(req), req.body as any); return { ok: true }; });
  app.post('/api/templates/versions/:id/publish', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ effectiveFrom: z.string().nullish() }));
    await db.transaction().execute((tx) => tpl.publishVersion(actorOf(req), idParam(req), b.effectiveFrom ?? null, tx));
    return { ok: true };
  });
  app.delete('/api/templates/versions/:id', { preHandler: requirePerm('config') }, async (req) => { await tpl.discardDraftVersion(actorOf(req), idParam(req)); return { ok: true }; });
  /** Preview: render a version (draft or published) against a past case of this firm. */
  app.get('/api/templates/versions/:id/preview', async (req, reply) => {
    const assignmentId = Number((req.query as any).assignmentId);
    const a = await db.selectFrom('assignments').select(['id']).where('id', '=', assignmentId).where('firm_id', '=', req.auth!.firmId).executeTakeFirst();
    if (!a) throw badRequest('Choose one of your cases to preview with');
    const v = await db.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['t.firm_id']).where('v.id', '=', idParam(req)).executeTakeFirstOrThrow();
    const { compiled } = await tpl.compileVersion(v.firm_id, idParam(req));
    // render with this version's mapping: temporarily treat it as the case's template
    const built = await buildRenderData(assignmentId, req.auth!.firmId, 'preview', db);
    const maps = await db.selectFrom('template_mappings').select('field_code').distinct().where('template_version_id', '=', idParam(req)).where('field_code', 'is not', null).execute();
    const { caseData } = await import('../modules/casedata/resolver.js');
    const data = await caseData(assignmentId, req.auth!.firmId);
    for (const m of maps) if (!(m.field_code! in built.data)) built.data[m.field_code!] = data.get(m.field_code!).display ?? '';
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return reply.send(renderDocx(compiled, built.data, built.images));
  });

  // ---- in-product feedback (comments on any screen or field) ----
  app.post('/api/feedback', async (req) => {
    const b = body(req, z.object({ screen: z.string(), target: z.string().nullish(), kind: z.enum(['bug', 'wording', 'idea']), body: z.string().min(3) }));
    await db.insertInto('product_feedback').values({ firm_id: req.auth!.firmId, user_id: req.auth!.userId, screen: b.screen, target: b.target ?? null, kind: b.kind, body: b.body }).execute();
    return { ok: true };
  });
  app.get('/api/feedback', { preHandler: requirePerm('config') }, async (req) => db.selectFrom('product_feedback as f').innerJoin('users as u', 'u.id', 'f.user_id').selectAll('f').select('u.name').where('f.firm_id', '=', req.auth!.firmId).orderBy('f.id', 'desc').limit(200).execute());

  // ---- audit trail (firm-wide) ----
  app.get('/api/audit', { preHandler: requirePerm('set') }, async (req) => db.selectFrom('audit_log').selectAll().where('firm_id', '=', req.auth!.firmId).orderBy('id', 'desc').limit(300).execute());
}
