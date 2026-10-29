import { defineConfig } from 'vitest/config';

// Browser smoke test: loads the built extension (dist/chrome-mv3) into
// Chromium with Playwright. Discord is never contacted: every request is
// answered by a local fixture or blocked.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
