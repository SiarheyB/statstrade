import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      // Scope the coverage gate to the testable application code. Genuine
      // infrastructure that cannot run under vitest/jsdom is excluded:
      //  - collector/  standalone long-running Node service (its own deploy)
      //  - scripts/    one-off build/CLI scripts (not app runtime)
      //  - configs, .next, mocks, d.ts, setup — not app source
      exclude: [
        '**/node_modules/**',
        '**/.next/**',
        '**/coverage/**',
        '**/collector/**',
        '**/scripts/**',
        '**/deploy/**',
        '**/*.config.{js,ts,mjs,cjs}',
        '**/middleware.ts',
        '**/instrumentation.ts',
        '**/__mocks__/**',
        '**/*.d.ts',
        'vitest.setup.ts',
        'test-matrix.ts',
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
      ],
    },
  },
});