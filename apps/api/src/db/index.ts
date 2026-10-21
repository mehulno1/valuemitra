import { Kysely, MysqlDialect, sql, type Transaction } from 'kysely';
import { createPool } from 'mysql2';
import { env } from '../config/env.js';
import type { DB } from './types.js';

export const pool = createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  charset: 'utf8mb4',
});

export const db = new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });

export type Tx = Kysely<DB> | Transaction<DB>;
export { sql };

/** MySQL JSON columns come back parsed from mysql2; strings are parsed defensively. */
export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

export const toJson = (v: unknown) => JSON.stringify(v ?? null);
