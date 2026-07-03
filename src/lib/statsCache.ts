// In-process cache for the expensive /api/stats computation (load all fills →
// reconstruct trades → compute metrics). Keyed by user + a per-user version, so
// any mutation that affects a user's stats invalidates all their cached views
// at once by bumping the version. A short TTL is a safety net (e.g. background
// data the bump path doesn't cover) and bounds memory.
//
// Single long-running container → a module-level Map is sufficient. Not shared
// across replicas; if the app is ever scaled out, move this to Redis.

const TTL_MS = 60_000;
// Каждый payload — это все сделки юзера (могут быть мегабайты), так что держим
// НЕмного записей, иначе кэш выедает память app-контейнера (был OOM при 2000).
const MAX_ENTRIES = 120;
// Не кэшировать слишком крупные ответы (активные трейдеры с десятками тысяч
// сделок): один такой payload может весить десятки МБ. Порог по числу сделок.
const MAX_TRADES_TO_CACHE = 8000;

type Entry = { at: number; value: unknown };
const store = new Map<string, Entry>();
const versions = new Map<string, number>();

export function statsVersion(userId: string): number {
  return versions.get(userId) ?? 0;
}

// Invalidate every cached stats view for this user (call after any write that
// changes their trades/annotations/accounts/options).
export function bumpStatsVersion(userId: string): void {
  versions.set(userId, (versions.get(userId) ?? 0) + 1);
}

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= TTL_MS) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCached(key: string, value: unknown): void {
  // Skip caching very large payloads (huge accounts) — they dominate memory and
  // are re-derived cheaply enough on the rare hit.
  const trades = (value as { trades?: unknown[] } | null)?.trades;
  if (Array.isArray(trades) && trades.length > MAX_TRADES_TO_CACHE) return;
  // Cheap bound: drop the oldest insertion when full (Map preserves order).
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { at: Date.now(), value });
}
