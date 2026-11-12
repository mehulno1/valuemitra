import { previewVersion } from '../modules/reports/preview.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@vm/shared';
import { db } from '../db/index.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { actorOf, authenticate, requirePerm } from '../platform/auth.js';
import { configById, discardDraft, listConfig, publishConfig, saveDraft, type ConfigKind } from '../platform/config.js';
import { FEATURE_FLAGS, flagsFor, getSettings } from '../platform/settings.js';
import { audit } from '../platform/audit.js';
import * as firm from '../modules/firm/service.js';
import { dictionary, fieldHistory, saveField } from '../modules/master/dictionary.js';
import * as tpl from '../modules/templates/service.js';
import { fillTemplate, templateKey, versionFieldCodes, versionTemplates } from '../modules/templates/codes.js';
import { buildRenderData } from '../modules/reports/data.js';
import { renderDocx } from '../modules/templates/render.js';
import { body, idParam, multipartFiles } from './util.js';
import { requireKind } from '../lib/sniff.js';
import { parseCsv } from './csv.js';

const KINDS: ConfigKind[] = ['profile', 'rule_set', 'check_set', 'wording', 'doc_types'];

/** Valuation rules live in Firm settings (permission "set"); other configuration needs "config". */
const configPerm = (kind: string) => async (req: any) => {
  if (!req.auth) await authenticate(req);
  const a = req.auth;
  const ok = a.role === 'admin' || a.perms.has('config') || (kind === 'rule_set' && a.perms.has('set'));
  if (!ok) throw forbidden(`Needs permission: ${kind === 'rule_set' ? 'set or config' : 'config'}`);
};

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- reference lists any signed-in user needs ----
  app.get('/api/meta', async (req) => ({
    banks: await firm.banks(),
    branches: await firm.branches(req.auth!.firmId),
    engineers: await firm.engineers(req.auth!.firmId),
    flags: await flagsFor(req.auth!.firmId),
    // people a case can be assigned to (report maker / checker dropdowns)
    workflow: { skipUnassigned: (await getSettings(req.auth!.firmId)).skip_unassigned_steps !== false },
    team: await db.selectFrom('users').select(['id', 'name', 'role']).where('firm_id', '=', req.auth!.firmId).where('status', '=', 'active').where('role', 'in', ['maker', 'checker', 'valuer', 'coordinator', 'coord_accounts']).orderBy('name').execute(),
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
  app.put('/api/users/:id/role', { preHandler: requirePerm('set') }, async (req) => {
    const b = body(req, z.object({ role: z.string() }));
    await firm.setUserRole(actorOf(req), idParam(req), b.role as any);
    return { ok: true };
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
  app.get('/api/admin/fields/usage', async (req) => tpl.fieldUsage(req.auth!.firmId));
  app.get('/api/admin/fields/:code/history', async (req) => fieldHistory(req.auth!.firmId, (req.params as any).code));
  app.post('/api/admin/fields', { preHandler: requirePerm('config') }, async (req) => saveField(actorOf(req), req.body as any));

  // ---- versioned configuration ----
  app.get('/api/admin/config/:kind', async (req) => {
    const kind = (req.params as any).kind as ConfigKind;
    if (!KINDS.includes(kind)) throw badRequest('Unknown configuration');
    return listConfig(kind, req.auth!.firmId, (req.query as any).key);
  });
  app.get('/api/admin/config/version/:id', async (req) => {
    const v = await configById(idParam(req));
    if (v.firm_id !== null && v.firm_id !== req.auth!.firmId) throw badRequest('Not found');
    return v;
  });
  app.put('/api/admin/config/:kind/:key', async (req) => {
    const kind = (req.params as any).kind as ConfigKind;
    if (!KINDS.includes(kind)) throw badRequest('Unknown configuration');
    await configPerm(kind)(req);
    const b = body(req, z.object({ payload: z.any(), note: z.string().nullish() }));
    return saveDraft(actorOf(req), kind, (req.params as any).key, b.payload, b.note ?? null);
  });
  app.post('/api/admin/config/version/:id/publish', async (req) => {
    await configPerm((await configById(idParam(req))).kind)(req);
    const b = body(req, z.object({ effectiveFrom: z.string().nullish() }));
    return publishConfig(actorOf(req), idParam(req), b.effectiveFrom ? new Date(b.effectiveFrom) : null);
  });
  app.delete('/api/admin/config/version/:id', async (req) => {
    await configPerm((await configById(idParam(req))).kind)(req);
    await discardDraft(actorOf(req), idParam(req));
    return { ok: true };
  });

  // ---- template engine ----
  app.get('/api/templates', async (req) => tpl.listTemplates(req.auth!.firmId));
  app.post('/api/templates/upload', { preHandler: requirePerm('config') }, async (req) => {
    const { files, fields } = await multipartFiles(req);
    const f = files[0];
    if (!f) throw badRequest('Choose the bank template file');
    requireKind(f.buffer, ['docx'], f.name.replace(/\.doc$/i, '.doc (save it as .docx first)'));
    return db.transaction().execute((tx) => tpl.uploadTemplate(actorOf(req), {
      templateId: fields.templateId ? Number(fields.templateId) : undefined, bankCode: fields.bankCode || undefined, name: fields.name || undefined,
      propertyTypes: fields.propertyTypes ? fields.propertyTypes.split(',') : undefined, branchScope: fields.branchScope ? fields.branchScope.split(',') : undefined,
      fileName: f.name, buffer: f.buffer, effectiveFrom: fields.effectiveFrom || null, note: fields.note || null, ai: fields.ai !== 'false',
    }, tx));
  });
  app.get('/api/templates/versions/:id', async (req) => tpl.versionDetail(req.auth!.firmId, idParam(req)));
  app.patch('/api/templates/versions/:id/mappings/:mid', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ fieldCode: z.string().nullish(), ignore: z.boolean().optional(), newField: z.any().optional() }));
    await db.transaction().execute((tx) => tpl.confirmMapping(actorOf(req), idParam(req), idParam(req, 'mid'), b, tx));
    return tpl.versionDetail(req.auth!.firmId, idParam(req));
  });
  app.post('/api/templates/versions/:id/accept-ready', { preHandler: requirePerm('config') }, async (req) => {
    const n = await db.transaction().execute((tx) => tpl.acceptReady(actorOf(req), idParam(req), tx));
    return { accepted: n, version: await tpl.versionDetail(req.auth!.firmId, idParam(req)) };
  });
  app.post('/api/templates/versions/:id/mappings/:mid/answer', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ option: z.number().int().min(0) }));
    await db.transaction().execute((tx) => tpl.answerMapping(actorOf(req), idParam(req), idParam(req, 'mid'), b.option, tx));
    return tpl.versionDetail(req.auth!.firmId, idParam(req));
  });
  /** Read the draft with the AI again (after a failure, or to start over). */
  app.post('/api/templates/versions/:id/ai', { preHandler: requirePerm('config') }, async (req) => {
    await tpl.rerunAi(actorOf(req), idParam(req));
    return { ok: true };
  });
  app.put('/api/templates/:id/hidden', { preHandler: requirePerm('config') }, async (req) => { await tpl.setTemplateHidden(actorOf(req), idParam(req), !!(req.body as any)?.hidden); return { ok: true }; });
  app.patch('/api/templates/versions/:id/layout', { preHandler: requirePerm('config') }, async (req) => { await tpl.setLayout(actorOf(req), idParam(req), req.body as any); return { ok: true }; });
  app.patch('/api/templates/:id/rules', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.record(z.string(), z.number().nullable()));
    return db.transaction().execute((tx) => tpl.setFormatRules(actorOf(req), idParam(req), b, tx));
  });
  app.get('/api/templates/versions/:id/fixed-numbers', { preHandler: requirePerm('config') }, async (req) => {
    const v = await db.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['t.firm_id']).where('v.id', '=', idParam(req)).executeTakeFirst();
    if (!v || (v.firm_id !== null && v.firm_id !== req.auth!.firmId)) throw badRequest('Template version not found');
    return tpl.fixedNumberList(v.firm_id, idParam(req));
  });
  app.post('/api/templates/versions/:id/fixed-numbers', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ values: z.array(z.string().max(80)).min(1).max(200) }));
    await db.transaction().execute((tx) => tpl.keepFixedNumbers(actorOf(req), idParam(req), b.values, tx));
    return { ok: true };
  });
  app.post('/api/templates/versions/:id/publish', { preHandler: requirePerm('config') }, async (req) => {
    const b = body(req, z.object({ effectiveFrom: z.string().nullish() }));
    await db.transaction().execute((tx) => tpl.publishVersion(actorOf(req), idParam(req), b.effectiveFrom ?? null, tx));
    return { ok: true };
  });
  app.delete('/api/templates/versions/:id', { preHandler: requirePerm('config') }, async (req) => { await tpl.discardDraftVersion(actorOf(req), idParam(req)); return { ok: true }; });
  /** Preview: render a version (draft or published) against a past case of this firm. */
  app.get('/api/templates/versions/:id/preview', { preHandler: requirePerm('config') }, async (req, reply) => {
    const assignmentId = Number((req.query as any).assignmentId);
    const a = await db.selectFrom('assignments').select(['id']).where('id', '=', assignmentId).where('firm_id', '=', req.auth!.firmId).executeTakeFirst();
    if (!a) throw badRequest('Choose one of your cases to preview with');
    const v = await db.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['t.firm_id']).where('v.id', '=', idParam(req)).executeTakeFirst();
    if (!v || (v.firm_id !== null && v.firm_id !== req.auth!.firmId)) throw badRequest('Template version not found');
    const { docx, empty } = await previewVersion(req.auth!.firmId, v.firm_id, idParam(req), assignmentId);
    reply.header('X-Empty-Fields', encodeURIComponent(empty.join('; ')).slice(0, 4000));
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return reply.send(docx);
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
