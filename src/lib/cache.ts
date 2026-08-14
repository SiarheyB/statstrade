// Небольшой in-memory кэш с TTL.
//
// Раньше здесь не было ни предела размера, ни вытеснения: протухшая запись
// удалялась только если её кто-то ЗАПРОСИЛ повторно. Ключи, которые больше
// никогда не читают (ушедший пользователь, старый период), оставались в памяти
// навсегда, а процесс живёт неделями. Теперь: предел записей + вытеснение
// самых старых, плюс подметание протухшего при вставке.
//
// Для кэша ответов роутов есть отдельный lib/routeCache.ts — там ещё и
// дедупликация параллельных вычислений.

type CacheEntry<T> = { value: T; expiresAt: number };

const DEFAULT_MAX_ENTRIES = 1000;

class SimpleCache {
  private store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number) {
    // Перезапись не должна сохранять старую позицию в Map, иначе «горячий»
    // ключ однажды окажется самым старым и вылетит первым.
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) this.evict();
  }

  /** Сначала выносим протухшее, и только если не помогло — самое старое. */
  private evict() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  /** Только для тестов/диагностики. */
  size(): number {
    return this.store.size;
  }
}

export const Cache = new SimpleCache();
