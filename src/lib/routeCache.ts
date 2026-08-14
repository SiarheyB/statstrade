// Кэш ответов для роутов рыночных данных (orderflow, forex, liqmap).
//
// Зачем отдельный модуль: в каждом таком роуте лежал свой `new Map()` с TTL —
// БЕЗ ограничения размера и без вытеснения. Ключ обычно включает символ, биржу,
// таймфрейм и период (а в /api/orderflow/absorption — вообще всю query-строку),
// так что число комбинаций ничем не ограничено, а процесс живёт неделями:
// протухшие записи оставались в памяти навсегда.
//
// Здесь TTL + предел записей с вытеснением самой старой (Map хранит порядок
// вставки). Плюс дедупликация «в полёте»: одинаковые запросы, пришедшие пока
// считается первый, переиспользуют его промис, а не запускают вторую тяжёлую
// агрегацию — при опросе orderflow раз в 3 секунды это заметно.

type Entry = { at: number; value: unknown };

export type RouteCache = {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  /** Значение из кэша, иначе — вычислить (с дедупликацией параллельных вызовов). */
  fetch<T>(key: string, compute: () => Promise<T>): Promise<T>;
  /** Только для тестов/диагностики. */
  size(): number;
};

export function createRouteCache(ttlMs: number, maxEntries = 200): RouteCache {
  const store = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();

  function get<T>(key: string): T | undefined {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= ttlMs) {
      store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  function set(key: string, value: unknown): void {
    // Обновление существующего ключа не должно сохранять его старую позицию —
    // иначе «горячая» запись однажды окажется самой старой и будет вытеснена.
    store.delete(key);
    store.set(key, { at: Date.now(), value });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  async function fetch<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = get<T>(key);
    if (hit !== undefined) return hit;

    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const p = compute()
      .then((value) => {
        set(key, value);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return { get, set, fetch, size: () => store.size };
}
