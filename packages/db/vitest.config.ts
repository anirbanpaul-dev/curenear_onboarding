import { defineConfig } from 'vitest/config';

/** Unit tests only; database integration tests run through vitest.integration.config.ts. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
