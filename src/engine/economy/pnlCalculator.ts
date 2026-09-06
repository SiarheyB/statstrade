// PnL и комиссии — раздел 4.1 спеки.
//
// Long:  PnL = (closePrice - entryPrice) * size * leverage - fees
// Short: PnL = (entryPrice - closePrice) * size * leverage - fees
// fees  = (entryPrice*size + closePrice*size) * commissionRate + spreadCost
import type { Position } from "@/engine/entities/types";

/**
 * Сколько денег стоит уровень: расстояние до цены, умноженное на объём и плечо.
 *
 * Нужно для тикета: «стоп на 41 200» само по себе не говорит ничего — важно,
 * сколько это в деньгах. Игрок ставит стоп, глядя на график, а рискует
 * счётом, и переводить одно в другое в уме он не должен.
 *
 * Комиссию сюда НЕ включаем: она зависит от цены закрытия, которую в момент
 * планирования никто не знает, а обещать точную цифру и потом её не сдержать
 * хуже, чем честная оценка «примерно столько».
 */
export function levelAmount(price: number, level: number, size: number, leverage: number): number {
  if (!(price > 0) || !(level > 0) || !(size > 0) || !(leverage > 0)) return 0;
  return Math.abs(price - level) * size * leverage;
}

/** То же самое, но расстояние задано процентом — как у скользящего стопа. */
export function percentAmount(price: number, pct: number, size: number, leverage: number): number {
  if (!(pct > 0)) return 0;
  return levelAmount(price, price * (1 + pct / 100), size, leverage);
}

export function calculateFees(
  entryPrice: number,
  closePrice: number,
  size: number,
  commissionRate: number,
  spreadCost: number,
): number {
  return (entryPrice * size + closePrice * size) * commissionRate + spreadCost;
}

export function calculateRealizedPnl(position: Position, closePrice: number): number {
  const gross =
    position.side === "long"
      ? (closePrice - position.entryPrice) * position.size * position.leverage
      : (position.entryPrice - closePrice) * position.size * position.leverage;
  return gross - position.fees;
}

/** Нереализованный PnL — то же самое, но fees уже накоплены в position.fees на момент открытия. */
export function calculateUnrealizedPnl(position: Position, currentPrice: number): number {
  const gross =
    position.side === "long"
      ? (currentPrice - position.entryPrice) * position.size * position.leverage
      : (position.entryPrice - currentPrice) * position.size * position.leverage;
  return gross - position.fees;
}

/**
 * Закрытие позиции по конкретной цене: формула 4.1 считает fees только в
 * момент закрытия (нужна closePrice), поэтому position.fees при ОТКРЫТИИ
 * всегда 0 — реальное значение считается здесь и один раз, общей функцией
 * для ручного закрытия (UI/стор) и автозакрытия по SL/TP (gameLoop), чтобы
 * два места не считали комиссию по-разному.
 */
export function settleClose(
  position: Position,
  exitPrice: number,
  commissionRate: number,
  spreadCost = 0,
): { fees: number; realizedPnl: number } {
  const fees = calculateFees(position.entryPrice, exitPrice, position.size, commissionRate, spreadCost);
  const realizedPnl = calculateRealizedPnl({ ...position, fees }, exitPrice);
  return { fees, realizedPnl };
}
