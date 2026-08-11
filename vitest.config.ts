import { defineConfig } from 'vitest/config';

// Headless-by-design: the simulation runs in plain Node with no jsdom.
// Testability comes from dependency injection, never from DOM emulation.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    maxWorkers: 4,
  },
});
