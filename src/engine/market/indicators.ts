// Индикаторы для игрового графика. Свои, а не из библиотеки: считаются по
// тем же свечам, которые лежат в состоянии игры, и должны быть чистыми
// функциями — их результат проверяется тестами по известным числам.
//
// Набор намеренно маленький: две скользящие средние и RSI. Этого хватает,
// чтобы игрок мог опереться на что-то кроме глаза, и не превращает терминал
// в панель из сорока кнопок, в которой новичок утонет.
export interface IndicatorPoint {
  t: number;
  value: number;
}

export interface OhlcPoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Простая скользящая средняя по цене закрытия. */
export function sma(candles: OhlcPoint[], period: number): IndicatorPoint[] {
  if (period < 1 || candles.length < period) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ t: candles[i].t, value: sum / period });
  }
  return out;
}

/**
 * Экспоненциальная скользящая. Первое значение — простая средняя за период
 * (стандартный способ «завести» EMA), дальше рекуррентно.
 */
export function ema(candles: OhlcPoint[], period: number): IndicatorPoint[] {
  if (period < 1 || candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: IndicatorPoint[] = [];
  let prev = candles.slice(0, period).reduce((sum, c) => sum + c.c, 0) / period;
  out.push({ t: candles[period - 1].t, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].c * k + prev * (1 - k);
    out.push({ t: candles[i].t, value: prev });
  }
  return out;
}

/**
 * RSI по Уайлдеру со сглаживанием средних движений. Возвращает 0..100.
 * Рынок без единого падения даёт ровно 100 — это не ошибка, а определение.
 */
export function rsi(candles: OhlcPoint[], period = 14): IndicatorPoint[] {
  if (candles.length <= period) return [];
  const out: IndicatorPoint[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const push = (t: number) => {
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out.push({ t, value: avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + rs) });
  };
  push(candles[period].t);
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    push(candles[i].t);
  }
  return out;
}
