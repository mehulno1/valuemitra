// Applies migrations/*.sql in order and records them in schema_migrations.
// --reset drops every table in the database first (used to replace the v1 schema).
import fs from 'node:fs';
import path from 'node:path';
import { createConnection } from 'mysql2/promise';
import { env } from '../config/env.js';

const dir = path.join(env.root, 'apps/api/migrations');

export async function migrate({ reset = false } = {}) {
  const conn = await createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
    database: env.DB_NAME, multipleStatements: true, charset: 'utf8mb4',
  });
  try {
    if (reset) {
      const [rows] = await conn.query<any[]>(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?`, [env.DB_NAME]);
      if (rows.length) {
        await conn.query('SET FOREIGN_KEY_CHECKS=0');
        for (const r of rows) await conn.query(`DROP TABLE IF EXISTS \`${r.t}\``);
        await conn.query('SET FOREIGN_KEY_CHECKS=1');
        console.log(`Dropped ${rows.length} tables`);
      }
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(200) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`);
    const [done] = await conn.query<any[]>('SELECT name FROM schema_migrations');
    const applied = new Set(done.map((d) => d.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      const sqlText = fs.readFileSync(path.join(dir, f), 'utf8');
      // MySQL DDL is not transactional; each file is written to be applied once, in order.
      await conn.query(sqlText);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
      console.log(`Applied ${f}`);
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
