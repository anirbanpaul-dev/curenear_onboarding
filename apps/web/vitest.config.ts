import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/server/services/**/*.ts'],
      exclude: ['src/server/services/**/*.test.ts', 'src/server/services/index.ts'],
      // Ratchet, not the 80% target: auth/staff plus exports, analytics and
      // notifications are covered; the large onboarding/review flows still
      // need suites. Raise these as those land, never lower them.
      thresholds: {
        lines: 14,
        statements: 14,
        functions: 60,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
