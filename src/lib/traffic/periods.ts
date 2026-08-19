// Периоды для раздела «Трафик»: today | 7d | 30d | 90d | all.
//
// Границы считаются в таймзоне админа (фиксированное смещение из cookie, см.
// lib/timezone.ts), а в SQL уходят уже в UTC. Иначе «сегодня» на графике
// начиналось бы в полночь по UTC, а не по времени того, кто смотрит.

export type PeriodKey = "today" | "7d" | "30d" | "90d" | "all";

export const PERIODS: PeriodKey[] = ["today", "7d", "30d", "90d", "all"];

export function isPeriod(v: string | null | undefined): v is PeriodKey {
  return !!v && (PERIODS as string[]).includes(v);
}

const DAY_MS = 86_400_000;

/** Полночь текущих локальных суток (с учётом смещения) в UTC-миллисекундах. */
export function localMidnightUtc(now: Date, tzOffsetMin: number): number {
  const shifted = now.getTime() + tzOffsetMin * 60_000;
  const midnight = Math.floor(shifted / DAY_MS) * DAY_MS;
  return midnight - tzOffsetMin * 60_000;
}

export type Bounds = { from: Date; to: Date; bucket: "day" | "hour" };

/**
 * Границы периода. Верхняя граница — «сейчас плюс минута»: незакрытая
 * текущая минута всё равно попадает в выборку, а строк из будущего нет.
 */
export function periodBounds(period: PeriodKey, now: Date, tzOffsetMin: number): Bounds {
  const to = new Date(now.getTime() + 60_000);
  const midnight = localMidnightUtc(now, tzOffsetMin);
  switch (period) {
    case "today":
      return { from: new Date(midnight), to, bucket: "hour" };
    case "7d":
      return { from: new Date(midnight - 6 * DAY_MS), to, bucket: "day" };
    case "30d":
      return { from: new Date(midnight - 29 * DAY_MS), to, bucket: "day" };
    case "90d":
      return { from: new Date(midnight - 89 * DAY_MS), to, bucket: "day" };
    case "all":
      // «Всё время»: сбор начался не раньше 2026 года, раньше данных нет.
      return { from: new Date(Date.UTC(2026, 0, 1)), to, bucket: "day" };
  }
}

/** Предыдущий период той же длины — для стрелок «столько же/больше/меньше». */
export function previousBounds(b: Bounds): Bounds {
  const len = b.to.getTime() - b.from.getTime();
  return { from: new Date(b.from.getTime() - len), to: new Date(b.from.getTime()), bucket: b.bucket };
}

/** Относительное изменение метрики к прошлому периоду (null — не с чем сравнить). */
export function delta(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? null : 0;
  return (current - previous) / previous;
}
