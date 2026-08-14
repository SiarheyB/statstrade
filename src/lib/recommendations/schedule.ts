/**
 * schedule.ts — когда пересчитывать «картину дня».
 *
 * Дневная свеча Binance закрывается в 00:00 UTC — круглый год, без перехода
 * на летнее/зимнее время: биржа работает 24/7 и никакого DST у неё нет.
 * Поэтому момент пересчёта — фиксированная точка на шкале UTC (00:05 UTC),
 * и «переводить» его никуда не нужно: сдвиг стрелок в стране пользователя
 * меняет только то, КАК этот момент читается по местным часам.
 *
 * Часовой пояс пользователя (см. lib/timezone.ts) — чисто display-настройка:
 * данные в LevelSetup общие для всех, у каждого своя «картина дня» быть не
 * может. Поэтому здесь считается UTC-момент, а форматирование под таймзону
 * админа делает UI через fmtDate/Intl.
 */

/** Час закрытия дневной свечи Binance, UTC. */
export const BINANCE_DAILY_CLOSE_UTC_HOUR = 0;

/**
 * Задержка после закрытия свечи. Пять минут — чтобы коллектор успел забрать
 * уже закрытый дневной бар, а не пересчитывать по недосформированному.
 */
export const RECOMPUTE_DELAY_MINUTES = 5;

/** Момент планового пересчёта для тех суток UTC, в которые попадает `at`. */
export function scheduledRunForUtcDay(at: Date): Date {
  return new Date(
    Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      BINANCE_DAILY_CLOSE_UTC_HOUR,
      RECOMPUTE_DELAY_MINUTES,
      0,
      0,
    ),
  );
}

/** Ближайший будущий плановый пересчёт (строго после `from`). */
export function nextScheduledRun(from: Date): Date {
  const today = scheduledRunForUtcDay(from);
  if (today > from) return today;
  const tomorrow = new Date(from.getTime() + 24 * 3600_000);
  return scheduledRunForUtcDay(tomorrow);
}

/**
 * Пора ли запускать плановый пересчёт: сегодняшний слот уже наступил, а
 * последний пересчёт был раньше него (или его не было вовсе).
 *
 * `lastRunAt` берётся из БД (время последней записи LevelSetup), а не из
 * памяти процесса — иначе рестарт контейнера каждый раз запускал бы лишний
 * прогон, а после падения слот, наоборот, мог бы потеряться.
 */
export function isRecomputeDue(now: Date, lastRunAt: Date | null): boolean {
  const slot = scheduledRunForUtcDay(now);
  if (now < slot) return false;
  return !lastRunAt || lastRunAt < slot;
}
