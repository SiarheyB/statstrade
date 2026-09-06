// Маржа и ликвидация — раздел 4.2 спеки.
//
// requiredMargin = (entryPrice * size) / leverage
// liquidationPrice (long)  = entryPrice * (1 - 1/leverage + maintenanceMarginRate)
// liquidationPrice (short) = entryPrice * (1 + 1/leverage - maintenanceMarginRate)
//
// При leverage=1 (Фаза 1, без плеча) requiredMargin вырождается в полный
// номинал (entryPrice*size) — та же сумма, что резервировалась раньше
// напрямую в gameStore.openPosition(), поэтому подключение формулы здесь не
// меняет поведение Фазы 1, только обобщает его на leverage>1.
import type { Position, PositionSide } from "@/engine/entities/types";

// Дефолт из спеки: 0.5%.
export const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;
// "Дополнительный штраф liquidationPenalty = 1% от размера позиции" — здесь
// "размер позиции" читаем как номинал (entryPrice*size), тем же способом,
// каким считается commissionRate в разделе 4.1 (тоже от номинала, не от
// количества единиц).
export const LIQUIDATION_PENALTY_RATE = 0.01;

export function calculateRequiredMargin(entryPrice: number, size: number, leverage: number): number {
  return (entryPrice * size) / leverage;
}

export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: PositionSide,
  maintenanceMarginRate: number = DEFAULT_MAINTENANCE_MARGIN_RATE,
): number {
  return side === "long"
    ? entryPrice * (1 - 1 / leverage + maintenanceMarginRate)
    : entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
}

/**
 * true, если currentPrice уже пересекла ликвидационную цену позиции.
 *
 * maintenanceMarginRate можно понизить перками («послабление по марже»,
 * «твёрдая рука»): это отодвигает цену ликвидации ДАЛЬШЕ от входа. Эффект
 * считается на лету от текущего набора перков и ничего не накапливает —
 * поэтому купленный перк не создаёт задним числом «бесплатных денег», в
 * отличие от идеи скидывать сам резерв маржи (он снимается при открытии
 * позиции и возвращается при закрытии — там расхождение было бы прямой
 * дыркой в балансе).
 */
export function checkLiquidation(
  position: Position,
  currentPrice: number,
  maintenanceMarginRate: number = DEFAULT_MAINTENANCE_MARGIN_RATE,
): boolean {
  const liqPrice = calculateLiquidationPrice(position.entryPrice, position.leverage, position.side, maintenanceMarginRate);
  return position.side === "long" ? currentPrice <= liqPrice : currentPrice >= liqPrice;
}

export function calculateMarginLevel(equity: number, marginUsed: number): number {
  return marginUsed > 0 ? (equity / marginUsed) * 100 : Infinity;
}

export function calculateLiquidationPenalty(entryPrice: number, size: number): number {
  return entryPrice * size * LIQUIDATION_PENALTY_RATE;
}
