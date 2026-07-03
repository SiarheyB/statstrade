// Простой in-memory rate-limiter. app — один долгоживущий контейнер, поэтому
// общей Map достаточно (при масштабировании на реплики → вынести в Redis).
// Скользящее окно: храним таймстемпы попыток по ключу и чистим старые.

type Bucket = number[];
const buckets = new Map<string, Bucket>();

// Периодическая чистка, чтобы Map не рос бесконечно по «мёртвым» ключам.
let lastSweep = 0;
function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, ts] of buckets) {
    const fresh = ts.filter((t) => now - t < windowMs);
    if (fresh.length === 0) buckets.delete(k);
    else buckets.set(k, fresh);
  }
}

export type RateResult = { ok: boolean; retryAfterSec: number };

// Разрешить не более `limit` событий на `key` за `windowMs`. Регистрирует
// попытку при успехе. При превышении возвращает ok=false и сколько ждать.
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now, windowMs);
  const ts = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (ts.length >= limit) {
    const retryAfterSec = Math.ceil((windowMs - (now - ts[0])) / 1000);
    buckets.set(key, ts);
    return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  ts.push(now);
  buckets.set(key, ts);
  return { ok: true, retryAfterSec: 0 };
}

// IP клиента. За Cloudflare-туннелем реальный адрес — в cf-connecting-ip; иначе
// первый в x-forwarded-for. Фолбэк, чтобы ключ всегда был непустой.
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
