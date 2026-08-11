import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  // Алиас задан ЯВНО, а не только через vite-tsconfig-paths: плагин применяет
  // маппинг лишь к файлам, попадающим в `include` из tsconfig.json, а тесты
  // оттуда исключены (иначе `next build` тайп-чекает их и падает — см.
  // комментарий в tsconfig.json). Без этой строки все импорты "@/…" в тестах
  // переставали резолвиться.
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 5000,
    // .claude/worktrees/** holds temporary agent worktrees (full repo copies) —
    // without this, vitest's default glob picks up their test files too and
    // runs everything twice. Keep vitest's own defaults alongside it.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/.claude/worktrees/**',
    ],
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
      // Планка покрытия: ниже 80% по любому из четырёх показателей
      // `vitest run --coverage` завершается с ошибкой. Порог именно здесь, а
      // не в договорённости на словах — иначе покрытие тихо сползает вниз с
      // каждой новой фичей. Если упало: смотри таблицу в выводе, красные
      // строки сверху — это и есть непокрытый код.
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});