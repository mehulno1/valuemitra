// Onboard a firm (Gate D: a new firm needs configuration only, no code):
//   npm run firm:create -w apps/api -- --code DVA --name "Firm name" --city Thane --state 27 \
//     --admin-name "Name" --admin-email a@b.c --admin-password '...' [--valuer-name ... --valuer-email ... --valuer-password ...]
import path from 'node:path';
import { DEFAULT_PERMISSIONS, type Role } from '@vm/shared';
import { db } from '../db/index.js';
import { hashPassword } from '../platform/auth.js';

function arg(name: string, required = true): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && !v) { console.error(`Missing --${name}`); process.exit(1); }
  return v;
}

async function user(firmId: number, role: Role, name: string, email: string, password: string) {
  if (password.length < 10) throw new Error(`Password for ${email} must be at least 10 characters`);
  const r = await db.insertInto('users').values({ firm_id: firmId, name, email: email.toLowerCase(), role, password_hash: await hashPassword(password) }).executeTakeFirstOrThrow();
  const perms = DEFAULT_PERMISSIONS[role];
  if (perms.length) await db.insertInto('user_permissions').values(perms.map((perm) => ({ user_id: Number(r.insertId), perm }))).execute();
}

export async function createFirm() {
  const code = arg('code')!.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(code)) throw new Error('Firm code: 2 to 10 capital letters or digits');
  const exists = await db.selectFrom('firms').select('id').where('code', '=', code).executeTakeFirst();
  if (exists) throw new Error(`Firm ${code} already exists`);
  const r = await db.insertInto('firms').values({
    code, name: arg('name')!, city: arg('city', false) ?? null, state_code: arg('state', false) ?? '27', address: arg('address', false) ?? null,
  }).executeTakeFirstOrThrow();
  const firmId = Number(r.insertId);
  await user(firmId, 'admin', arg('admin-name')!, arg('admin-email')!, arg('admin-password')!);
  if (arg('valuer-email', false)) await user(firmId, 'valuer', arg('valuer-name')!, arg('valuer-email')!, arg('valuer-password')!);
  console.log(`Firm ${code} created (id ${firmId}). Next: sign in as the admin, add branches, engineers, the valuer's registration, signature and seal in Firm settings.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  createFirm().then(() => db.destroy()).catch((e) => { console.error(e.message); process.exit(1); });
}
