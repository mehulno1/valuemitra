import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import { ulid } from 'ulid';
import { DEFAULT_PERMISSIONS, type Permission, type Role } from '@vm/shared';
import { env } from '../config/env.js';
import { db, type Tx } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Actor } from './audit.js';
import { decrypt, encrypt, randomToken, sha256 } from './crypto.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;
export const REFRESH_COOKIE = 'vm_rt';

export interface AuthContext {
  userId: number;
  firmId: number;
  role: Role;
  name: string;
  perms: Set<Permission>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const hashPassword = (p: string) => bcrypt.hash(p, 11);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);

/** Valuers and admins must use two-factor login (configurable off for local development). */
export const needsMfa = (role: Role, totpEnabled: boolean) => totpEnabled || (env.REQUIRE_2FA && (role === 'valuer' || role === 'admin'));

export async function accessToken(u: { id: number; firm_id: number; role: string }) {
  return new SignJWT({ firm: u.firm_id, role: u.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(u.id))
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .setAudience('vm-access')
    .sign(secret);
}

/** Short-lived token proving the password step passed, used for the 2FA step. */
export async function mfaToken(userId: number) {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(userId)).setIssuedAt().setExpirationTime('10m').setAudience('vm-mfa').sign(secret);
}

export async function readMfaToken(t: string): Promise<number> {
  try {
    const { payload } = await jwtVerify(t, secret, { audience: 'vm-mfa' });
    return Number(payload.sub);
  } catch {
    throw unauthorized('The sign-in step expired. Please sign in again.');
  }
}

export async function issueRefresh(userId: number, family: string | null, req: FastifyRequest, tx: Tx = db) {
  const token = randomToken(48);
  await tx
    .insertInto('refresh_tokens')
    .values({
      user_id: userId,
      family: family ?? ulid(),
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + REFRESH_DAYS * 86400_000),
      user_agent: (req.headers['user-agent'] ?? '').slice(0, 255),
      ip: req.ip,
    })
    .execute();
  return token;
}

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_DAYS * 86400,
  });
}

/** Rotate a refresh token. Reusing an already-rotated token revokes the whole family. */
export async function rotateRefresh(token: string, req: FastifyRequest) {
  const row = await db.selectFrom('refresh_tokens').selectAll().where('token_hash', '=', sha256(token)).executeTakeFirst();
  if (!row) throw unauthorized();
  if (row.revoked_at) {
    await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('family', '=', row.family).where('revoked_at', 'is', null).execute();
    throw unauthorized('Session ended. Please sign in again.');
  }
  if (row.expires_at < new Date()) throw unauthorized('Session expired. Please sign in again.');
  await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('id', '=', row.id).execute();
  const user = await db.selectFrom('users').selectAll().where('id', '=', row.user_id).executeTakeFirst();
  if (!user || user.status !== 'active') throw unauthorized();
  const next = await issueRefresh(user.id, row.family, req);
  return { user, refresh: next, access: await accessToken(user) };
}

export async function revokeRefresh(token: string) {
  await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('token_hash', '=', sha256(token)).execute();
}

// ---- TOTP ---------------------------------------------------------------------------------

export async function startTotpEnrolment(userId: number) {
  const user = await db.selectFrom('users').select(['email']).where('id', '=', userId).executeTakeFirstOrThrow();
  const s = generateSecret();
  await db.updateTable('users').set({ totp_secret_enc: encrypt(s), totp_enabled: 0 }).where('id', '=', userId).execute();
  const uri = generateURI({ issuer: 'ValueMitra', label: user.email, secret: s });
  return { secret: s, uri, qr: await QRCode.toDataURL(uri) };
}

export async function checkTotp(userId: number, code: string): Promise<boolean> {
  const u = await db.selectFrom('users').select(['totp_secret_enc']).where('id', '=', userId).executeTakeFirst();
  if (!u?.totp_secret_enc) return false;
  const s = decrypt(Buffer.from(u.totp_secret_enc));
  const r = await verifyTotp({ secret: s, token: code.replace(/\s/g, ''), epochTolerance: 30 } as any);
  return !!r.valid;
}

// ---- request guards -----------------------------------------------------------------------

const permCache = new Map<number, { at: number; ctx: AuthContext }>();
export const invalidatePerms = (userId: number) => permCache.delete(userId);

export async function loadAuth(userId: number): Promise<AuthContext> {
  const hit = permCache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.ctx;
  const u = await db.selectFrom('users').select(['id', 'firm_id', 'role', 'name', 'status']).where('id', '=', userId).executeTakeFirst();
  if (!u || u.status !== 'active') throw unauthorized();
  const perms = await db.selectFrom('user_permissions').select('perm').where('user_id', '=', userId).execute();
  const ctx: AuthContext = {
    userId: u.id,
    firmId: u.firm_id,
    role: u.role as Role,
    name: u.name,
    perms: new Set(perms.map((p) => p.perm as Permission)),
  };
  permCache.set(userId, { at: Date.now(), ctx });
  return ctx;
}

export async function authenticate(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  try {
    const { payload } = await jwtVerify(h.slice(7), secret, { audience: 'vm-access' });
    req.auth = await loadAuth(Number(payload.sub));
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw unauthorized('Session expired');
  }
}

export function requirePerm(...perms: Permission[]) {
  return async (req: FastifyRequest) => {
    if (!req.auth) await authenticate(req);
    const a = req.auth!;
    if (a.role === 'admin' && perms.every((p) => p !== 'sign')) return; // firm admin passes all but signing
    if (!perms.every((p) => a.perms.has(p))) throw forbidden(`Needs permission: ${perms.join(', ')}`);
  };
}

export function actorOf(req: FastifyRequest): Actor {
  const a = req.auth!;
  return { type: 'user', id: a.userId, name: a.name, firmId: a.firmId, ip: req.ip };
}

export async function grantDefaultPermissions(userId: number, role: Role, tx: Tx = db) {
  const perms = DEFAULT_PERMISSIONS[role];
  if (perms.length) await tx.insertInto('user_permissions').values(perms.map((perm) => ({ user_id: userId, perm }))).execute();
}
