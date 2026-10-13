import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Creates and migrates a separate test database once before all tests.
    globalSetup: ['test/global-setup.ts'],
  },
});
