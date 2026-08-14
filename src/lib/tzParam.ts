// Разбор таймзоны пользователя из запроса.
//
// Таймзона — настройка клиента (кука ts_timezone, см. lib/timezone.ts) и на
// сервере в общем случае неизвестна: значение "auto" вообще резолвится только
// на устройстве. Поэтому клиент присылает уже готовый сдвиг в минутах
// (?tzOffset=180), а сервер лишь валидирует диапазон.
//
// Знак — как в стандартном представлении смещения: UTC+3 → +180. Обратите
// внимание, что Date.getTimezoneOffset() в браузере возвращает ПРОТИВОПОЛОЖНЫЙ
// знак, поэтому на клиенте используется helper из lib/timezone.ts.

// Реальные зоны укладываются в UTC-12 … UTC+14.
const MIN_OFFSET = -12 * 60;
const MAX_OFFSET = 14 * 60;

export function parseTzOffset(raw: string | null): number {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (rounded < MIN_OFFSET || rounded > MAX_OFFSET) return 0;
  return rounded;
}

export function tzOffsetFromRequest(req: Request): number {
  return parseTzOffset(new URL(req.url).searchParams.get("tzOffset"));
}
