import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The content-script helpers read the DOM, so tests run against jsdom.
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
