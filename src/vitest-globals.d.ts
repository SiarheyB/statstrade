// Тесты запускаются с `globals: true` (vitest.config.ts), поэтому describe/it/
// expect/vi доступны без импорта. Для рантайма этого достаточно, но `tsc` про
// них не знал и валился с "Cannot find name 'vi'" в файлах, где импорт не
// прописан явно.
//
// Подключаем типы ссылкой, а не через compilerOptions.types: список `types`
// ОТКЛЮЧАЕТ автоподхват остальных @types (node, react и т.д.), что в Next-
// проекте ломает глобальный JSX. Ссылка добавляет только нужное.
//
// NB: vitest объявляет `vi` как const, а не namespace — писать `vi.Mock` как
// ТИП нельзя. Для типа мока в проекте используется `ReturnType<typeof vi.fn>`.
/// <reference types="vitest/globals" />

export {};
