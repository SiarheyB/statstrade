/**
 * chartPrefs — настройки панели графика, которые переживают перезагрузку.
 *
 * Инструмент, таймфрейм, подсветка сессий и прочие тумблеры над графиком —
 * это выбор рабочего места, а не разовое действие: открыв /dashboard/forex
 * второй раз, человек ждёт ровно тот же экран, что закрыл. Держим их в
 * localStorage рядом с языком и таймзоной (в БД их нет намеренно — см.
 * CLAUDE.md, раздел про i18n).
 *
 * Одна запись на страницу (`forex.settings`, `liqmap.settings`,
 * `orderflow.settings`): добавить ещё один тумблер — значит дописать поле,
 * а не завести очередной ключ.
 *
 * ВАЖНО: читать это можно только в эффекте. Страницы рендерятся и на сервере,
 * где localStorage нет, — ленивый инициализатор useState упал бы на SSR.
 */

/** Прочитать настройки страницы. Ничего нет / хранилище закрыто — `{}`. */
export function readChartPrefs(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // приватный режим, заблокированное хранилище, битый JSON — дефолты
    return {};
  }
}

/** Сохранить настройки страницы целиком. */
export function writeChartPrefs(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // хранилище недоступно — настройки просто не запомнятся
  }
}

/** Строка из настроек, но только если она входит в список допустимых. */
export function prefString<T extends string>(
  value: unknown,
  allowed: readonly T[] | ReadonlySet<T>,
): T | null {
  if (typeof value !== "string") return null;
  const has = allowed instanceof Set ? allowed.has(value as T) : (allowed as readonly T[]).includes(value as T);
  return has ? (value as T) : null;
}
