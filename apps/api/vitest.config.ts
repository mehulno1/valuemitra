import path from 'node:path';
import { defineConfig } from 'vitest/config';

try { process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env')); } catch { /* CI provides env */ }

export default defineConfig({
  resolve: { alias: { '@vm/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts') } },
  test: { include: ['test/**/*.test.ts'] },
});
