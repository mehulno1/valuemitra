import { z } from 'zod';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from api directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  WORKER_ID: z.string().default('worker-1'),

  // Storage
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  LOCAL_UPLOAD_PATH: z.string().default('./uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(50),

  // AWS (optional in development)
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().default('valuemitra-documents'),
  AWS_S3_TEMPLATES_PREFIX: z.string().default('templates/'),
  AWS_S3_REPORTS_PREFIX: z.string().default('reports/'),
  AWS_S3_UPLOADS_PREFIX: z.string().default('uploads/'),

  // OCR (optional in development)
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  AZURE_FORM_RECOGNIZER_ENDPOINT: z.string().optional(),
  AZURE_FORM_RECOGNIZER_KEY: z.string().optional(),

  // Google Maps (for location map in reports)
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  // Claude AI
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  // Email — AWS SES via SMTP (nodemailer)
  SES_SMTP_HOST: z.string().default('email-smtp.ap-south-1.amazonaws.com'),
  SES_SMTP_PORT: z.coerce.number().int().positive().default(587),
  SES_SMTP_USER: z.string().optional(),
  SES_SMTP_PASS: z.string().optional(),
  EMAIL_SENDER: z.string().email().default('no-response@valuemitra.com'),
  EMAIL_SENDER_NAME: z.string().default('Valuemitra'),
  EMAIL_BCC: z.string().email().optional(),

  // Report generation
  LIBREOFFICE_PATH: z.string().default('/usr/bin/libreoffice'),
  REPORT_TMP_DIR: z.string().default('/tmp/valuemitra-reports'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;
