// Gap-free counters. Must be called inside the transaction that uses the number, so a rollback
// returns it.
import { sql, type Tx } from '../db/index.js';

export async function nextNumber(tx: Tx, firmId: number, series: string, fy: string): Promise<number> {
  await sql`INSERT IGNORE INTO sequences (firm_id, series, fy, last_no) VALUES (${firmId}, ${series}, ${fy}, 0)`.execute(tx);
  const row = await sql<{ last_no: number }>`
    SELECT last_no FROM sequences WHERE firm_id = ${firmId} AND series = ${series} AND fy = ${fy} FOR UPDATE`.execute(tx);
  const n = (row.rows[0]?.last_no ?? 0) + 1;
  await tx
    .updateTable('sequences')
    .set({ last_no: n })
    .where('firm_id', '=', firmId)
    .where('series', '=', series)
    .where('fy', '=', fy)
    .execute();
  return n;
}

export async function peekNumber(tx: Tx, firmId: number, series: string, fy: string): Promise<number> {
  const r = await tx
    .selectFrom('sequences')
    .select('last_no')
    .where('firm_id', '=', firmId)
    .where('series', '=', series)
    .where('fy', '=', fy)
    .executeTakeFirst();
  return (r?.last_no ?? 0) + 1;
}

/** Firm settings "continue your current series": the next number issued will be `next`. */
export async function setNext(tx: Tx, firmId: number, series: string, fy: string, next: number) {
  await sql`INSERT INTO sequences (firm_id, series, fy, last_no) VALUES (${firmId}, ${series}, ${fy}, ${next - 1})
            ON DUPLICATE KEY UPDATE last_no = ${next - 1}`.execute(tx);
}
