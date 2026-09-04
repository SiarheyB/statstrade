// Главный тик симуляции — раздел 11 спеки. Фаза 1 добавила базовый цикл
// (цена/SL-TP/equity), Фаза 2 — плечо/маржа/ликвидацию (4.2) и прогрессию
// (4.5, начисляется в applyPositionClose), Фаза 5 — дивиденды/купоны (4.6,
// шаг 6), раздел 13 — расход на образ жизни (шаг 6b), Фаза 3 — рыночные
// режимы (3.4, шаг 1), новости (3.5, шаг 2) и корреляцию активов внутри
// группы (3.3, внутри шага 3).
import type {
  Account,
  Asset,
  Candle,
  LifestyleState,
  MarketRegime,
  NewsEvent,
  Position,
  TradingStyleConfig,
} from "@/engine/entities/types";
import { DEFAULT_TUNING, type GameTuning } from "@/engine/entities/tuning";
import { updateMarketRegime } from "@/engine/market/marketRegime";
import {
  applyNewsShock,
  maybeGenerateNews,
  MAX_NEWS_FEED,
  newsVolMultipliers,
  pruneExpiredNews,
} from "@/engine/market/newsEngine";
import { randomNormal, simulateTick } from "@/engine/market/priceSimulation";
import { calculateUnrealizedPnl, settleClose } from "@/engine/economy/pnlCalculator";
import {
  calculateLiquidationPenalty,
  calculateLiquidationPrice,
  calculateMarginLevel,
  calculateRequiredMargin,
  checkLiquidation,
} from "@/engine/economy/marginEngine";
import { applyXpGain, calculateXpGain, xpToNextLevel, BASE_XP } from "@/engine/player/progression";
import { processQuarterlyDividends } from "@/engine/economy/dividends";
import { chargeUpkeep, monthlyUpkeep } from "@/engine/economy/shop";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
// Длина одной свечи (в игровом времени) МАСШТАБИРУЕТСЯ по timeAcceleration
// активного стиля, а не фиксирована — иначе высокоускоренные стили (swing
// 720x, investing 43200x) успевают за ОДИН тик движка перепрыгнуть сразу
// десятки/сотни минутных бакетов: appendPriceToCandles добавляет ровно один
// бар за тик, так что промежуточные бакеты остаются пустыми, и график
// превращается в редкие несвязанные точки вместо баров с телом (поймано
// вручную на Investing — "какие-то чёрточки, цена летает непонятно где").
// 1 реальная секунда на свечу — те же ~4 сэмпла цены на бар при
// TICK_INTERVAL_MS=250 в сторе, что уже давал day (60x*1000=60_000ms,
// совпадает со старым захардкоженным значением константы).
export const CANDLE_REAL_MS = 1000;
export function candleIntervalMs(timeAcceleration: number): number {
  return CANDLE_REAL_MS * timeAcceleration;
}
export const MAX_CANDLES_PER_ASSET = 500;
// "Игровой квартал" (раздел 4.6) — 90 игровых дней, не календарных 1/4 года
// (спека не уточняет — простейший выбор, раздел 0 п.6).
export const QUARTER_MS = 90 * 24 * 60 * 60 * 1000;
// "Игровой месяц" (раздел 13) — 30 игровых дней, ровно треть квартала выше:
// расход на образ жизни списывается втрое чаще, чем приходят дивиденды, и это
// намеренно — содержание должно ощущаться, а не теряться на фоне купонов.
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
// Корреляция активов внутри одной correlationGroup (раздел 3.3): доля общего
// шока в шуме каждой бумаги. 0.6 — техи ходят вместе, но не одной линией;
// при 1 весь сектор превратился бы в один инструмент, при 0 диверсификация
// по секторам не значила бы ничего (а сводка в DiversificationPanel — врала).
export const GROUP_CORRELATION = 0.6;

export interface GameState {
  account: Account;
  marketRegime: MarketRegime;
  prices: Record<string, number>;
  candles: Record<string, Candle[]>;
  activeAssets: Asset[];
  activeStyle: TradingStyleConfig;
  gameCalendarDay: number;
  gameElapsedMs: number; // накоплено игрового времени с начала партии
  lastDividendQuarter: number; // номер последнего игрового квартала, за который уже заплатили
  lifestyle: LifestyleState; // покупки/косметика — раздел 13
  lastUpkeepMonth: number; // номер последнего игрового месяца, за который уже списали содержание
  // Эквити на начало текущего игрового дня — из неё считается дневной
  // результат в шапке терминала. Хранить историю эквити ради одной цифры
  // было бы дороже: снимок обновляется раз в игровой день.
  dayStartEquity: number;
  activeNews: NewsEvent[]; // новости, чей всплеск волатильности ещё не истёк (раздел 3.5)
  newsFeed: NewsEvent[]; // лента для UI, новые в начале, до MAX_NEWS_FEED штук
  // Настройки баланса из админки. Живут в состоянии, а не в модульной
  // переменной движка: формулы обязаны оставаться чистыми и тестируемыми
  // (раздел 26 — никакого скрытого глобального состояния).
  tuning: GameTuning;
}

function appendPriceToCandles(candles: Candle[], price: number, gameMs: number, intervalMs: number): Candle[] {
  const bucketStart = Math.floor(gameMs / intervalMs) * intervalMs;
  const last = candles[candles.length - 1];
  if (last && last.timestamp === bucketStart) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    return candles;
  }
  // Защита от "отката времени назад" — не должно случаться при
  // gameElapsedMs, монотонно растущем внутри одной вкладки, но на практике
  // случалось: gameDb.saveGame теперь тоже это блокирует (см. её комментарий),
  // здесь — вторая линия обороны на случай, если что-то всё же пришло не по
  // порядку (например, уже испорченное старое сохранение). Молча
  // игнорируем более старый бакет вместо порчи массива — свечи внутри
  // одной вкладки должны идти строго по возрастанию времени.
  if (last && bucketStart < last.timestamp) return candles;
  const next = [...candles, { timestamp: bucketStart, open: price, high: price, low: price, close: price, volume: 0 }];
  return next.length > MAX_CANDLES_PER_ASSET ? next.slice(next.length - MAX_CANDLES_PER_ASSET) : next;
}

/**
 * Возвращает цену исполнения, если SL/TP сработал, иначе null. Проверяем SL
 * первым: если оба условия истинны в один тик (гэп больше расстояния между
 * ними), консервативнее закрыть по стопу, а не по тейку.
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
 * Закрывает позицию по заданной цене и применяет эффект к счёту: баланс,
 * журнал, прогрессию (XP/уровень навыка по стилю, раздел 4.5). Общая
 * функция для ликвидации и авто-закрытия по SL/TP (ниже, шаг 4) и ручного
 * закрытия из UI (gameStore.ts) — чтобы все три пути считали комиссию,
 * R-мультипликатор и опыт одинаково. Мутирует переданный account (вызывающий
 * код передаёт уже скопированный черновик), возвращает realizedPnl.
 *
 * extraFee — доп. штраф поверх обычной комиссии (calculateLiquidationPenalty
 * при принудительном закрытии по марже; 0 при обычном закрытии). spreadCost
 * из раздела 4.1 сюда же не добавлен отдельно: Asset (раздел 2) не задаёт
 * базовый bid/ask спред по инструменту — ADJUSTED FROM SPEC.
 */
export function applyPositionClose(
  account: Account,
  position: Position,
  exitPrice: number,
  commissionRate: number,
  extraFee = 0,
  xpMultiplier = 1,
): number {
  const requiredMargin = calculateRequiredMargin(position.entryPrice, position.size, position.leverage);
  const { realizedPnl } = settleClose(position, exitPrice, commissionRate, extraFee);
  // requiredMargin — тот же резерв, что openPosition() в gameStore.ts снял с
  // баланса при открытии (раздел 4.2; при leverage=1 совпадает с полным
  // номиналом — старое поведение Фазы 1 не меняется).
  account.balance += requiredMargin + realizedPnl;

  const rMultiple =
    position.stopLoss != null
      ? realizedPnl / (Math.abs(position.entryPrice - position.stopLoss) * position.size * position.leverage)
      : 0;

  account.journal.push({
    id: crypto.randomUUID(),
    positionId: position.id,
    timestampClosed: Date.now(),
    pnl: realizedPnl,
    rMultiple,
    tags: [],
  });

  // Прогрессия (раздел 4.5) — начисляется на КАЖДОЙ закрытой сделке,
  // независимо от результата (даже убыточная по плану чему-то учит).
  const style = position.style;
  const current = account.skills[style] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };
  account.skills[style] = applyXpGain(current, calculateXpGain(BASE_XP, rMultiple, style) * xpMultiplier);

  const idx = account.positions.findIndex((p) => p.id === position.id);
  const closed: Position = { ...position, closedAt: Date.now(), closePrice: exitPrice, realizedPnl };
  if (idx >= 0) account.positions[idx] = closed;
  return realizedPnl;
}

function recalculateAccountMetrics(account: Account, prices: Record<string, number>): void {
  let unrealizedTotal = 0;
  let marginUsed = 0;
  for (const p of account.positions) {
    // account.positions хранит и закрытые сделки (для истории в UI) — без
    // этого фильтра их entryPrice продолжал бы сравниваться с текущей ценой
    // вечно, и equity «плыла» бы от баланса даже без единой открытой позиции.
    if (p.closedAt != null) continue;
    const price = prices[p.assetId];
    if (price != null) unrealizedTotal += calculateUnrealizedPnl(p, price);
    marginUsed += calculateRequiredMargin(p.entryPrice, p.size, p.leverage);
  }
  account.equity = account.balance + unrealizedTotal;
  account.marginUsed = marginUsed;
  account.marginLevel = calculateMarginLevel(account.equity, marginUsed);
}

/**
 * Главный тик. dtRealMs — сколько реального времени прошло с прошлого
 * вызова. rng — источник случайности (сидированный в тестах, Math.random в
 * игре) — обязателен явным параметром для каждой функции движка (раздел 26).
 *
 * Шаги псевдокода раздела 11 реализованы полностью, кроме психологии
 * (раздел 4.4) — она остаётся заготовкой типов до своей фазы.
 */
export function gameTick(dtRealMs: number, state: GameState, rng: () => number): GameState {
  const tuning = state.tuning ?? DEFAULT_TUNING;
  const dtGameMs = dtRealMs * state.activeStyle.timeAcceleration;
  const dtYears = dtGameMs / MS_PER_YEAR;
  const gameElapsedMs = state.gameElapsedMs + dtGameMs;

  const intervalMs = candleIntervalMs(state.activeStyle.timeAcceleration);

  // 1. Рыночный режим (раздел 3.4) — задаёт μ и σ всему рынку на недели
  // игрового времени вперёд.
  const marketRegime = updateMarketRegime(state.marketRegime, dtGameMs, rng);

  // 2. Новости (раздел 3.5). Мгновенный скачок применяется к ценам ДО шага
  // цены: иначе новость успела бы «опоздать» на одну свечу и на графике
  // выглядела бы как реакция без причины.
  let prices = { ...state.prices };
  const fresh = maybeGenerateNews(dtGameMs, state.activeAssets, marketRegime.driftModifier, gameElapsedMs, intervalMs, rng, {
    perGameDay: tuning.newsPerGameDay,
    blackSwanWeight: tuning.blackSwanWeight,
  });
  const activeNews = pruneExpiredNews(fresh ? [...state.activeNews, fresh] : state.activeNews, gameElapsedMs);
  const newsFeed = fresh ? [fresh, ...state.newsFeed].slice(0, MAX_NEWS_FEED) : state.newsFeed;
  if (fresh) prices = applyNewsShock(prices, fresh);

  // 3. Обновить цены активных активов.
  const candles = { ...state.candles };
  const assetIds = state.activeAssets.map((a) => a.id);
  const volMultipliers = newsVolMultipliers(activeNews, gameElapsedMs, assetIds);
  // Общий шок на группу корреляции (раздел 3.3): активы одного сектора
  // ходят вместе, а не независимо. Разыгрывается ОДИН раз за тик на группу
  // и подмешивается к индивидуальному шуму каждой бумаги.
  const groupZ = new Map<string, number>();
  for (const asset of state.activeAssets) {
    if (!groupZ.has(asset.correlationGroup)) groupZ.set(asset.correlationGroup, randomNormal(0, 1, rng));
  }
  const idioWeight = Math.sqrt(1 - GROUP_CORRELATION ** 2);
  for (const asset of state.activeAssets) {
    const currentPrice = prices[asset.id];
    if (currentPrice == null) continue;
    // Сумма коррелированной и независимой части с весами GROUP_CORRELATION и
    // sqrt(1-p²) сохраняет единичную дисперсию Z — иначе волатильность
    // «поехала» бы вместе с уровнем корреляции.
    const z = GROUP_CORRELATION * (groupZ.get(asset.correlationGroup) ?? 0) + idioWeight * randomNormal(0, 1, rng);
    const newPrice = simulateTick({
      asset,
      currentPrice,
      dtYears,
      regime: marketRegime,
      activeVolMultiplier: (volMultipliers[asset.id] ?? 1) * tuning.volatilityMultiplier,
      correlatedZ: z,
    });
    prices[asset.id] = newPrice;
    candles[asset.id] = appendPriceToCandles(candles[asset.id] ?? [], newPrice, gameElapsedMs, intervalMs);
  }

  // 4. Проверить ликвидацию и SL/TP открытых позиций (авто-закрытие).
  // Ликвидация — ПЕРВОЙ и вместо SL/TP на этом тике: реальная биржа закрыла
  // бы позицию принудительно раньше, чем добралась бы очередь до "мягкого"
  // стопа (edge case раздела 26 про приоритет форс-закрытия).
  const account: Account = { ...state.account, positions: [...state.account.positions], journal: [...state.account.journal] };
  for (const position of [...account.positions]) {
    if (position.closedAt) continue;
    const price = prices[position.assetId];
    if (price == null) continue;
    // Комиссия — по стилю, под которым позиция была ОТКРЫТА, а не по
    // текущему активному стилю: игрок мог переключиться (Фаза 2 добавила
    // смену стиля на лету), и позиция от scalping не должна вдруг закрыться
    // по тарифу swing только потому, что игрок сейчас смотрит другой режим.
    const commissionRate = TRADING_STYLE_CONFIGS[position.style].commissionRate;

    if (checkLiquidation(position, price)) {
      const liqPrice = calculateLiquidationPrice(position.entryPrice, position.leverage, position.side);
      const penalty = calculateLiquidationPenalty(position.entryPrice, position.size);
      applyPositionClose(account, position, liqPrice, commissionRate, penalty, tuning.xpMultiplier);
      continue;
    }

    const exitPrice = checkStopConditions(position, price);
    if (exitPrice == null) continue;
    applyPositionClose(account, position, exitPrice, commissionRate, 0, tuning.xpMultiplier);
  }

  // 6. Дивиденды/купоны раз в игровой квартал (раздел 4.6) — платим за
  // КАЖДЫЙ пройденный квартал, а не только за факт "квартал наступил": на
  // ускорении investing-режима (43200x) один тик может перескочить сразу
  // несколько кварталов, и пропускать промежуточные выплаты было бы нечестно
  // по отношению к формуле (игрок реально столько бы продержал позицию).
  const currentQuarter = Math.floor(gameElapsedMs / QUARTER_MS);
  let lastDividendQuarter = state.lastDividendQuarter;
  while (lastDividendQuarter < currentQuarter) {
    lastDividendQuarter++;
    processQuarterlyDividends(account, state.activeAssets, prices, tuning.dividendMultiplier);
  }

  // 6b. Расход на образ жизни раз в игровой месяц (раздел 13) — зеркально
  // дивидендам выше: тот же приём "платим за каждый пройденный период", чтобы
  // один тик на ускорении investing (43200x) не проглатывал месяцы бесплатно.
  const currentMonth = Math.floor(gameElapsedMs / MONTH_MS);
  let lastUpkeepMonth = state.lastUpkeepMonth;
  let lifestyle = state.lifestyle;
  const upkeep = monthlyUpkeep(lifestyle) * tuning.upkeepMultiplier;
  while (lastUpkeepMonth < currentMonth) {
    lastUpkeepMonth++;
    if (upkeep > 0) lifestyle = chargeUpkeep(account, lifestyle, upkeep).lifestyle;
  }

  // 7. Пересчитать equity/marginLevel (после дивидендов — они меняют balance).
  recalculateAccountMetrics(account, prices);

  // 8. Смена игрового дня — фиксируем эквити для дневного результата.
  const gameCalendarDay = Math.floor(gameElapsedMs / (24 * 60 * 60 * 1000));
  const dayStartEquity =
    gameCalendarDay !== state.gameCalendarDay || state.dayStartEquity == null
      ? account.equity
      : state.dayStartEquity;

  return {
    ...state,
    prices,
    candles,
    account,
    marketRegime,
    activeNews,
    newsFeed,
    gameElapsedMs,
    gameCalendarDay,
    dayStartEquity,
    lastDividendQuarter,
    lifestyle,
    lastUpkeepMonth,
  };
}
