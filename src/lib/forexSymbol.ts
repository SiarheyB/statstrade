// Валидация валютной пары для форекс-роутов.
//
// Раньше symbol брался из query как есть: инъекции нет (Prisma параметризует),
// но строка любой длины уходила и в запрос к БД, и в КЛЮЧ кэша ответов
// (`${symbol}|${range}|${tz}` в /api/forex). Число записей в routeCache
// ограничено, а длина ключа — нет, поэтому мегабайтными символами можно было
// раздуть память процесса. Orderflow свой символ чистил, форекс — нет.
//
// Формат задаётся FX_SYMBOLS и всегда выглядит как XXX/YYY (EUR/USD, GBP/JPY).
// Проверяем формой, а не списком из env: список у приложения и коллектора
// может разъехаться, и тогда валидный символ из БД перестал бы открываться.

const FX_SYMBOL_RE = /^[A-Z]{2,6}\/[A-Z]{2,6}$/;

export const DEFAULT_FX_SYMBOL = "EUR/USD";

/** Приводит к верхнему регистру и проверяет формат. null — не подходит. */
export function normalizeFxSymbol(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return DEFAULT_FX_SYMBOL;
  if (typeof raw !== "string" || raw.length > 16) return null;
  const sym = raw.toUpperCase();
  return FX_SYMBOL_RE.test(sym) ? sym : null;
}
