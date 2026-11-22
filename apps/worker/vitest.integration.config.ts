import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Worker integration tests run against a real PostgreSQL database.
 *   TEST_DATABASE_URL=postgresql://... pnpm --filter @curenear/worker test:int
 * The database must be migrated first (`pnpm db:migrate`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/setup-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
