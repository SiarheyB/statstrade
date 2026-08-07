// Периодный календарь в таймзоне пользователя.
//
// Таймзона в приложении — это фиксированный сдвиг ("UTC+3", "UTC-5", см.
// lib/timezone.ts), а не IANA-зона: перехода на летнее время нет, поэтому
// граница локальных суток — это просто UTC-час. Благодаря этому почасовой
// агрегат (TradeHourly) складывается в локальные дни точно, без обращения к
// самим сделкам.
//
// Единственное исключение — настройка "auto": клиент резолвит сдвиг устройства
// и присылает его в минутах. Часовые пояса с получасовым сдвигом (Индия +5:30)
// при этом округляются до часа — граница суток уезжает на 30 минут. Список
// таймзон в UI состоит только из целых часов, так что это касается лишь "auto"
// на таком устройстве; см. также PROJECT_AUDIT.md.

export type PeriodKey = "day" | "week" | "month" | "year";
export const PERIODS: PeriodKey[] = ["day", "week", "month", "year"];

// Сдвиг в минутах → сдвиг в миллисекундах, округлённый до целого часа.
export function offsetMs(offsetMinutes: number): number {
  return Math.round(offsetMinutes / 60) * 3_600_000;
}

// UTC-момент → «локальные» части даты. Приём тот же, что в lib/timezone.ts:
// сдвигаем инстант и читаем его UTC-компоненты.
function localParts(utcMs: number, offMs: number) {
  const d = new Date(utcMs + offMs);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    dow: d.getUTCDay(),
  };
}

// Начало периода как UTC-инстант: полночь локальных суток, переведённая обратно
// в UTC. Раньше эта логика жила в lib/risk.ts и считала строго по UTC.
export function periodStart(key: PeriodKey, now: Date, offsetMinutes: number): number {
  const offMs = offsetMs(offsetMinutes);
  const { y, mo, d, dow } = localParts(now.getTime(), offMs);
  if (key === "day") return Date.UTC(y, mo, d) - offMs;
  if (key === "week") {
    const sinceMonday = (dow + 6) % 7;
    return Date.UTC(y, mo, d - sinceMonday) - offMs;
  }
  if (key === "month") return Date.UTC(y, mo, 1) - offMs;
  return Date.UTC(y, 0, 1) - offMs;
}

// Начало СЛЕДУЮЩЕГО периода — момент, когда счётчик обнуляется (TTL кэша).
export function periodEnd(key: PeriodKey, now: Date, offsetMinutes: number): number {
  const offMs = offsetMs(offsetMinutes);
  const { y, mo, d, dow } = localParts(now.getTime(), offMs);
  if (key === "day") return Date.UTC(y, mo, d + 1) - offMs;
  if (key === "week") {
    const sinceMonday = (dow + 6) % 7;
    return Date.UTC(y, mo, d - sinceMonday + 7) - offMs;
  }
  if (key === "month") return Date.UTC(y, mo + 1, 1) - offMs;
  return Date.UTC(y + 1, 0, 1) - offMs;
}

// Ключ локального дня ("2026-08-07") для UTC-инстанта.
export function localDayKey(utcMs: number, offsetMinutes: number): string {
  const { y, mo, d } = localParts(utcMs, offsetMs(offsetMinutes));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo + 1)}-${p(d)}`;
}

export type HourBucket = {
  hour: Date;
  netPnl: number;
  wins: number;
  losses: number;
  winR: number;
  lossR: number;
  trades: number;
};

export type DayBucket = {
  date: string; // локальный день, YYYY-MM-DD
  netPnl: number;
  wins: number;
  losses: number;
  winR: number;
  lossR: number;
  trades: number;
};

// Свернуть часовые агрегаты в локальные дни пользователя.
export function bucketByLocalDay(hours: HourBucket[], offsetMinutes: number): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const h of hours) {
    const date = localDayKey(h.hour.getTime(), offsetMinutes);
    const b = map.get(date) ?? {
      date, netPnl: 0, wins: 0, losses: 0, winR: 0, lossR: 0, trades: 0,
    };
    b.netPnl += h.netPnl;
    b.wins += h.wins;
    b.losses += h.losses;
    b.winR += h.winR;
    b.lossR += h.lossR;
    b.trades += h.trades;
    map.set(date, b);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Суммы за период: складываем часы, попавшие в окно [periodStart, now].
//
// Верхняя граница обязательна. В проде сделок «из будущего» не бывает, но без
// неё функция суммирует ВЕСЬ переданный массив от начала периода и дальше —
// то есть результат зависит от того, что вызывающий положил в hours, а не от
// запрошенного окна. Бакет, внутрь которого попадает `now`, включается целиком
// (он содержит уже совершённые сделки этого часа).
export function sumInPeriod(
  hours: HourBucket[],
  key: PeriodKey,
  now: Date,
  offsetMinutes: number,
): { netPnl: number; wins: number; losses: number } {
  const start = periodStart(key, now, offsetMinutes);
  const end = now.getTime();
  let netPnl = 0, wins = 0, losses = 0;
  for (const h of hours) {
    const t = h.hour.getTime();
    if (t < start || t > end) continue;
    netPnl += h.netPnl;
    wins += h.wins;
    losses += h.losses;
  }
  return { netPnl, wins, losses };
}
