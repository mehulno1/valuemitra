// MySQL-backed job queue with retry and exponential back-off. Workers claim jobs with
// SELECT ... FOR UPDATE SKIP LOCKED so several API processes can share the queue.
import { env } from '../config/env.js';
import { db, json, sql, toJson, type Tx } from '../db/index.js';

type Handler = (payload: any, job: { id: number; attempts: number; firmId: number | null }) => Promise<unknown>;
const handlers = new Map<string, Handler>();

export function registerJob(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { firmId?: number | null; delayMs?: number; dedupeKey?: string; maxAttempts?: number } = {},
  tx: Tx = db,
) {
  if (opts.dedupeKey) {
    const existing = await tx
      .selectFrom('jobs')
      .select('id')
      .where('dedupe_key', '=', opts.dedupeKey)
      .where('status', 'in', ['queued', 'running'])
      .executeTakeFirst();
    if (existing) return existing.id;
  }
  const r = await tx
    .insertInto('jobs')
    .values({
      firm_id: opts.firmId ?? null,
      type,
      payload_json: toJson(payload),
      run_after: new Date(Date.now() + (opts.delayMs ?? 0)),
      dedupe_key: opts.dedupeKey ?? null,
      max_attempts: opts.maxAttempts ?? 4,
    })
    .executeTakeFirstOrThrow();
  setImmediate(() => void tick());
  return Number(r.insertId);
}

let running = 0;
const CONCURRENCY = 3;

async function claim() {
  return db.transaction().execute(async (tx) => {
    const row = await sql<{ id: number }>`
      SELECT id FROM jobs WHERE status = 'queued' AND run_after <= NOW(3)
      ORDER BY run_after, id LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(tx);
    const id = row.rows[0]?.id;
    if (!id) return null;
    await tx
      .updateTable('jobs')
      .set({ status: 'running', locked_at: new Date(), locked_by: env.WORKER_ID, attempts: sql`attempts + 1` })
      .where('id', '=', id)
      .execute();
    return tx.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });
}

async function runOne(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    const result = await h(json(job.payload_json, {}), { id: job.id, attempts: job.attempts, firmId: job.firm_id });
    await db
      .updateTable('jobs')
      .set({ status: 'done', finished_at: new Date(), result_json: toJson(result ?? null), last_error: null })
      .where('id', '=', job.id)
      .execute();
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    const final = job.attempts >= job.max_attempts;
    console.error(`[job ${job.type}#${job.id}] attempt ${job.attempts} failed:`, err instanceof Error ? err.message : err);
    await db
      .updateTable('jobs')
      .set({
        status: final ? 'failed' : 'queued',
        last_error: msg.slice(0, 60000),
        run_after: new Date(Date.now() + Math.min(2 ** job.attempts * 5000, 10 * 60_000)),
        finished_at: final ? new Date() : null,
      })
      .where('id', '=', job.id)
      .execute();
    if (final) onFailure.forEach((f) => f(job.type, json(job.payload_json, {}), msg));
  }
  return true;
}

const onFailure: Array<(type: string, payload: any, error: string) => void> = [];
export const onJobFailed = (f: (type: string, payload: any, error: string) => void) => onFailure.push(f);

export async function tick() {
  if (!env.RUN_JOBS) return;
  if (running >= CONCURRENCY) return;
  running++;
  runOne()
    .then((did) => { running--; if (did) void tick(); })
    .catch((e) => { running--; console.error('[jobs] worker error', e); });
}

let timer: NodeJS.Timeout | null = null;
export async function startWorker() {
  if (!env.RUN_JOBS || timer) return;
  // recover jobs left running by a crashed process
  await db
    .updateTable('jobs')
    .set({ status: 'queued', locked_at: null })
    .where('status', '=', 'running')
    .where('locked_at', '<', new Date(Date.now() - 15 * 60_000))
    .execute();
  timer = setInterval(() => { for (let i = 0; i < CONCURRENCY; i++) void tick(); }, 1500);
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
