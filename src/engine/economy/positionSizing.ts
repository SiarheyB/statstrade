// Помощник по размеру позиции (риск-менеджмент) — раздел 4.3 спеки.
//
// positionSize = (accountBalance * riskPerTradePct) / (entryPrice - stopLossPrice)
//
// Только ПОДСКАЗКА в UI (не жёсткое ограничение) — риск фиксированной долей
// счёта на сделку, стандартная практика. riskPerTradePct — доля (0.01 = 1%).

export const DEFAULT_RISK_PER_TRADE_PCT = 0.01;

/**
 * Возвращает null, если entryPrice===stopLossPrice (риск на единицу равен
 * нулю — размер не определён, не деление на ноль в UI) или если оба
 * значения не заданы.
 */
export function suggestPositionSize(
  accountBalance: number,
  riskPerTradePct: number,
  entryPrice: number,
  stopLossPrice: number,
): number | null {
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  if (riskPerUnit === 0 || !Number.isFinite(riskPerUnit)) return null;
  const size = (accountBalance * riskPerTradePct) / riskPerUnit;
  return Number.isFinite(size) && size > 0 ? size : null;
}
