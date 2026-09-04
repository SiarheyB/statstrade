// Главный тик симуляции — раздел 11 спеки, сужено под Фазу 1 (MVP Core
// Loop): нет маржи/ликвидации (Фаза 2), нет режимов/новостей (Фаза 3), нет
// дивидендов (Фаза 5). Шаги 1/2/6 псевдокода раздела 11 в Фазе 1 — no-op
// (маркерные комментарии ниже), чтобы структура функции не менялась, когда
// эти шаги подключатся.
import type { Account, Asset, Candle, MarketRegime, Position, TradingStyleConfig } from "@/engine/entities/types";
import { NEUTRAL_REGIME } from "@/engine/entities/types";
import { randomNormal, simulateTick } from "@/engine/market/priceSimulation";
import { calculateUnrealizedPnl, settleClose } from "@/engine/economy/pnlCalculator";

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
// Длина одной свечи в игровом времени — 1 игровая минута (день-режим торгует
// внутри дня, минутный бар — минимальная осмысленная гранулярность для его
// графика). Свечей на актив храним ограниченно (см. persistence/gameDb.ts).
export const CANDLE_INTERVAL_MS = 60_000;
export const MAX_CANDLES_PER_ASSET = 500;

export interface GameState {
  account: Account;
  marketRegime: MarketRegime;
  prices: Record<string, number>;
  candles: Record<string, Candle[]>;
  activeAssets: Asset[];
  activeStyle: TradingStyleConfig;
  gameCalendarDay: number;
  gameElapsedMs: number; // накоплено игрового времени с начала партии
}

function appendPriceToCandles(candles: Candle[], price: number, gameMs: number): Candle[] {
  const bucketStart = Math.floor(gameMs / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
  const last = candles[candles.length - 1];
  if (last && last.timestamp === bucketStart) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    return candles;
  }
  const next = [...candles, { timestamp: bucketStart, open: price, high: price, low: price, close: price, volume: 0 }];
  return next.length > MAX_CANDLES_PER_ASSET ? next.slice(next.length - MAX_CANDLES_PER_ASSET) : next;
}

/**
 * SL/TP той же свечи имеют приоритет над ручным закрытием (edge case
 * раздела 26 — там речь о ликвидации, но тот же принцип применён к
 * автозакрытию: движок решает раньше, чем успеет отреагировать игрок).
 * Возвращает цену исполнения, если условие сработало, иначе null.
 * Проверяем SL первым: если оба условия каким-то образом истинны в один
 * тик (шаг цены больше расстояния между SL и TP) — консервативнее закрыть
 * по стопу.
 */
export function checkStopConditions(position: Position, currentPrice: number): number | null {
  const { side, stopLoss, takeProfit } = position;
  if (side === "long") {
    if (stopLoss != null && currentPrice <= stopLoss) return stopLoss;
    if (takeProfit != null && currentPrice >= takeProfit) return takeProfit;
  } else {
    if (stopLoss != null && currentPrice >= stopLoss) return stopLoss;
    if (takeProfit != null && currentPrice <= takeProfit) return takeProfit;
  }
  return null;
}

/**
 * Закрывает позицию по заданной цене и применяет эффект к счёту (баланс,
 * журнал). Общая функция для авто-закрытия по SL/TP (ниже, шаг 4) и
 * ручного закрытия из UI (gameStore.ts) — чтобы оба пути считали комиссию
 * и R-мультипликатор одинаково. Мутирует переданный account (вызывающий
 * код передаёт уже скопированный черновик), возвращает realizedPnl.
 *
 * spreadCost всегда 0: раздел 4.1 включает его в fees, но Asset (раздел 2)
 * не задаёт базовый bid/ask спред по инструменту — ADJUSTED FROM SPEC,
 * пересмотреть, когда в данные добавится спред.
 */
export function applyPositionClose(account: Account, position: Position, exitPrice: number, commissionRate: number): number {
  const { realizedPnl } = settleClose(position, exitPrice, commissionRate, 0);
  // entryPrice*size — резерв, снятый с баланса при открытии (см.
  // gameStore.ts openPosition) — симметричен для long и short, потому что
  // Фаза 1 без плеча/маржи (раздел 4.2 переопределит это в Фазе 2).
  account.balance += position.entryPrice * position.size + realizedPnl;
  account.journal.push({
    id: crypto.randomUUID(),
    positionId: position.id,
    timestampClosed: Date.now(),
    pnl: realizedPnl,
    rMultiple:
      position.stopLoss != null
        ? realizedPnl / (Math.abs(position.entryPrice - position.stopLoss) * position.size * position.leverage)
        : 0,
    tags: [],
  });
  const idx = account.positions.findIndex((p) => p.id === position.id);
  const closed: Position = { ...position, closedAt: Date.now(), closePrice: exitPrice, realizedPnl };
  if (idx >= 0) account.positions[idx] = closed;
  return realizedPnl;
}

function recalculateAccountMetrics(account: Account, prices: Record<string, number>): void {
  let unrealizedTotal = 0;
  for (const p of account.positions) {
    // account.positions хранит и закрытые сделки (для истории в UI) — без
    // этого фильтра closedAt их entryPrice продолжал бы сравниваться с
    // текущей ценой вечно, и equity «плыла» бы от баланса даже без единой
    // открытой позиции (поймано вручную: закрыл сделку, unrealized PnL
    // закрытой позиции продолжал тикать вместе с ценой).
    if (p.closedAt != null) continue;
    const price = prices[p.assetId];
    if (price != null) unrealizedTotal += calculateUnrealizedPnl(p, price);
  }
  account.equity = account.balance + unrealizedTotal;
  // Маржа не задействована в Фазе 1 (без плеча) — оставляем нулями, поле
  // существует в типе для Фазы 2.
  account.marginUsed = 0;
  account.marginLevel = account.marginUsed > 0 ? (account.equity / account.marginUsed) * 100 : Infinity;
}

/**
 * Главный тик. dtRealMs — сколько реального времени прошло с прошлого
 * вызова. rng — источник случайности (сидированный в тестах, Math.random в
 * игре) — обязателен явным параметром для каждой функции движка (раздел 26).
 *
 * Шаги 1 (рыночный режим), 2 (генерация новостей) и часть шага 6
 * (дивиденды/fund fees) псевдокода раздела 11 — вне объёма Фазы 1, поэтому
 * пропущены (NEUTRAL_REGIME остаётся неизменным, новостей нет).
 */
export function gameTick(dtRealMs: number, state: GameState, rng: () => number): GameState {
  const dtGameMs = dtRealMs * state.activeStyle.timeAcceleration;
  const dtYears = dtGameMs / MS_PER_YEAR;
  const gameElapsedMs = state.gameElapsedMs + dtGameMs;

  // 3. Обновить цены активных активов.
  const prices = { ...state.prices };
  const candles = { ...state.candles };
  for (const asset of state.activeAssets) {
    const currentPrice = prices[asset.id];
    if (currentPrice == null) continue;
    const z = randomNormal(0, 1, rng);
    const newPrice = simulateTick({
      asset,
      currentPrice,
      dtYears,
      regime: NEUTRAL_REGIME, // Фаза 3 подставит state.marketRegime
      activeVolMultiplier: 1, // Фаза 3 учтёт активные новости
      correlatedZ: z, // Фаза 3 коррелирует Z между активами одной группы
    });
    prices[asset.id] = newPrice;
    candles[asset.id] = appendPriceToCandles(candles[asset.id] ?? [], newPrice, gameElapsedMs);
  }

  // 4. Проверить SL/TP открытых позиций (авто-закрытие).
  const account: Account = { ...state.account, positions: [...state.account.positions], journal: [...state.account.journal] };
  for (const position of [...account.positions]) {
    if (position.closedAt) continue;
    const price = prices[position.assetId];
    const exitPrice = price != null ? checkStopConditions(position, price) : null;
    if (exitPrice == null) continue;
    applyPositionClose(account, position, exitPrice, state.activeStyle.commissionRate);
  }

  // 5. Пересчитать equity/marginLevel.
  recalculateAccountMetrics(account, prices);

  return {
    ...state,
    prices,
    candles,
    account,
    gameElapsedMs,
    gameCalendarDay: Math.floor(gameElapsedMs / (24 * 60 * 60 * 1000)),
  };
}
