// File storage. Every file belongs to a firm and lives under storage/<firmId>/...; access always
// checks the firm. The interface is kept small so an S3 adapter can replace the local one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { db, type Tx } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { sha256 } from './crypto.js';

export interface StoredFile {
  id: number;
  firm_id: number | null;
  storage_key: string;
  original_name: string | null;
  mime: string;
  size_bytes: number;
  sha256: string;
  purpose: string;
}

const EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'text/csv': '.csv',
  'application/json': '.json',
};

const abs = (key: string) => {
  const p = path.resolve(env.STORAGE_DIR, key);
  if (!p.startsWith(path.resolve(env.STORAGE_DIR) + path.sep)) throw new Error('Invalid storage key');
  return p;
};

export async function saveFile(
  opts: { firmId: number | null; purpose: string; buffer: Buffer; name?: string | null; mime: string; userId?: number | null; isKyc?: boolean; folder?: string },
  tx: Tx = db,
): Promise<StoredFile> {
  const ext = EXT[opts.mime] ?? (opts.name ? path.extname(opts.name).toLowerCase() : '') ?? '';
  const key = [opts.firmId ?? 'platform', opts.folder ?? opts.purpose, `${ulid()}${ext}`].join('/');
  const p = abs(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, opts.buffer);
  const row = {
    firm_id: opts.firmId,
    storage_key: key,
    original_name: opts.name ?? null,
    mime: opts.mime,
    size_bytes: opts.buffer.length,
    sha256: sha256(opts.buffer),
    purpose: opts.purpose,
    is_kyc: opts.isKyc ? 1 : 0,
    created_by: opts.userId ?? null,
  };
  const r = await tx.insertInto('files').values(row).executeTakeFirstOrThrow();
  return { id: Number(r.insertId), ...row };
}

export async function getFile(id: number, firmId: number | null, tx: Tx = db): Promise<StoredFile> {
  const f = await tx.selectFrom('files').selectAll().where('id', '=', id).executeTakeFirst();
  if (!f || f.purged_at) throw notFound('File');
  // platform files (firm_id NULL) are readable by every firm; firm files only by their firm
  if (f.firm_id !== null && f.firm_id !== firmId) throw notFound('File');
  return f as StoredFile;
}

export async function readFile(id: number, firmId: number | null, tx: Tx = db): Promise<{ file: StoredFile; buffer: Buffer }> {
  const file = await getFile(id, firmId, tx);
  return { file, buffer: await fs.readFile(abs(file.storage_key)) };
}

export const filePath = (f: StoredFile) => abs(f.storage_key);

/** Delete the bytes, keep the row (with purged_at) for the audit trail. */
export async function purgeFile(id: number, tx: Tx = db) {
  const f = await tx.selectFrom('files').select(['storage_key']).where('id', '=', id).executeTakeFirst();
  if (!f) return;
  await fs.rm(abs(f.storage_key), { force: true });
  await tx.updateTable('files').set({ purged_at: new Date() }).where('id', '=', id).execute();
}
