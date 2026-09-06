// Синтетический стакан заявок — раздел 9 спеки: «генерируется отдельно от
// price engine, псевдо-ликвидность вокруг текущей цены». Показывается
// только в scalping-режиме (раздел 15, Фаза 2 — «Order Book (синтетический)
// для scalping»), декоративный/атмосферный элемент, НЕ источник данных для
// исполнения ордеров (ордера в Фазе 1-2 исполняются по цене движка, без
// проскальзывания по стакану — это не входит в объём текущей фазы).
export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[]; // по убыванию цены, ближайший к mid — первый
  asks: OrderBookLevel[]; // по возрастанию цены, ближайший к mid — первый
}

/**
 * Уровни экспоненциально убывающего объёма по мере удаления от mid-цены —
 * типичная форма реального стакана (толще у "лучшей" цены, тоньше дальше).
 * levels шагов по tickSize в каждую сторону.
 */
export function generateSyntheticOrderBook(
  midPrice: number,
  tickSize: number,
  levels: number,
  rng: () => number,
): OrderBookSnapshot {
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  // Базовый объём на уровень масштабируем от цены актива, чтобы стакан не
  // выглядел одинаково у акции по 5$ и по 5000$.
  const baseSize = Math.max(1, midPrice * 0.5);
  for (let i = 1; i <= levels; i++) {
    const decay = Math.exp(-0.35 * (i - 1));
    // 0.5..1.5x шум вокруг затухающего объёма — стакан не идеально гладкий.
    const noise = 0.5 + rng();
    const size = Math.round(baseSize * decay * noise * 100) / 100;
    bids.push({ price: roundDown(midPrice - i * tickSize, tickSize), size });
    asks.push({ price: roundUp(midPrice + i * tickSize, tickSize), size });
  }
  return { bids, asks };
}

function roundDown(price: number, tickSize: number): number {
  return Math.floor(price / tickSize) * tickSize;
}

function roundUp(price: number, tickSize: number): number {
  return Math.ceil(price / tickSize) * tickSize;
}
