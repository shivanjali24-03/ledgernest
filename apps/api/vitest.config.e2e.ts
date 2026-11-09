import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // e2e tests use the test database, never the development one
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/ledgernest_test?host=/tmp',
      JWT_ACCESS_SECRET: 'test-only-secret-that-is-long-enough-123',
      COOKIE_SECURE: 'false',
      LOGIN_RATE_LIMIT: '1000',
    },
    fileParallelism: false,
  },
});
