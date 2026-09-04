// Дивиденды/купоны — раздел 4.6 спеки. Формула общая для акций и облигаций
// (у обеих есть Asset.dividendYield — купон облигации моделируется тем же
// полем, реальной разницы в механике нет, только смысл названия).
//
// dividendPayment (за период) = holdingSize * currentPrice * (dividendYield / paymentsPerYear)
//
// Выплаты — раз в игровой "квартал" (см. QUARTER_MS в gameLoop.ts), по всем
// активам с dividendYield, автоматически, без действий игрока.
import type { Account, Asset } from "@/engine/entities/types";

export const PAYMENTS_PER_YEAR = 4; // квартальная выплата

export function calculateDividendPayment(
  holdingSize: number,
  currentPrice: number,
  dividendYield: number,
  paymentsPerYear: number = PAYMENTS_PER_YEAR,
): number {
  return holdingSize * currentPrice * (dividendYield / paymentsPerYear);
}

/**
 * Только LONG-позиции получают дивиденды (реальное владение бумагой) — шорт
 * дивиденды не получает (в реальности их, наоборот, платит держателю
 * одолженной бумаги, но эта механика — за пределами Фазы 5/спеки). Сумма
 * size по всем открытым long-позициям одного актива — то же самое, что
 * "holdingSize" формулы: если игрок докупал этот актив несколькими сделками,
 * дивиденды считаются с суммарного пакета, а не только с последней покупки.
 */
export function processQuarterlyDividends(account: Account, assets: Asset[], prices: Record<string, number>): number {
  const holdingsByAsset = new Map<string, number>();
  for (const p of account.positions) {
    if (p.closedAt != null || p.side !== "long") continue;
    holdingsByAsset.set(p.assetId, (holdingsByAsset.get(p.assetId) ?? 0) + p.size);
  }

  let totalPaid = 0;
  for (const [assetId, holdingSize] of holdingsByAsset) {
    const asset = assets.find((a) => a.id === assetId);
    const price = prices[assetId];
    if (!asset?.dividendYield || price == null) continue;
    totalPaid += calculateDividendPayment(holdingSize, price, asset.dividendYield);
  }

  account.balance += totalPaid;
  return totalPaid;
}
