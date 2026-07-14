// User-selectable display timezone: a fixed UTC offset (not a DST-aware IANA
// zone — simpler for users to reason about, "UTC+3" always means +3, no
// surprises around DST transitions) applied to every date/time shown in the
// app (trades, calendar, charts, news). Stored in a cookie, same pattern as
// the i18n locale (see lib/i18n/core.ts).

export type TimezoneId = string; // "auto" | "UTC" | "UTC+1" .. "UTC+14" | "UTC-1" .. "UTC-12"

export const TIMEZONE_COOKIE = "ts_timezone";
export const DEFAULT_TIMEZONE: TimezoneId = "auto";

function offsetLabel(h: number): string {
  return h === 0 ? "UTC" : `UTC${h > 0 ? "+" : ""}${h}`;
}

export const TIMEZONES: { id: TimezoneId; label: string }[] = [
  { id: "auto", label: "Auto (device)" },
  ...Array.from({ length: 27 }, (_, i) => 14 - i) // +14 .. -12
    .map((h) => ({ id: offsetLabel(h), label: offsetLabel(h) })),
];

export function isTimezone(v: string | undefined | null): v is TimezoneId {
  if (!v) return false;
  if (v === "auto") return true;

  // Клиент шлёт "UTC+3", но URL-парсер на сервере превращает '+' в пробел
  // ("UTC 3"), либо кодирует как "UTC%2B3" (decodeURIComponent -> "UTC+3").
  // Учитываем оба варианта.
  const decoded = decodeURIComponent(v);
  const toCheck = decoded !== v ? decoded : v;

  if (TIMEZONES.some((tz) => tz.id === toCheck)) return true;

  // Шаблон "UTC±N" / "±N" — пробелы вокруг знака допустимы.
  const m = /^(?:utc)?\s*([+-]?)\s*(\d{1,2})\s*$/i.exec(toCheck);
  if (!m) return false;
  const h = parseInt(`${m[1] || "+"}${m[2]}`, 10);
  return h >= -12 && h <= 14;
}

/**
 * Нормализует и валидирует timezone из куки/стейта.
 * Возвращает безопасный TimezoneId (никогда не null/undefined).
 * Если значение невалидно — фоллбэк на DEFAULT_TIMEZONE ("auto").
 */
export function normalizeTimezone(tz: string | undefined | null): TimezoneId {
  if (tz === undefined || tz === null) return DEFAULT_TIMEZONE;
  if (typeof tz !== "string") return DEFAULT_TIMEZONE;
  // Точное совпадение с известным id ("auto" | "UTC" | "UTC±N").
  if (tz === "auto" || TIMEZONES.some((x) => x.id === tz)) return tz;
  // Попытка распарсить варианты вроде "UTC+3", "utc-5", "+3", "-5",
  // а также "UTC 3" (пробел вместо '+' — результат парсинга URL).
  const m = /^(?:utc)?\s*([+-]?)\s*(\d{1,2})$/i.exec(tz.trim());
  if (m) {
    const h = parseInt(`${m[1] || "+"}${m[2]}`, 10);
    if (h >= -12 && h <= 14) return offsetLabel(h);
  }
  console.warn(`[timezone] Invalid timezone "${tz}", falling back to "${DEFAULT_TIMEZONE}"`);
  return DEFAULT_TIMEZONE;
}

/**
 * Получает timezone из куки на клиенте (browser-only).
 * Безопасно для использования в useEffect / event handlers.
 */
export function getTimezoneFromCookie(): TimezoneId {
  if (typeof document === "undefined") return DEFAULT_TIMEZONE;
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${TIMEZONE_COOKIE}=`));
  return normalizeTimezone(cookie?.split("=")[1]);
}

// Fixed UTC-offset minutes for the id, or null for "auto" (use the device's
// own local timezone, i.e. do nothing special).
export function offsetMinutes(tz: TimezoneId): number | null {
  if (tz === "auto") return null;
  if (tz === "UTC") return 0;
  const m = /^UTC([+-]\d{1,2})$/.exec(tz);
  return m ? parseInt(m[1], 10) * 60 : null;
}

// IANA-ish zone name for Intl.DateTimeFormat/toLocaleString's `timeZone`
// option. `Etc/GMT` signs are inverted from common usage (Etc/GMT-3 = UTC+3).
export function ianaFor(tz: TimezoneId): string | undefined {
  if (tz === "auto") return undefined;
  if (tz === "UTC") return "UTC";
  const m = /^UTC([+-]\d{1,2})$/.exec(tz);
  if (!m) return undefined;
  const h = parseInt(m[1], 10);
  return `Etc/GMT${h <= 0 ? "+" : "-"}${Math.abs(h)}`;
}

// For hand-rolled canvas-chart formatters that read wall-clock fields via
// getHours()/getDate() etc. (can't take a `timeZone` option): device-local
// timestamps already come back as local time via those getters, so "auto"
// needs no shifting — only a fixed offset needs the timestamp shifted (from
// real UTC to the chosen offset) and then read back with the UTC getters,
// which avoids re-applying the browser's own local offset on top.
export function shiftedMs(ms: number, tz: TimezoneId): { ms: number; useUtc: boolean } {
  const off = offsetMinutes(tz);
  if (off === null) return { ms, useUtc: false };
  return { ms: ms + off * 60000, useUtc: true };
}

// Wall-clock fields (year/month/day/hour/minute/weekday) for a timestamp in
// the given display timezone — the one-stop helper for canvas-chart axis
// labels and tooltips that can't use Intl's `timeZone` option directly.
export type ZonedParts = { y: number; mo: number; d: number; h: number; mi: number; day: number };
export function zonedParts(ms: number, tz: TimezoneId): ZonedParts {
  const { ms: shifted, useUtc } = shiftedMs(ms, tz);
  const d = new Date(shifted);
  return useUtc
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), day: d.getUTCDay() }
    : { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), day: d.getDay() };
}

// Inverse of zonedParts for whole-day arithmetic (calendar grids): given a
// year/month/day *as seen in the display timezone*, return the real UTC
// timestamp of that day's midnight — so stepping by 24h and re-reading via
// zonedParts walks calendar days correctly in the user's chosen zone.
export function zonedDateToUtcMs(y: number, mo: number, d: number, tz: TimezoneId): number {
  const off = offsetMinutes(tz);
  if (off === null) return new Date(y, mo, d).getTime();
  return Date.UTC(y, mo, d) - off * 60000;
}
