// Скринер — «где сейчас движение». Открывается перком PK_SCREENER.
//
// Смысл ровно тот же, что у скринера в настоящем терминале: когда
// инструментов больше десятка (а после разблокировки рынков их несколько
// десятков), глазами по вкладкам не набегаешься. Панель отвечает на один
// вопрос: что дёрнулось прямо сейчас.
import type { Asset, Candle } from "@/engine/entities/types";

export interface ScreenerRow {
  assetId: string;
  symbol: string;
  price: number;
  changePct: number; // изменение за окно
  rangePct: number; // размах (high-low) за окно — грубая мера «нервности»
}

export const DEFAULT_LOOKBACK = 30;

/**
 * lookback считается в СВЕЧАХ, а не в игровом времени: длина свечи зависит от
 * стиля, и «за последний час» на скальпинге и на инвестициях означало бы
 * совершенно разные вещи. «За последние 30 баров» — то, что игрок видит на
 * графике.
 */
export function screenAssets(
  assets: Asset[],
  candles: Record<string, Candle[]>,
  prices: Record<string, number>,
  lookback: number = DEFAULT_LOOKBACK,
): ScreenerRow[] {
  const rows: ScreenerRow[] = [];
  for (const asset of assets) {
    const price = prices[asset.id];
    if (price == null) continue;
    const series = candles[asset.id] ?? [];
    const window = series.slice(-lookback);
    if (window.length < 2) {
      rows.push({ assetId: asset.id, symbol: asset.symbol, price, changePct: 0, rangePct: 0 });
      continue;
    }
    const open = window[0].open;
    let high = window[0].high;
    let low = window[0].low;
    for (const candle of window) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
    }
    rows.push({
      assetId: asset.id,
      symbol: asset.symbol,
      price,
      changePct: open > 0 ? ((price - open) / open) * 100 : 0,
      rangePct: low > 0 ? ((high - low) / low) * 100 : 0,
    });
  }
  // Сортировка по модулю изменения: скринер показывает, где движение, а не
  // кто в плюсе — падение на 5% интереснее роста на 0.1%.
  return rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}
