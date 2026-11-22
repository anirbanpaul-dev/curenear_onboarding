import { defineConfig } from 'vitest/config';

/**
 * `packages/shared` is pure domain code: every exported schema, state machine
 * and policy helper is unit-tested here. Coverage is measured over `src` and
 * gated at 80% so a new branch needs a test before it lands.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
