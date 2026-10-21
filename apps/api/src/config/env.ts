import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3010),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:3010'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  JWT_SECRET: z.string().min(32),
  LINK_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64),
  REQUIRE_2FA: z.string().default('true').transform((v) => v === 'true'),
  STORAGE_DIR: z.string().default('./storage'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  SOFFICE_PATH: z.string().default('soffice'),
  PDFTOPPM_PATH: z.string().default('pdftoppm'),
  WORKER_ID: z.string().default(`w${process.pid}`),
  RUN_JOBS: z.string().default('true').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}

// Relative paths in .env are relative to the repo root (where .env lives). Walk up to the
// workspace root so this works both from src/ (tsx) and from the bundled dist/.
function findRoot(start: string): string {
  let d = start;
  for (;;) {
    const pj = path.join(d, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).workspaces) return d;
    const up = path.dirname(d);
    if (up === d) return process.cwd();
    d = up;
  }
}
const root = findRoot(import.meta.dirname);
const abs = (p: string | undefined) => (p ? (path.isAbsolute(p) ? p : path.resolve(root, p)) : p);

export const env = {
  ...parsed.data,
  STORAGE_DIR: abs(parsed.data.STORAGE_DIR)!,
  GOOGLE_APPLICATION_CREDENTIALS: abs(parsed.data.GOOGLE_APPLICATION_CREDENTIALS),
  isProd: parsed.data.NODE_ENV === 'production',
  root,
};
