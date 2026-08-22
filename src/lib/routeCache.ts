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

export type RouteCacheOptions = {
  /**
   * Сколько ещё держать протухшую запись, отдавая её сразу и пересчитывая в
   * фоне (stale-while-revalidate).
   *
   * Без этого каждый TTL-й запрос платит за полный пересчёт: на главной это
   * пять запросов в базу, и человек, которому «не повезло», ждал их вместо
   * мгновенного ответа. С окном простоя ждёт только первый заход после старта
   * процесса — дальше страница всегда отдаётся из памяти.
   */
  staleMs?: number;
};

export function createRouteCache(
  ttlMs: number,
  maxEntries = 200,
  options: RouteCacheOptions = {},
): RouteCache {
  const staleMs = options.staleMs ?? 0;
  const store = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();

  function get<T>(key: string): T | undefined {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= ttlMs) {
      // В окне простоя запись остаётся: её отдаст fetch, пока считает свежую.
      if (Date.now() - hit.at >= ttlMs + staleMs) store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  /** Протухшее, но ещё пригодное значение — только для fetch. */
  function getStale<T>(key: string): T | undefined {
    const hit = store.get(key);
    if (!hit || staleMs <= 0) return undefined;
    return Date.now() - hit.at < ttlMs + staleMs ? (hit.value as T) : undefined;
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
    if (running) {
      // Пересчёт уже идёт: если есть чем ответить прямо сейчас — отвечаем, а не
      // становимся в очередь за свежими данными.
      const stale = getStale<T>(key);
      if (stale !== undefined) return stale;
      return running;
    }

    // Данные просрочены, но ещё годны: отдаём их и обновляем в фоне.
    const stale = getStale<T>(key);
    if (stale !== undefined) {
      void startCompute(key, compute).catch(() => undefined);
      return stale;
    }

    return startCompute(key, compute);
  }

  function startCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
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
