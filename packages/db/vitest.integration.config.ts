import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real PostgreSQL database that has been migrated.
 *   TEST_DATABASE_URL=postgresql://... pnpm --filter @curenear/db test:int
 * They are skipped when no database is configured.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
