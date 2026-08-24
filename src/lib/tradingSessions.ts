// Торговые сессии форекса (Токио / Лондон / Нью-Йорк) для подсветки на графике.
//
// Часы сессий заданы в МЕСТНОМ времени биржи, а не в UTC: Лондон и Нью-Йорк
// переходят на летнее время, и жёстко зашитые UTC-часы половину года были бы
// смещены на час. Перевод «местное время → UTC» делает Intl по IANA-зоне —
// он же знает и даты переходов.
//
// Важно не путать с таймзоной ПОЛЬЗОВАТЕЛЯ (lib/timezone.ts): она в приложении
// это фиксированный сдвиг («UTC+3») и отвечает только за подписи. Окна сессий
// считаются в абсолютном времени, поэтому на оси, подписанной в любой
// пользовательской зоне, они встают там, где надо, без дополнительных правок.

export type SessionId = "tokyo" | "london" | "newYork";

export type SessionDef = {
  id: SessionId;
  /** Подпись на графике — латиницей, как на биржевых терминалах. */
  label: string;
  /** IANA-зона биржи: именно из неё берётся переход на летнее время. */
  tz: string;
  /** Открытие/закрытие в минутах от местной полуночи. */
  openMin: number;
  closeMin: number;
  /** Базовый цвет подсветки. */
  color: string;
};

export const TRADING_SESSIONS: readonly SessionDef[] = [
  // Токио: 09:00–18:00 JST, перехода на летнее время в Японии нет.
  { id: "tokyo", label: "Tokyo", tz: "Asia/Tokyo", openMin: 9 * 60, closeMin: 18 * 60, color: "#3b82f6" },
  // Лондон: 08:00–17:00 местного (GMT зимой, BST летом).
  { id: "london", label: "London", tz: "Europe/London", openMin: 8 * 60, closeMin: 17 * 60, color: "#f59e0b" },
  // Нью-Йорк: 08:00–17:00 местного (EST зимой, EDT летом).
  { id: "newYork", label: "New York", tz: "America/New_York", openMin: 8 * 60, closeMin: 17 * 60, color: "#10b981" },
] as const;

export type SessionWindow = {
  id: SessionId;
  label: string;
  color: string;
  /** Абсолютные метки времени начала/конца сессии, мс UTC. */
  start: number;
  end: number;
};

const DAY_MS = 86_400_000;

// Окна считаются только на обозримом диапазоне: на недельном таймфрейме за год
// это 750+ прямоугольников шириной в пиксель — мусор на экране и лишняя работа
// на каждом кадре.
export const MAX_SESSION_SPAN_MS = 45 * DAY_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** Настенное время момента `ms` в зоне `tz`. */
function wallTime(ms: number, tz: string): Wall {
  const parts = formatterFor(tz).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), mo: get("month") - 1, d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Сдвиг зоны относительно UTC в этот момент, мс (для Лондона летом +3600000). */
function zoneOffsetMs(ms: number, tz: string): number {
  const w = wallTime(ms, tz);
  return Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Момент UTC для настенного времени в зоне биржи.
 *
 * Два прохода нужны из-за перехода на летнее время: сдвиг, взятый по
 * первоначальной догадке, может относиться к «другой стороне» перевода часов.
 */
export function zonedWallToUtcMs(y: number, mo: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, 0, minutes);
  const off1 = zoneOffsetMs(guess, tz);
  const first = guess - off1;
  const off2 = zoneOffsetMs(first, tz);
  return off2 === off1 ? first : guess - off2;
}

/** День недели (0=вс) в зоне биржи. */
function zonedWeekday(ms: number, tz: string): number {
  const w = wallTime(ms, tz);
  return new Date(Date.UTC(w.y, w.mo, w.d)).getUTCDay();
}

/**
 * Окна сессий, пересекающиеся с [fromMs, toMs].
 *
 * Выходные пропускаются: в субботу и воскресенье по местному времени биржи
 * рынка нет, а пустая коробка на графике выглядит как ошибка.
 */
export function sessionWindows(
  fromMs: number,
  toMs: number,
  enabled: Iterable<SessionId>,
): SessionWindow[] {
  const ids = new Set(enabled);
  if (ids.size === 0) return [];
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  if (toMs - fromMs > MAX_SESSION_SPAN_MS) return [];

  const out: SessionWindow[] = [];
  for (const s of TRADING_SESSIONS) {
    if (!ids.has(s.id)) continue;
    // Запас в сутки с каждой стороны: сессия могла начаться вчера и всё ещё
    // идти, а «сегодняшняя» по UTC дата в зоне биржи бывает завтрашней.
    for (let cursor = fromMs - DAY_MS; cursor <= toMs + DAY_MS; cursor += DAY_MS) {
      const w = wallTime(cursor, s.tz);
      const start = zonedWallToUtcMs(w.y, w.mo, w.d, s.openMin, s.tz);
      const end = zonedWallToUtcMs(w.y, w.mo, w.d, s.closeMin, s.tz);
      if (end <= fromMs || start >= toMs) continue;
      const weekday = zonedWeekday(start, s.tz);
      if (weekday === 0 || weekday === 6) continue;
      // Соседние итерации курсора могут попасть в один местный день.
      if (out.some((x) => x.id === s.id && x.start === start)) continue;
      out.push({ id: s.id, label: s.label, color: s.color, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Часы сессии «сегодня» — для подписи в меню, уже с учётом летнего времени. */
export function sessionTodayWindow(id: SessionId, now = Date.now()): { start: number; end: number } | null {
  const s = TRADING_SESSIONS.find((x) => x.id === id);
  if (!s) return null;
  const w = wallTime(now, s.tz);
  return {
    start: zonedWallToUtcMs(w.y, w.mo, w.d, s.openMin, s.tz),
    end: zonedWallToUtcMs(w.y, w.mo, w.d, s.closeMin, s.tz),
  };
}
