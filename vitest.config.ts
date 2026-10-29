import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/**/*.test.ts'],
    // Browser tests run separately: npm run test:e2e
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    // Fixed zone so date-range and formatting tests are deterministic (includes a DST change).
    env: { TZ: 'America/New_York' },
    restoreMocks: true,
  },
});
