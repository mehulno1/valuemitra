import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { unauthorized } from '../lib/errors.js';
import { audit } from '../platform/audit.js';
import {
  accessToken, authenticate, checkPassword, checkTotp, issueRefresh, mfaToken, needsMfa, readMfaToken, REFRESH_COOKIE,
  revokeRefresh, rotateRefresh, setRefreshCookie, startTotpEnrolment,
} from '../platform/auth.js';
import { flagsFor } from '../platform/settings.js';
import { body } from './util.js';

async function session(userId: number) {
  const u = await db.selectFrom('users as u').innerJoin('firms as f', 'f.id', 'u.firm_id')
    .select(['u.id', 'u.name', 'u.email', 'u.role', 'u.firm_id', 'u.totp_enabled', 'f.name as firm_name', 'f.code as firm_code'])
    .where('u.id', '=', userId).executeTakeFirstOrThrow();
  const perms = await db.selectFrom('user_permissions').select('perm').where('user_id', '=', userId).execute();
  return { user: { ...u, totp_enabled: !!u.totp_enabled, perms: perms.map((p) => p.perm) }, flags: await flagsFor(u.firm_id) };
}

export async function authRoutes(app: FastifyInstance) {
  const finish = async (req: any, reply: any, userId: number) => {
    const u = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
    await db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', userId).execute();
    setRefreshCookie(reply, await issueRefresh(userId, null, req));
    await audit({ type: 'user', id: u.id, name: u.name, firmId: u.firm_id, ip: req.ip }, { entityType: 'user', entityId: u.id, action: 'auth.login', summary: `${u.name} signed in` });
    return { accessToken: await accessToken(u), ...(await session(userId)) };
  };

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = body(req, z.object({ email: z.string(), password: z.string() }));
    const u = await db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase().trim()).executeTakeFirst();
    if (!u || u.status !== 'active' || !(await checkPassword(password, u.password_hash))) throw unauthorized('Email or password is not right');
    if (needsMfa(u.role as any, !!u.totp_enabled)) {
      return { mfa: u.totp_enabled ? 'verify' : 'enroll', mfaToken: await mfaToken(u.id) };
    }
    return finish(req, reply, u.id);
  });

  app.post('/api/auth/mfa/enroll', async (req) => {
    const { mfaToken: t } = body(req, z.object({ mfaToken: z.string() }));
    const userId = await readMfaToken(t);
    const u = await db.selectFrom('users').select('totp_enabled').where('id', '=', userId).executeTakeFirstOrThrow();
    if (u.totp_enabled) throw unauthorized('Two-factor login is already set up');
    const { qr, secret } = await startTotpEnrolment(userId);
    return { qr, secret };
  });

  app.post('/api/auth/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { mfaToken: t, code } = body(req, z.object({ mfaToken: z.string(), code: z.string().min(6) }));
    const userId = await readMfaToken(t);
    if (!(await checkTotp(userId, code))) throw unauthorized('That code is not right. Use the current 6-digit code from your authenticator app.');
    await db.updateTable('users').set({ totp_enabled: 1 }).where('id', '=', userId).execute();
    return finish(req, reply, userId);
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const t = (req.cookies as any)?.[REFRESH_COOKIE];
    if (!t) throw unauthorized();
    const r = await rotateRefresh(t, req);
    setRefreshCookie(reply, r.refresh);
    return { accessToken: r.access, ...(await session(r.user.id)) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = (req.cookies as any)?.[REFRESH_COOKIE];
    if (t) await revokeRefresh(t);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (req) => session(req.auth!.userId));
}
