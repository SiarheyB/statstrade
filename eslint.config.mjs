import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Разовые CLI-утилиты на Node (CommonJS by design): проверять их правилами
    // для приложения бессмысленно — они не собираются и не попадают в бандл.
    "scripts/**",
  ]),
  {
    // Подчёркивание перед именем — принятая пометка «параметр нужен по сигнатуре,
    // но не используется» (обработчики, заглушки в тестах). Ругаться на них
    // незачем — это и есть способ сказать «я знаю».
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Загрузка данных в useEffect — принятый в проекте способ: страницы дашборда
    // тянут свои данные сами (fetch в load(), состояние рядом), без SWR и
    // React Query. Правило React Compiler считает это ошибкой и предлагает
    // другую архитектуру — переезд на неё осмысленный, но это отдельная работа
    // с проверкой каждого экрана, а не попутная правка. Держим предупреждением,
    // чтобы новые случаи были на виду и решение оставалось видимым.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // В тестах `as any` — обычный способ подсунуть моку ровно те поля, которые
    // читает проверяемый код: полный тип модели Prisma или ccxt-биржи там не
    // нужен и только зашумил бы тест. На поведение приложения это не влияет —
    // тестовые файлы в сборку не попадают.
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
