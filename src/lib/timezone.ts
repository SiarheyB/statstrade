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
  ...Array.from({ length: 27 }, (_, i) => 12 - i) // +14 .. -12
    .map((h) => ({ id: offsetLabel(h), label: offsetLabel(h) })),
];

export function isTimezone(v: string | undefined | null): v is TimezoneId {
  if (!v) return false;
  return v === "auto" || TIMEZONES.some((tz) => tz.id === v);
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
