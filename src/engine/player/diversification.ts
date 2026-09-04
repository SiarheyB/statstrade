// Диверсификация портфеля — «куда вложены средства» (раздел 8, Investing).
// Отвечает на вопрос, которого не видно в таблице позиций: сколько денег
// стоит за каждым сектором/классом активов и не собрался ли весь портфель в
// одной корзине.
//
// Свободные деньги — такая же доля портфеля, как акции: портфель, где 90%
// лежит кэшем, «диверсифицирован» только на бумаге, и без этой доли
// картинка врала бы ровно в тот момент, когда игрок только начал покупать.
import type { Asset, Position } from "@/engine/entities/types";

export const CASH_KEY = "cash";
export const UNKNOWN_KEY = "other";

export type BreakdownDimension = "sector" | "assetClass";

export interface PortfolioSlice {
  key: string; // сектор ("tech"), класс актива ("bond") или CASH_KEY
  value: number; // рыночная стоимость доли
  weight: number; // 0..1, доля в портфеле
}

/**
 * Считаем ЭКСПОЗИЦИЮ по модулю (|size * price|), а не «сколько владеем»:
 * шорт по нефти — это тоже капитал под риском в энергетическом секторе, и
 * прятать его из картинки концентрации было бы опаснее, чем показать. При
 * buy&hold (единственный стиль, где панель и показывается) шортов обычно
 * нет вовсе, так что на практике это просто стоимость пакета.
 */
export function portfolioSlices(
  positions: Position[],
  assets: Asset[],
  prices: Record<string, number>,
  cash: number,
  dimension: BreakdownDimension,
): PortfolioSlice[] {
  const byKey = new Map<string, number>();
  for (const p of positions) {
    if (p.closedAt != null) continue;
    const price = prices[p.assetId];
    if (price == null) continue;
    const asset = assets.find((a) => a.id === p.assetId);
    const key = (dimension === "sector" ? asset?.sector : asset?.assetClass) ?? UNKNOWN_KEY;
    byKey.set(key, (byKey.get(key) ?? 0) + Math.abs(p.size * price));
  }
  if (cash > 0) byKey.set(CASH_KEY, (byKey.get(CASH_KEY) ?? 0) + cash);

  const total = Array.from(byKey.values()).reduce((sum, v) => sum + v, 0);
  if (total <= 0) return [];
  return Array.from(byKey.entries())
    .map(([key, value]) => ({ key, value, weight: value / total }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Индекс Херфиндаля-Хиршмана: сумма квадратов долей. 1 — всё в одной
 * корзине, 1/n — n равных долей. Стандартная мера концентрации, её же
 * используют регуляторы для рынков — не выдумываем свою.
 */
export function herfindahl(slices: PortfolioSlice[]): number {
  return slices.reduce((sum, s) => sum + s.weight * s.weight, 0);
}

/**
 * Оценка диверсификации 0-100 для UI. Линейно от HHI: одна корзина — 0,
 * бесконечно много равных — 100. Это ИНДИКАТОР, а не оценка качества
 * стратегии: концентрированный портфель — осознанный выбор, а не ошибка,
 * поэтому нигде не мешаем игроку и ничего не блокируем.
 */
export function diversificationScore(slices: PortfolioSlice[]): number {
  if (slices.length === 0) return 0;
  return Math.round((1 - herfindahl(slices)) * 100);
}

/** Крупнейшая доля БЕЗ учёта кэша — «где сосредоточен риск». */
export function largestExposure(slices: PortfolioSlice[]): PortfolioSlice | null {
  const invested = slices.filter((s) => s.key !== CASH_KEY);
  if (invested.length === 0) return null;
  return invested.reduce((max, s) => (s.weight > max.weight ? s : max));
}

/** Доля портфеля, которая реально вложена (не лежит кэшем). */
export function investedShare(slices: PortfolioSlice[]): number {
  return slices.filter((s) => s.key !== CASH_KEY).reduce((sum, s) => sum + s.weight, 0);
}
